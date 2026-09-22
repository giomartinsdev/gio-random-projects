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

	// Histórico
	Snapshots(ctx context.Context, clubID string, since time.Time) ([]Snapshot, error)
	DivisionChanges(ctx context.Context, clubID string) ([]DivisionChange, error)
	LatestSnapshot(ctx context.Context, clubID string) (*Snapshot, error)
	Records(ctx context.Context, clubID string) (Records, error)

	// Feed e rankings
	RecentAnnouncements(ctx context.Context, limit int) ([]Announcement, error)
	RankingClubs(ctx context.Context, metrica string) ([]ClubRef, error)
	RankingPlayers(ctx context.Context, metrica, posicao string) ([]RankPlayer, error)

	// Preferências (sempre por usuario_email)
	ListWatch(ctx context.Context, usuarioEmail string) ([]WatchEntry, error)
	GetNotificacoes(ctx context.Context, usuarioEmail string) (NotificationPrefs, error)
	GetClaimed(ctx context.Context, usuarioEmail string) (*ClaimedPro, error)
	GetSyncRun(ctx context.Context, usuarioEmail string) (SyncRun, error)

	// Administração
	AdminStatus(ctx context.Context) (AdminStatus, error)
	ClaimedPlayerIDs(ctx context.Context) (map[string]bool, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "not found" }
