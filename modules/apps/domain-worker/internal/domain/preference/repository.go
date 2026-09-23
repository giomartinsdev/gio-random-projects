package preferencia

import "context"

// Repository is a port. Every method takes usuarioEmail and must filter by
// it — there is deliberately no "list everything" method, so a caller
// cannot accidentally read another person's row.
type Repository interface {
	// Watchlist
	ListWatch(ctx context.Context, userEmail string) ([]WatchEntry, error)
	SetWatch(ctx context.Context, e WatchEntry) error
	// SetWatchWithOrigem upserts and lets an existing follow's origem be
	// upgraded (a club that starts as "rival" can become "proprio") --
	// SetWatch deliberately keeps the original row untouched.
	SetWatchWithOrigem(ctx context.Context, e WatchEntry) error
	RemoveWatch(ctx context.Context, userEmail, clubID string) error
	// SeededWatch reports whether a club is already followed by anyone —
	// used by the sync to decide whether a discovered club is genuinely new.
	IsWatched(ctx context.Context, userEmail, clubID string) (bool, error)

	// Notificações
	GetNotificacoes(ctx context.Context, userEmail string) (Notificacoes, error)
	UpsertNotificacoes(ctx context.Context, n Notificacoes) error
	// ListNotifyEnabled returns everyone who wants a given notification
	// kind and has a channel — the ingest's recipient list.
	ListNotifyEnabled(ctx context.Context, kind string) ([]Notificacoes, error)

	// Pro reivindicado
	GetClaimed(ctx context.Context, userEmail string) (ProReivindicado, error)
	UpsertClaimed(ctx context.Context, p ProReivindicado) error
	ListClaimedPlayerIDs(ctx context.Context) ([]string, error)

	// Sync
	GetSyncRun(ctx context.Context, userEmail string) (SyncRun, error)
	UpsertSyncRun(ctx context.Context, r SyncRun) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "preferencia not found" }
