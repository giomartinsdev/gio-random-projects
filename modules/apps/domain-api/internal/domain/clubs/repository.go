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
	ListMatches(ctx context.Context, clubID, kind string, limit int) ([]Match, error)
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
	// Timeline cruza divisões, recordes e marcos num só fio datado -- o acervo
	// do hub, que a fonte não tem (ela só conhece a janela recente).
	Timeline(ctx context.Context, clubID string) ([]TimelineEntry, error)
	// ClubDeltas é a mudança desde a primeira leitura guardada: "o que
	// aconteceu com o meu clube desde que comecei a acompanhar".
	ClubDeltas(ctx context.Context, clubID string) (ClubDeltas, error)
	// GlobalRecords cruza TODAS as partidas acompanhadas -- o que a fonte não
	// faz, porque só conhece a janela recente de cada clube isolado (FR-011).
	GlobalRecords(ctx context.Context) (GlobalRecords, error)

	// Analytics derivadas do acervo (ver analytics.go). Nenhuma tem schema
	// próprio: são leituras que a fonte não consegue responder.
	ClubSeasons(ctx context.Context, clubID string) (SeasonList, error)
	PositionHeatmap(ctx context.Context, clubID string) (PositionHeatmap, error)
	SquadComparison(ctx context.Context, clubID string) (SquadComparison, error)
	RollingGoals(ctx context.Context, clubID string, limit int) (RollingGoals, error)
	MainRival(ctx context.Context, clubID string) (*MainRival, error)
	IdleSince(ctx context.Context, clubID string) (ClubIdle, error)
	BestByPosition(ctx context.Context, clubID string) ([]BestByPosition, error)
	RegionBreakdown(ctx context.Context) ([]RegionCount, error)
	HubReport(ctx context.Context) (HubReport, error)
	RatingEvolution(ctx context.Context, playerID string) (PlayerRatingEvolution, error)
	Consistency(ctx context.Context, playerID string) (PlayerConsistency, error)
	Discipline(ctx context.Context, playerID string) (PlayerDiscipline, error)
	Tenures(ctx context.Context, playerID string) ([]PlayerClubTenure, error)
	EventsByPlayer(ctx context.Context, playerID string) (PlayerEventBreakdown, error)

	// Feed e rankings
	RecentAnnouncements(ctx context.Context, limit int) ([]Announcement, error)
	// AnnouncementCount is how many announcements are live (not expired) --
	// the home header's number, independent of how few the feed shows.
	AnnouncementCount(ctx context.Context) (int, error)
	RankingClubs(ctx context.Context, metric string) ([]ClubRef, error)
	RankingPlayers(ctx context.Context, metric, position string) ([]RankPlayer, error)

	// Preferências (sempre por usuario_email)
	ListWatch(ctx context.Context, userEmail string) ([]WatchEntry, error)
	GetNotificacoes(ctx context.Context, userEmail string) (NotificationPrefs, error)
	GetClaimed(ctx context.Context, userEmail string) (*ClaimedPro, error)
	GetSyncRun(ctx context.Context, userEmail string) (SyncRun, error)
	// ListPendingSyncs returns every person whose sync was requested but not
	// finished (`rodando = true`, no concluido_em). The ingest worker polls
	// this -- it is how a click in the SPA reaches the worker that does the
	// actual discovering, without either side knowing about the other.
	ListPendingSyncs(ctx context.Context) ([]SyncRun, error)

	// Sync sob demanda de um alvo (clube ou jogador): a SPA grava o pedido, o
	// worker de ingestão polla e busca da fonte, a SPA lê o estado.
	GetFetchRun(ctx context.Context, target, alvoID string) (FetchRun, error)
	ListPendingFetches(ctx context.Context) ([]FetchRun, error)
	// ClubsDoJogador traduz "syncar jogador" em trabalho: a fonte não tem
	// endpoint de jogador, então o dado dele vem das partidas dos clubes onde
	// ele apareceu.
	ClubsDoJogador(ctx context.Context, playerID string) ([]string, error)

	// Busca ao vivo na fonte, para um clube que o hub ainda não viu.
	GetSearchRun(ctx context.Context, termo string) (SearchRun, error)
	ListPendingSearches(ctx context.Context) ([]SearchRun, error)

	// Administração
	AdminStatus(ctx context.Context) (AdminStatus, error)
	IngestEstado(ctx context.Context) (IngestEstado, error)
	ClaimedPlayerIDs(ctx context.Context) (map[string]bool, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "not found" }
