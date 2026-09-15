package clips

import (
	"context"
	"io"
	"sort"
	"sync"
	"time"
)

// MemoryStore keeps clips in RAM. This is the zero-config default: a
// five-minute clip is tens of MB, a handful of them is all a small
// deployment generates in an afternoon, and they evaporate with the
// process -- which is the honest behavior for "clips" that were never
// promised to outlive the server.
type MemoryStore struct {
	mu    sync.RWMutex
	clips map[string]memClip
	used  int64
	// Hard ceiling on the sum of stored bytes. One 5-minute clip runs
	// 40-100 MB depending on resolution and bitrate, so this is "a
	// handful of clips", and Save refuses (ErrTooBig) rather than
	// silently evicting someone else's.
	maxTotal int64
}

type memClip struct {
	meta Clip
	data []byte
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		clips:    make(map[string]memClip),
		maxTotal: 512 << 20, // 512 MB of RAM is already generous for the fallback
	}
}

func (s *MemoryStore) Save(_ context.Context, clip Clip, r io.Reader) error {
	// Read fully first: either the whole thing fits the budget, or
	// nothing is stored -- a half-failed Save must never leave a
	// phantom entry.
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if int64(len(data)) > s.maxTotal || s.used+int64(len(data)) > s.maxTotal {
		return ErrTooBig
	}
	clip.Size = int64(len(data))
	s.clips[clip.ID] = memClip{meta: clip, data: data}
	s.used += int64(len(data))
	return nil
}

func (s *MemoryStore) List(_ context.Context) ([]Clip, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	now := time.Now()
	out := make([]Clip, 0, len(s.clips))
	for _, c := range s.clips {
		if now.Before(c.meta.ExpiresAt) {
			out = append(out, c.meta)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) Open(_ context.Context, id string) (Clip, io.ReadCloser, error) {
	s.mu.RLock()
	c, ok := s.clips[id]
	s.mu.RUnlock()
	if !ok || time.Now().After(c.meta.ExpiresAt) {
		// Lazy expiry on read; the sweeper does the deleting.
		if ok {
			_ = s.delete(id)
		}
		return Clip{}, nil, ErrNotFound
	}
	return c.meta, &memReader{data: c.data}, nil
}

func (s *MemoryStore) SweepExpired(_ context.Context, now time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	removed := 0
	for id, c := range s.clips {
		if now.After(c.meta.ExpiresAt) {
			delete(s.clips, id)
			s.used -= int64(len(c.data))
			removed++
		}
	}
	return removed, nil
}

// delete removes one clip and returns its bytes to the budget.
// Separate from SweepExpired so Open's lazy expiry can reuse it
// (Open must not hold the write lock while deciding).
func (s *MemoryStore) delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.clips[id]
	if !ok {
		return ErrNotFound
	}
	delete(s.clips, id)
	s.used -= int64(len(c.data))
	return nil
}

// memReader hands out the stored bytes; a fresh one per Open so
// concurrent downloads don't share an offset.
type memReader struct {
	data   []byte
	offset int64
}

func (r *memReader) Read(p []byte) (int, error) {
	if r.offset >= int64(len(r.data)) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.offset:])
	r.offset += int64(n)
	return n, nil
}

func (r *memReader) Close() error { return nil }
