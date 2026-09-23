// Package clubs holds domain-api's read models for the FC Clubs Hub
// (specs/003). domain-api only ever READS these tables — domain-worker is
// the sole writer — so this package has no invariants, no constructors and
// no events: it is the shape of what comes back from Postgres, nothing more.
//
// ClubID/PlayerID/MatchID are TEXT because the source sends them as strings
// and alternates singular/plural parameter names; normalizing once in the
// ingest is what keeps that quirk out of every layer above.
package clubs

import "time"

// Club is one club with its all-time totals folded in — the profile the API
// serves. Totais* are zero when the club was never fetched (acompanhado
// false), which is exactly the "only general totals available" state the
// UI has to explain instead of showing an empty screen.
type Club struct {
	ClubID        string    `json:"club_id"`
	Name          string    `json:"name"`
	Tag         string    `json:"tag"`
	Stadium       string    `json:"stadium"`
	RegiaoID      string    `json:"region_id"`
	TimeID        string    `json:"team_id"`
	EscudoAssetID string    `json:"crest_asset_id"`
	Color1          int       `json:"color_1"`
	Color2          int       `json:"color_2"`
	Color3          int       `json:"color_3"`
	Color4          int       `json:"color_4"`
	Tracked   bool      `json:"tracked"`
	UpdatedAt  time.Time `json:"updated_at"`

	// Totais gerais — present even for a club we do not follow.
	Played          int `json:"played"`
	Wins       int `json:"wins"`
	Draws        int `json:"draws"`
	Losses       int `json:"losses"`
	Goals           int `json:"goals"`
	GoalsConceded   int `json:"goals_conceded"`
	CleanSheets int `json:"clean_sheets"`
	Points         int `json:"points"`
	Division   int `json:"division"`
	BestDivision  int `json:"best_division"`
	SkillRating          int `json:"skill_rating"`
	Promotions      int `json:"promotions"`
	Relegations  int `json:"relegations"`

	// Derived for the ranking and the profile header.
	WinRate float64      `json:"win_rate"`
	Form          []string     `json:"form"`
	Streak      Streak    `json:"streak"`
	Adversarios    []Adversario `json:"adversarios,omitempty"`
}

// Sequencia is the current win/unbeaten run, computed from persisted
// matches — the source only exposes these for the current window.
type Streak struct {
	Wins int `json:"wins"`
	Unbeaten  int `json:"unbeaten"`
}

// Adversario is one opponent in a club's recent history, with the
// head-to-head record against them.
type Adversario struct {
	ClubID     string    `json:"club_id"`
	Name       string    `json:"name"`
	Tag      string    `json:"tag"`
	Played      int       `json:"played"`
	V          int       `json:"wins"`
	E          int       `json:"draws"`
	D          int       `json:"losses"`
	Goals       int       `json:"goals"`
	GoalsAgainst int       `json:"goals_against"`
	LastMatch time.Time `json:"last_match"`
}

// Match is one match from one club's point of view, with the aggregate of
// its players folded in for the list view.
type Match struct {
	ID                       string    `json:"id"`
	MatchID                  string    `json:"match_id"`
	Timestamp                time.Time `json:"timestamp"`
	Kind                     string    `json:"kind"`
	PlayoffRound            string    `json:"playoff_round"`
	ClubeCasaID              string    `json:"home_club_id"`
	ClubeForaID              string    `json:"away_club_id"`
	CasaNome                 string    `json:"home_club_name"`
	CasaSigla                string    `json:"home_club_tag"`
	ForaNome                 string    `json:"away_club_name"`
	ForaSigla                string    `json:"away_club_tag"`
	HomeGoals                 int       `json:"home_goals"`
	AwayGoals                 int       `json:"away_goals"`
	DecidedByForfeit         bool      `json:"decided_by_forfeit"`
	VencedorPorDesistenciaID string    `json:"forfeit_winner_id"`
	HomeResult            string    `json:"home_result"`
	Events                   []any     `json:"events,omitempty"`

	// Which side the requested club was on, and its result — so the caller
	// never has to figure out "was I home?".
	OurSide       string `json:"our_side"` // "home" | "away"
	OurResult  string `json:"our_result"`
	OurGoals      int    `json:"our_goals"`
	TheirGoals       int    `json:"their_goals"`
	AdversarioID    string `json:"opponent_id"`
	OpponentName  string `json:"opponent_name"`
	OpponentTag string `json:"opponent_tag"`

	AvgRating float64      `json:"avg_rating"`
	Players    []PlayerLine `json:"players,omitempty"`
}

// PlayerLine is one player's performance in a match.
type PlayerLine struct {
	ClubID           string         `json:"club_id"`
	PlayerID         string         `json:"player_id"`
	Gamertag         string         `json:"gamertag"`
	Position          string         `json:"position"`
	Rating             float64        `json:"rating"`
	Goals             int            `json:"goals"`
	Assists     int            `json:"assists"`
	Shots           int            `json:"shots"`
	PassesMade     int            `json:"passes_made"`
	PassesAttempted   int            `json:"passes_attempted"`
	TacklesMade   int            `json:"tackles_made"`
	TacklesAttempted int            `json:"tackles_attempted"`
	Saves          int            `json:"saves"`
	SavesByType   map[string]int `json:"saves_by_type,omitempty"`
	SecondsPlayed  int            `json:"seconds_played"`
	ManOfTheMatch    bool           `json:"man_of_the_match"`
	RedCard   bool           `json:"red_card"`
	CleanSheet bool           `json:"clean_sheet"`
}

// SquadMember is one player's season aggregate within a club, built from the
// match lines — the source has no squad endpoint that survives a season.
type SquadMember struct {
	PlayerID         string    `json:"player_id"`
	Gamertag         string    `json:"gamertag"`
	Position          string    `json:"position"`
	Played            int       `json:"played"`
	Goals             int       `json:"goals"`
	Assists     int       `json:"assists"`
	Rating             float64   `json:"rating"`
	Shots           int       `json:"shots"`
	PassesMade     int       `json:"passes_made"`
	PassesAttempted   int       `json:"passes_attempted"`
	TacklesMade   int       `json:"tackles_made"`
	TacklesAttempted int       `json:"tackles_attempted"`
	Saves          int       `json:"saves"`
	ManOfTheMatch    int       `json:"man_of_the_match"`
	SecondsPlayed  int       `json:"seconds_played"`
	Form            []float64 `json:"form"`
	// Derived.
	GoalsPerGame         float64        `json:"goals_per_game"`
	AssistsPerGame float64        `json:"assists_per_game"`
	PassAccuracy      float64        `json:"pass_accuracy"`
	TackleAccuracy    float64        `json:"tackle_accuracy"`
	CleanSheets         int            `json:"clean_sheets"`
	RedCards    int            `json:"red_cards"`
	Goalkeeper             bool           `json:"goalkeeper"`
	SavesByType      map[string]int `json:"saves_by_type,omitempty"`
	// Resgatado diz que ALGUÉM já reivindicou este pro (sem dizer quem --
	// FR-025). A tela de resgate bloqueia os que já têm dono, para não
	// oferecer um botão que só falharia depois.
	Resgatado bool `json:"resgatado"`
}

// Alvo de um sync sob demanda. A fila é a mesma para clube e jogador: a
// pessoa quer forçar a atualização daquilo que está olhando.
const (
	AlvoClube   = "clube"
	AlvoJogador = "jogador"
)

// FetchRun é o progresso de um sync sob demanda. A SPA grava o pedido, o
// worker de ingestão busca da fonte, e a SPA lê daqui para saber quando o
// dado chegou -- sem esperar o ciclo de 15 min.
//
// Para jogador a fonte não tem endpoint próprio: o dado dele É derivado das
// partidas dos clubes onde jogou, então "syncar jogador" atualiza as partidas
// desses clubes e o perfil se recalcula na leitura. `Clubes` conta quantos
// clubes foram atualizados nesse caminho.
type FetchRun struct {
	Target        string     `json:"target"`
	TargetID      string     `json:"target_id"`
	Label      string     `json:"label"`
	Running     bool       `json:"running"`
	Players   int        `json:"players"`
	Matches    int        `json:"matches"`
	Clubs      int        `json:"clubs"`
	Error        string     `json:"error"`
	FinishedAt *time.Time `json:"finished_at"`
}

// SearchRun é o estado da busca ao vivo de um termo na fonte. A busca do
// diretório é local; esta é a saída para um clube que o hub ainda não viu, e
// a SPA polla isto enquanto o worker consulta o CDN.
type SearchRun struct {
	Termo       string     `json:"termo"`
	Running     bool       `json:"running"`
	Found int        `json:"found"`
	Error        string     `json:"error"`
	FinishedAt *time.Time `json:"finished_at"`
}

// PlayerProfile is one player across every club they were seen at.
type PlayerProfile struct {
	PlayerID            string         `json:"player_id"`
	Gamertag            string         `json:"gamertag"`
	Position             string         `json:"position"`
	ClubeID             string         `json:"club_id"`
	ClubName           string         `json:"club_name"`
	ClubeSigla          string         `json:"club_tag"`
	Played               int            `json:"played"`
	Goals                int            `json:"goals"`
	Assists        int            `json:"assists"`
	Rating                float64        `json:"rating"`
	GoalsPerGame         float64        `json:"goals_per_game"`
	AssistsPerGame float64        `json:"assists_per_game"`
	PassAccuracy      float64        `json:"pass_accuracy"`
	TackleAccuracy    float64        `json:"tackle_accuracy"`
	ManOfTheMatch       int            `json:"man_of_the_match"`
	SecondsPlayed     int            `json:"seconds_played"`
	CleanSheets         int            `json:"clean_sheets"`
	RedCards    int            `json:"red_cards"`
	Goalkeeper             bool           `json:"goalkeeper"`
	Form               []float64      `json:"form"`
	SavesByType      map[string]int `json:"saves_by_type,omitempty"`
	// Clusters: every club this player appeared at — the cross-club index.
	Clubs     []PlayerClub  `json:"clubs"`
	Verified bool          `json:"verified"`
	Matches   []PlayerMatch `json:"matches,omitempty"`
}

// PlayerCareer são os totais ACUMULADOS de um jogador num clube, do
// `members/career/stats` da fonte -- distinto da temporada corrente que as
// partidas dão. Chave: (club_id, gamertag), porque o endpoint não traz playerId.
type PlayerCareer struct {
	ClubID        string  `json:"club_id"`
	Gamertag      string  `json:"gamertag"`
	Played         int     `json:"played"`
	Goals          int     `json:"goals"`
	Assists  int     `json:"assists"`
	ManOfTheMatch int     `json:"man_of_the_match"`
	Rating          float64 `json:"rating"`
	Position       string  `json:"position"`
}

// PlayerClub is one club a player was seen at, with their numbers there.
type PlayerClub struct {
	ClubID       string  `json:"club_id"`
	Name         string  `json:"name"`
	Tag        string  `json:"tag"`
	Played        int     `json:"played"`
	Goals         int     `json:"goals"`
	Assists int     `json:"assists"`
	Rating         float64 `json:"rating"`
	// Career são os totais ACUMULADOS neste clube, quando a fonte os tem.
	// Distinto dos campos acima, que são a temporada das partidas gravadas --
	// é o que dá ao perfil os números de carreira que a EA não expõe.
	Career *CareerTotais `json:"career,omitempty"`
}

// CareerTotais é o acumulado de um jogador num clube (members/career/stats).
type CareerTotais struct {
	Played         int     `json:"played"`
	Goals          int     `json:"goals"`
	Assists  int     `json:"assists"`
	ManOfTheMatch int     `json:"man_of_the_match"`
	Rating          float64 `json:"rating"`
}

// PlayerMatch is one recent performance of a player.
type PlayerMatch struct {
	MatchID          string    `json:"match_id"`
	Timestamp        time.Time `json:"timestamp"`
	OpponentName   string    `json:"opponent_name"`
	Resultado        string    `json:"resultado"`
	HomeGoals         int       `json:"home_goals"`
	AwayGoals         int       `json:"away_goals"`
	Rating             float64   `json:"rating"`
	Goals             int       `json:"goals"`
	Assists     int       `json:"assists"`
	Shots           int       `json:"shots"`
	PassesMade     int       `json:"passes_made"`
	PassesAttempted   int       `json:"passes_attempted"`
	TacklesMade   int       `json:"tackles_made"`
	TacklesAttempted int       `json:"tackles_attempted"`
	SecondsPlayed  int       `json:"seconds_played"`
}

// Snapshot is one historical reading of a club's level and division.
type Snapshot struct {
	ReadAt        time.Time `json:"read_at"`
	SkillRating         int       `json:"skill_rating"`
	DivisionAtRead       int       `json:"division_at_read"`
	Played         int       `json:"played"`
	Wins      int       `json:"wins"`
	Draws       int       `json:"draws"`
	Losses      int       `json:"losses"`
	Goals          int       `json:"goals"`
	GoalsConceded  int       `json:"goals_conceded"`
	SquadSize int       `json:"squad_size"`
}

// DivisionChange is a dated promotion or relegation.
type DivisionChange struct {
	DetectedAt time.Time `json:"detected_at"`
	PreviousDivision          int       `json:"previous_division"`
	NewDivision        int       `json:"new_division"`
	Kind        string    `json:"kind"`
}

// Records is the club's record book, computed from the persisted history —
// which is the whole point: the source's window is ~10 matches, these are
// not.
type Records struct {
	BiggestWin   *RecordMatch `json:"biggest_win"`
	WorstLoss    *RecordMatch `json:"worst_loss"`
	MaisGols       *RecordMatch `json:"highest_scoring_match"`
	BestRating     *RecordLine  `json:"best_rating"`
	MaisGolsJogo   *RecordLine  `json:"most_goals_in_match"`
	MaiorSequencia int          `json:"longest_win_streak"`
	CleanSheets int          `json:"jogos_sem_sofrer_gol"`
	TotalMatches  int          `json:"total_matches"`
}

// RecordMatch is a match that set a record.
type RecordMatch struct {
	MatchID        string    `json:"match_id"`
	Timestamp      time.Time `json:"timestamp"`
	OpponentName string    `json:"opponent_name"`
	OurGoals     int       `json:"our_goals"`
	TheirGoals      int       `json:"their_goals"`
	Total          int       `json:"total_goals"`
}

// RecordLine is a single player performance that set a record.
type RecordLine struct {
	PlayerID       string    `json:"player_id"`
	Gamertag       string    `json:"gamertag"`
	MatchID        string    `json:"match_id"`
	Timestamp      time.Time `json:"timestamp"`
	OpponentName string    `json:"opponent_name"`
	Rating           float64   `json:"rating"`
	Goals           int       `json:"goals"`
}

// HeadToHead is the direct record between two clubs.
type HeadToHead struct {
	ClubA   ClubRef  `json:"club_a"`
	ClubB   ClubRef  `json:"club_b"`
	Played    int      `json:"played"`
	V        int      `json:"wins_a"`
	E        int      `json:"draws"`
	D        int      `json:"losses_a"`
	GoalsA    int      `json:"goals_a"`
	GoalsB    int      `json:"goals_b"`
	FormA   []string `json:"form_a"`
	Matches []Match  `json:"matches"`
}

// ClubRef is a minimal club reference for comparison views.
type ClubRef struct {
	ClubID         string `json:"club_id"`
	Name           string `json:"name"`
	Tag          string `json:"tag"`
	// As cores e o asset id viajam no ref porque é o que desenha o escudo:
	// sem eles, o ranking teria que escolher uma forma/cor por conta própria
	// e o mesmo clube apareceria com dois escudos diferentes -- um na lista,
	// outro no perfil, onde o clube vem inteiro.
	CrestAssetID  string `json:"crest_asset_id"`
	Color1          int    `json:"color_1"`
	Color2          int    `json:"color_2"`
	Color3          int    `json:"color_3"`
	Color4          int    `json:"color_4"`
	DivisionAtRead        int    `json:"division_at_read"`
	SkillRating          int    `json:"skill_rating"`
	Points         int    `json:"points"`
	Goals           int    `json:"goals"`
	GoalsConceded   int    `json:"goals_conceded"`
	CleanSheets int    `json:"clean_sheets"`
	Unbeaten        int    `json:"sequencia_invicta"`
	Tracked    bool   `json:"tracked"`
}

// Announcement is one item in the home feed.
type Announcement struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	ReferenciaID string    `json:"reference_id"`
	Icon        string    `json:"icon"`
	GeneratedAt     time.Time `json:"generated_at"`
}

// Ranking is the global leaderboard. Ranking entries are computed on read
// from the accumulated data, never materialized — at this scale a query is
// faster than an invalidation policy.
type Ranking struct {
	Metric   string       `json:"metric"`
	Clubs    []ClubRef    `json:"clubs,omitempty"`
	Players []RankPlayer `json:"players,omitempty"`
}

// RankPlayer is one player in the global ranking.
type RankPlayer struct {
	PlayerID     string  `json:"player_id"`
	Gamertag     string  `json:"gamertag"`
	Position      string  `json:"position"`
	ClubID       string  `json:"club_id"`
	ClubName    string  `json:"club_name"`
	ClubeSigla   string  `json:"club_tag"`
	Played        int     `json:"played"`
	Goals         int     `json:"goals"`
	Assists int     `json:"assists"`
	Rating         float64 `json:"rating"`
	GoalsPerGame  float64 `json:"goals_per_game"`
	Overall      int     `json:"overall"`
	Verified   bool    `json:"verified"`
}

// WatchEntry is one club a person follows.
type WatchEntry struct {
	ClubID        string    `json:"club_id"`
	Name          string    `json:"name"`
	Tag         string    `json:"tag"`
	DivisionAtRead       int       `json:"division_at_read"`
	SkillRating         int       `json:"skill_rating"`
	TrackedSince time.Time `json:"tracked_since"`
	Source        string    `json:"source"`
}

// NotificationPrefs is one person's notification toggles.
type NotificationPrefs struct {
	Channel             string `json:"channel"`
	WeeklyDigest   bool   `json:"weekly_digest"`
	RecordsAndDivisions bool   `json:"records_and_divisions"`
	MatchResults bool   `json:"match_results"`
}

// ClaimedPro is the pro a person claimed.
type ClaimedPro struct {
	ClubID     string `json:"club_id"`
	PlayerID   string `json:"player_id"`
	Verified bool   `json:"verified"`
}

// SyncRun is the progress of one person's background sync — the payload the
// SPA polls to draw the three-level indicator without blocking navigation.
type SyncRun struct {
	// UsuarioEmail só é preenchido na leitura de pendentes (o worker precisa
	// saber de quem é cada pedido); na leitura por pessoa ele fica vazio,
	// porque quem chama já sabe de quem é.
	UserEmail string    `json:"user_email,omitempty"`
	Running      bool      `json:"running"`
	SkillRating        int       `json:"skill_rating"`
	Total        int       `json:"total"`
	Completed   int       `json:"completed"`
	Current        string    `json:"current"`
	NewItems        []string  `json:"new_items"`
	StartedAt   time.Time `json:"started_at"`
	FinishedAt  time.Time `json:"finished_at"`
}

// AdminStatus is the technical overview the admin area renders.
type AdminStatus struct {
	ClubsTotal        int            `json:"clubs_total"`
	ClubsTracked int            `json:"clubs_tracked"`
	ClubsPending    int            `json:"clubs_pending"`
	Matches           int            `json:"matches"`
	Players          int            `json:"players"`
	Snapshots          int            `json:"snapshots"`
	DivisionChanges    int            `json:"division_changes"`
	Announcements           int            `json:"announcements"`
	LastMatchAt      *time.Time     `json:"last_match_at"`
	ByDivision         map[string]int `json:"by_division"`
	TopClubs          []ClubRef      `json:"top_clubs"`
}

// IngestEstado é a saúde do worker de ingestão. Ele não serve HTTP, então este
// é o único jeito de ver, pela API, se ele está coletando e qual foi o último
// erro -- inclusive o caso em que o CDN da fonte bloqueia o IP do datacenter.
type IngestEstado struct {
	LastCycleAt  *time.Time `json:"last_cycle_at"`
	Cycles        int        `json:"cycles"`
	ClubesOK       int        `json:"clubs_ok"`
	ClubsFailed   int        `json:"clubs_failed"`
	NewMatches  int        `json:"new_matches"`
	Snapshots      int        `json:"snapshots"`
	Bootstrapped bool       `json:"bootstrapped"`
	LastError     string     `json:"last_error"`
	LastErrorAt   *time.Time `json:"last_error_at"`
	// Vivo é derivado: um ciclo nos últimos 3 intervalos esperados.
	Alive bool `json:"alive"`
}
