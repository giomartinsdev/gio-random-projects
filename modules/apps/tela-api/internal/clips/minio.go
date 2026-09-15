package clips

import (
	"context"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3Store keeps clips in MinIO (or anything speaking S3). Metadata
// rides the object's user metadata so the bucket stays a flat
// clips/{id}.webm namespace with no separate index to keep in sync --
// the store is the single source of truth, even across restarts.
type S3Store struct {
	client *minio.Client
	bucket string
}

// NewS3Store connects and makes sure the bucket exists (one-off at
// startup, the same self-healing fallback post-api uses -- terraform
// is expected to have created it).
func NewS3Store(endpoint, accessKey, secretKey, bucket string, secure bool) (*S3Store, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
	}
	return &S3Store{client: client, bucket: bucket}, nil
}

// userMetadata keys minio-go surfaces lowercase, without the
// X-Amz-Meta- prefix -- a small case-insensitive lookup keeps us
// honest against whichever way the gateway round-trips them.
func (s *S3Store) meta(m map[string]string, key string) string {
	for k, v := range m {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

func keyFor(id string) string { return "clips/" + id + ".webm" }

const metaExpires = "expires"

func (s *S3Store) Save(ctx context.Context, clip Clip, r io.Reader) error {
	_, err := s.client.PutObject(ctx, s.bucket, keyFor(clip.ID), r, clip.Size,
		minio.PutObjectOptions{
			ContentType: "video/webm",
			UserMetadata: map[string]string{
				"room":      clip.RoomID,
				"name":      clip.Name,
				metaExpires: strconv.FormatInt(clip.ExpiresAt.Unix(), 10),
			},
		})
	return err
}

// clipFrom turns one object's stat into a Clip. A parse failure or a
// missing expiry is treated as already-dead: better to hide a clip
// than to keep serving something that would never be swept.
func (s *S3Store) clipFrom(id string, size int64, meta map[string]string, createdAt time.Time) (Clip, bool) {
	expires, err := strconv.ParseInt(s.meta(meta, metaExpires), 10, 64)
	if err != nil {
		return Clip{}, false
	}
	name := s.meta(meta, "name")
	return Clip{
		ID:        id,
		RoomID:    s.meta(meta, "room"),
		Name:      name,
		Size:      size,
		CreatedAt: createdAt,
		ExpiresAt: time.Unix(expires, 0),
	}, true
}

func (s *S3Store) List(ctx context.Context) ([]Clip, error) {
	now := time.Now()
	out := []Clip{}
	// WithMetadata makes each listing entry carry the user metadata,
	// so one API walk answers the home page instead of a stat per
	// object.
	for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:       "clips/",
		Recursive:    true,
		WithMetadata: true,
	}) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		id := strings.TrimSuffix(strings.TrimPrefix(obj.Key, "clips/"), ".webm")
		clip, ok := s.clipFrom(id, obj.Size, obj.UserMetadata, obj.LastModified)
		if !ok || !now.Before(clip.ExpiresAt) {
			continue
		}
		out = append(out, clip)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *S3Store) Open(ctx context.Context, id string) (Clip, io.ReadCloser, error) {
	stat, err := s.client.StatObject(ctx, s.bucket, keyFor(id), minio.StatObjectOptions{})
	if err != nil {
		resp := minio.ToErrorResponse(err)
		if resp.Code == "NoSuchKey" {
			return Clip{}, nil, ErrNotFound
		}
		return Clip{}, nil, err
	}
	clip, ok := s.clipFrom(id, stat.Size, stat.UserMetadata, stat.LastModified)
	if !ok || time.Now().After(clip.ExpiresAt) {
		// Expired-but-not-yet-swept: answer 404 and drop it on the spot
		// so the next listing is already clean.
		_ = s.client.RemoveObject(ctx, s.bucket, keyFor(id), minio.RemoveObjectOptions{})
		return Clip{}, nil, ErrNotFound
	}
	obj, err := s.client.GetObject(ctx, s.bucket, keyFor(id), minio.GetObjectOptions{})
	if err != nil {
		return Clip{}, nil, err
	}
	return clip, obj, nil
}

func (s *S3Store) SweepExpired(ctx context.Context, now time.Time) (int, error) {
	removed := 0
	// Missing or malformed expiry metadata counts as expired: such an
	// object would never be swept otherwise, and it's unlistable
	// anyway (clipFrom rejects it).
	for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:       "clips/",
		Recursive:    true,
		WithMetadata: true,
	}) {
		if obj.Err != nil {
			return removed, obj.Err
		}
		expires, err := strconv.ParseInt(s.meta(obj.UserMetadata, metaExpires), 10, 64)
		if err != nil || now.After(time.Unix(expires, 0)) {
			if err := s.client.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{}); err == nil {
				removed++
			}
		}
	}
	return removed, nil
}
