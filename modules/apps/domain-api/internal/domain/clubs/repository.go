package clubs

import (
	"context"
	"time"
)

// Repository is domain-api's read-only port for the clubs dataset. There is
// deliberately no write method: domain-worker is the only writer, and
// clubs-api never talks to Postgres at all.
type Repository interface {
	// Clubes
	ListClubs(ctx context.Context, onlyFollowed bool) ([]Club, error)
	GetClub(ctx context.Context, clubID string) (Club, error)
	SearchClubs(ctx context.Context, query string) ([]Club, error)
	SearchClubsLite(ctx context.Context, query string, limit int) ([]Club, error)

	// Partidas
	ListMatches(ctx context.Context, clubID, tipo string, limit int) ([]Match, error)
	GetMatch(ctx context.Context, matchID string) (Match, error)
	HeadToHead(ctx context.Context, aID, bID string) (HeadToHead, error)
	RecentMatchCount(ctx context.Context, clubID string) (int, error)
	LastMatchAt(ctx context.Context) (*time.Time, error)

	// Elenco e jogadores
	Squad(ctx context.Context, clubID string) ([]SquadMember, error)
	GetPlayer(ctx context.Context, playerID string) (PlayerProfile, error)
	SearchPlayers(ctx context.Context, query string, limit int) ([]PlayerProfile, error)
	AllPlayers(ctx context.Context) ([]PlayerProfile, error)
	// PlayerCount is the whole cross-club index size, independent of any page
	// or search -- the number the home header shows as "jogadores indexados".
	// SearchPlayers' `total` is its own page length, so it cannot answer this.
	PlayerCount(ctx context.Context) (int, error)

	// Histórico
	Snapshots(ctx context.Context, clubID string, since time.Time) ([]Snapshot, error)
	DivisionChanges(ctx context.Context, clubID string) ([]DivisionChange, error)
	LatestSnapshot(ctx context.Context, clubID string) (*Snapshot, error)
	Records(ctx context.Context, clubID string) (Records, error)

	// Feed e rankings
	RecentAnnouncements(ctx context.Context, limit int) ([]Announcement, error)
	// AnnouncementCount is how many announcements are live (not expired) --
	// the home header's number, independent of how few the feed shows.
	AnnouncementCount(ctx context.Context) (int, error)
	RankingClubs(ctx context.Context, metrica string) ([]ClubRef, error)
	RankingPlayers(ctx context.Context, metrica, posicao string) ([]RankPlayer, error)

	// Preferências (sempre por usuario_email)
	ListWatch(ctx context.Context, usuarioEmail string) ([]WatchEntry, error)
	GetNotificacoes(ctx context.Context, usuarioEmail string) (NotificationPrefs, error)
	GetClaimed(ctx context.Context, usuarioEmail string) (*ClaimedPro, error)
	GetSyncRun(ctx context.Context, usuarioEmail string) (SyncRun, error)
	// ListPendingSyncs returns every person whose sync was requested but not
	// finished (`rodando = true`, no concluido_em). The ingest worker polls
	// this -- it is how a click in the SPA reaches the worker that does the
	// actual discovering, without either side knowing about the other.
	ListPendingSyncs(ctx context.Context) ([]SyncRun, error)

	// Fetch sob demanda de um clube: a tela de resgate grava o pedido, o
	// worker de ingestão polla e busca o elenco, a SPA lê o estado.
	GetFetchRun(ctx context.Context, clubID string) (FetchRun, error)
	ListPendingFetches(ctx context.Context) ([]FetchRun, error)

	// Administração
	AdminStatus(ctx context.Context) (AdminStatus, error)
	IngestEstado(ctx context.Context) (IngestEstado, error)
	ClaimedPlayerIDs(ctx context.Context) (map[string]bool, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "not found" }
