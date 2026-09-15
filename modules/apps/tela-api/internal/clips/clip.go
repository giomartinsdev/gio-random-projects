// Package clips stores the little videos people cut from their own
// share ("clip dos últimos 5 minutos") and hands them back for
// download. The bytes themselves are recorded in the PUBLISHER'S
// browser -- MediaRecorder around the captured stream -- and uploaded
// here as a finished WebM; this package never touches media it
// didn't receive whole, which keeps the SFU's realtime path and the
// storage path entirely separate.
package clips

import (
	"context"
	"errors"
	"io"
	"time"
)

var (
	ErrNotFound = errors.New("clip não encontrado")
	// The uploader's browser assembled this clip; a store may still
	// refuse it if it would blow past the deployment's total budget.
	ErrTooBig = errors.New("clip grande demais")
)

// Clip is the metadata of one stored recording. The bytes live behind
// the store; everything here is safe to hand to any client.
type Clip struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"roomId"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Store is where finished clips live. Two implementations ship: a
// memory store (default -- clips die with the process, fine for a
// quick share) and an S3/MinIO store (TELA_S3_* configured -- clips
// survive restarts and are what production uses).
//
// List returns every live clip, newest first: the home page's Clips
// section shows ALL of them, deliberately -- downloads are
// unguessable-id URLs, so "who can see the list" was never the
// sensitive line.
type Store interface {
	Save(ctx context.Context, clip Clip, r io.Reader) error
	List(ctx context.Context) ([]Clip, error)
	// Open returns the metadata and the bytes together; callers stream
	// the reader and must close it.
	Open(ctx context.Context, id string) (Clip, io.ReadCloser, error)
	// SweepExpired removes everything past its ExpiresAt and reports
	// how many went. Called on a ticker by StartSweeper; stores may
	// also enforce expiry lazily on read.
	SweepExpired(ctx context.Context, now time.Time) (int, error)
}

// StartSweeper runs the store's expiry sweep on a ticker until stop
// closes. Clips are self-expiring uploads, so the sweeper is the only
// thing standing between MinIO and slow unbounded growth.
func StartSweeper(ctx context.Context, store Store, interval time.Duration, stop <-chan struct{}, log func(msg string, removed int)) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if removed, err := store.SweepExpired(ctx, time.Now()); err == nil && removed > 0 {
					log("clips expirados removidos", removed)
				}
			case <-stop:
				return
			}
		}
	}()
}
