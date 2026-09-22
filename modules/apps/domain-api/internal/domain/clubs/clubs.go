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
	Nome          string    `json:"nome"`
	Sigla         string    `json:"sigla"`
	Estadio       string    `json:"estadio"`
	RegiaoID      string    `json:"regiao_id"`
	TimeID        string    `json:"time_id"`
	EscudoAssetID string    `json:"escudo_asset_id"`
	Cor1          int       `json:"cor_1"`
	Cor2          int       `json:"cor_2"`
	Cor3          int       `json:"cor_3"`
	Cor4          int       `json:"cor_4"`
	Acompanhado   bool      `json:"acompanhado"`
	AtualizadoEm  time.Time `json:"atualizado_em"`

	// Totais gerais — present even for a club we do not follow.
	Jogos          int `json:"jogos"`
	Vitorias       int `json:"vitorias"`
	Empates        int `json:"empates"`
	Derrotas       int `json:"derrotas"`
	Gols           int `json:"gols"`
	GolsSofridos   int `json:"gols_sofridos"`
	JogosSemSofrer int `json:"jogos_sem_sofrer"`
	Pontos         int `json:"pontos"`
	DivisaoAtual   int `json:"divisao_atual"`
	MelhorDivisao  int `json:"melhor_divisao"`
	Nivel          int `json:"nivel"`
	Promocoes      int `json:"promocoes"`
	Rebaixamentos  int `json:"rebaixamentos"`

	// Derived for the ranking and the profile header.
	Aproveitamento float64      `json:"aproveitamento"`
	Forma          []string     `json:"forma"`
	Sequencia      Sequencia    `json:"sequencia"`
	Adversarios    []Adversario `json:"adversarios,omitempty"`
}

// Sequencia is the current win/unbeaten run, computed from persisted
// matches — the source only exposes these for the current window.
type Sequencia struct {
	Vitorias int `json:"vitorias"`
	Invicta  int `json:"invicta"`
}

// Adversario is one opponent in a club's recent history, with the
// head-to-head record against them.
type Adversario struct {
	ClubID     string    `json:"club_id"`
	Nome       string    `json:"nome"`
	Sigla      string    `json:"sigla"`
	Jogos      int       `json:"jogos"`
	V          int       `json:"vitorias"`
	E          int       `json:"empates"`
	D          int       `json:"derrotas"`
	Gols       int       `json:"gols"`
	GolsContra int       `json:"gols_contra"`
	UltimoJogo time.Time `json:"ultimo_jogo"`
}

// Match is one match from one club's point of view, with the aggregate of
// its players folded in for the list view.
type Match struct {
	ID                       string    `json:"id"`
	MatchID                  string    `json:"match_id"`
	Timestamp                time.Time `json:"timestamp"`
	Tipo                     string    `json:"tipo"`
	RodadaPlayoff            string    `json:"rodada_playoff"`
	ClubeCasaID              string    `json:"clube_casa_id"`
	ClubeForaID              string    `json:"clube_fora_id"`
	CasaNome                 string    `json:"clube_casa_nome"`
	CasaSigla                string    `json:"clube_casa_sigla"`
	ForaNome                 string    `json:"clube_fora_nome"`
	ForaSigla                string    `json:"clube_fora_sigla"`
	GolsCasa                 int       `json:"gols_casa"`
	GolsFora                 int       `json:"gols_fora"`
	HouveDesistencia         bool      `json:"houve_desistencia"`
	VencedorPorDesistenciaID string    `json:"vencedor_por_desistencia_id"`
	ResultadoCasa            string    `json:"resultado_casa"`
	Lances                   []any     `json:"lances,omitempty"`

	// Which side the requested club was on, and its result — so the caller
	// never has to figure out "was I home?".
	NossoLado       string `json:"nosso_lado"` // "casa" | "fora"
	NossoResultado  string `json:"nosso_resultado"`
	NossosGols      int    `json:"nossos_gols"`
	GolsDeles       int    `json:"gols_deles"`
	AdversarioID    string `json:"adversario_id"`
	AdversarioNome  string `json:"adversario_nome"`
	AdversarioSigla string `json:"adversario_sigla"`

	NotaAgregada float64      `json:"nota_agregada"`
	Jogadores    []PlayerLine `json:"jogadores,omitempty"`
}

// PlayerLine is one player's performance in a match.
type PlayerLine struct {
	ClubID           string         `json:"club_id"`
	PlayerID         string         `json:"player_id"`
	Gamertag         string         `json:"gamertag"`
	Posicao          string         `json:"posicao"`
	Nota             float64        `json:"nota"`
	Gols             int            `json:"gols"`
	Assistencias     int            `json:"assistencias"`
	Chutes           int            `json:"chutes"`
	PassesCertos     int            `json:"passes_certos"`
	PassesTentados   int            `json:"passes_tentados"`
	DesarmesCertos   int            `json:"desarmes_certos"`
	DesarmesTentados int            `json:"desarmes_tentados"`
	Defesas          int            `json:"defesas"`
	DefesasPorTipo   map[string]int `json:"defesas_por_tipo,omitempty"`
	SegundosJogados  int            `json:"segundos_jogados"`
	MelhorEmCampo    bool           `json:"melhor_em_campo"`
	CartaoVermelho   bool           `json:"cartao_vermelho"`
	JogoSemSofrerGol bool           `json:"jogo_sem_sofrer_gol"`
}

// SquadMember is one player's season aggregate within a club, built from the
// match lines — the source has no squad endpoint that survives a season.
type SquadMember struct {
	PlayerID         string    `json:"player_id"`
	Gamertag         string    `json:"gamertag"`
	Posicao          string    `json:"posicao"`
	Jogos            int       `json:"jogos"`
	Gols             int       `json:"gols"`
	Assistencias     int       `json:"assistencias"`
	Nota             float64   `json:"nota"`
	Chutes           int       `json:"chutes"`
	PassesCertos     int       `json:"passes_certos"`
	PassesTentados   int       `json:"passes_tentados"`
	DesarmesCertos   int       `json:"desarmes_certos"`
	DesarmesTentados int       `json:"desarmes_tentados"`
	Defesas          int       `json:"defesas"`
	MelhorEmCampo    int       `json:"melhor_em_campo"`
	SegundosJogados  int       `json:"segundos_jogados"`
	Forma            []float64 `json:"forma"`
	// Derived.
	GolsPorJogo         float64        `json:"gols_por_jogo"`
	AssistenciasPorJogo float64        `json:"assistencias_por_jogo"`
	PassesPrecisao      float64        `json:"passes_precisao"`
	DesarmesPrecisao    float64        `json:"desarmes_precisao"`
	CleanSheets         int            `json:"clean_sheets"`
	CartoesVermelhos    int            `json:"cartoes_vermelhos"`
	Goleiro             bool           `json:"goleiro"`
	DefesasPorTipo      map[string]int `json:"defesas_por_tipo,omitempty"`
}

// PlayerProfile is one player across every club they were seen at.
type PlayerProfile struct {
	PlayerID            string         `json:"player_id"`
	Gamertag            string         `json:"gamertag"`
	Posicao             string         `json:"posicao"`
	ClubeID             string         `json:"club_id"`
	ClubeNome           string         `json:"clube_nome"`
	ClubeSigla          string         `json:"club_sigla"`
	Jogos               int            `json:"jogos"`
	Gols                int            `json:"gols"`
	Assistencias        int            `json:"assistencias"`
	Nota                float64        `json:"nota"`
	GolsPorJogo         float64        `json:"gols_por_jogo"`
	AssistenciasPorJogo float64        `json:"assistencias_por_jogo"`
	PassesPrecisao      float64        `json:"passes_precisao"`
	DesarmesPrecisao    float64        `json:"desarmes_precisao"`
	MelhorEmCampo       int            `json:"melhor_em_campo"`
	SegundosJogados     int            `json:"segundos_jogados"`
	CleanSheets         int            `json:"clean_sheets"`
	CartoesVermelhos    int            `json:"cartoes_vermelhos"`
	Goleiro             bool           `json:"goleiro"`
	Forma               []float64      `json:"forma"`
	DefesasPorTipo      map[string]int `json:"defesas_por_tipo,omitempty"`
	// Clusters: every club this player appeared at — the cross-club index.
	Clubes     []PlayerClub  `json:"clubes"`
	Verificado bool          `json:"verificado"`
	Partidas   []PlayerMatch `json:"partidas,omitempty"`
}

// PlayerClub is one club a player was seen at, with their numbers there.
type PlayerClub struct {
	ClubID       string  `json:"club_id"`
	Nome         string  `json:"nome"`
	Sigla        string  `json:"sigla"`
	Jogos        int     `json:"jogos"`
	Gols         int     `json:"gols"`
	Assistencias int     `json:"assistencias"`
	Nota         float64 `json:"nota"`
}

// PlayerMatch is one recent performance of a player.
type PlayerMatch struct {
	MatchID          string    `json:"match_id"`
	Timestamp        time.Time `json:"timestamp"`
	AdversarioNome   string    `json:"adversario_nome"`
	Resultado        string    `json:"resultado"`
	GolsCasa         int       `json:"gols_casa"`
	GolsFora         int       `json:"gols_fora"`
	Nota             float64   `json:"nota"`
	Gols             int       `json:"gols"`
	Assistencias     int       `json:"assistencias"`
	Chutes           int       `json:"chutes"`
	PassesCertos     int       `json:"passes_certos"`
	PassesTentados   int       `json:"passes_tentados"`
	DesarmesCertos   int       `json:"desarmes_certos"`
	DesarmesTentados int       `json:"desarmes_tentados"`
	SegundosJogados  int       `json:"segundos_jogados"`
}

// Snapshot is one historical reading of a club's level and division.
type Snapshot struct {
	LidoEm        time.Time `json:"lido_em"`
	Nivel         int       `json:"nivel"`
	Divisao       int       `json:"divisao"`
	Jogos         int       `json:"jogos"`
	Vitorias      int       `json:"vitorias"`
	Empates       int       `json:"empates"`
	Derrotas      int       `json:"derrotas"`
	Gols          int       `json:"gols"`
	GolsSofridos  int       `json:"gols_sofridos"`
	TamanhoElenco int       `json:"tamanho_elenco"`
}

// DivisionChange is a dated promotion or relegation.
type DivisionChange struct {
	DetectadoEm time.Time `json:"detectado_em"`
	De          int       `json:"de"`
	Para        int       `json:"para"`
	Tipo        string    `json:"tipo"`
}

// Records is the club's record book, computed from the persisted history —
// which is the whole point: the source's window is ~10 matches, these are
// not.
type Records struct {
	MaiorGoleada   *RecordMatch `json:"maior_goleada"`
	PiorDerrota    *RecordMatch `json:"pior_derrota"`
	MaisGols       *RecordMatch `json:"jogo_com_mais_gols"`
	MelhorNota     *RecordLine  `json:"melhor_nota"`
	MaisGolsJogo   *RecordLine  `json:"mais_gols_em_um_jogo"`
	MaiorSequencia int          `json:"maior_sequencia_vitorias"`
	JogosSemSofrer int          `json:"jogos_sem_sofrer_gol"`
	TotalPartidas  int          `json:"total_partidas"`
}

// RecordMatch is a match that set a record.
type RecordMatch struct {
	MatchID        string    `json:"match_id"`
	Timestamp      time.Time `json:"timestamp"`
	AdversarioNome string    `json:"adversario_nome"`
	NossosGols     int       `json:"nossos_gols"`
	GolsDeles      int       `json:"gols_deles"`
	Total          int       `json:"total_gols"`
}

// RecordLine is a single player performance that set a record.
type RecordLine struct {
	PlayerID       string    `json:"player_id"`
	Gamertag       string    `json:"gamertag"`
	MatchID        string    `json:"match_id"`
	Timestamp      time.Time `json:"timestamp"`
	AdversarioNome string    `json:"adversario_nome"`
	Nota           float64   `json:"nota"`
	Gols           int       `json:"gols"`
}

// HeadToHead is the direct record between two clubs.
type HeadToHead struct {
	ClubeA   ClubRef  `json:"clube_a"`
	ClubeB   ClubRef  `json:"clube_b"`
	Jogos    int      `json:"jogos"`
	V        int      `json:"vitorias_a"`
	E        int      `json:"empates"`
	D        int      `json:"derrotas_a"`
	GolsA    int      `json:"gols_a"`
	GolsB    int      `json:"gols_b"`
	FormaA   []string `json:"forma_a"`
	Partidas []Match  `json:"partidas"`
}

// ClubRef is a minimal club reference for comparison views.
type ClubRef struct {
	ClubID         string `json:"club_id"`
	Nome           string `json:"nome"`
	Sigla          string `json:"sigla"`
	Divisao        int    `json:"divisao"`
	Nivel          int    `json:"nivel"`
	Pontos         int    `json:"pontos"`
	Gols           int    `json:"gols"`
	GolsSofridos   int    `json:"gols_sofridos"`
	JogosSemSofrer int    `json:"jogos_sem_sofrer"`
	Invicta        int    `json:"sequencia_invicta"`
	Acompanhado    bool   `json:"acompanhado"`
}

// Announcement is one item in the home feed.
type Announcement struct {
	ID           string    `json:"id"`
	Tipo         string    `json:"tipo"`
	Titulo       string    `json:"titulo"`
	Texto        string    `json:"texto"`
	ReferenciaID string    `json:"referencia_id"`
	Icone        string    `json:"icone"`
	GeradoEm     time.Time `json:"gerado_em"`
}

// Ranking is the global leaderboard. Ranking entries are computed on read
// from the accumulated data, never materialized — at this scale a query is
// faster than an invalidation policy.
type Ranking struct {
	Metrica   string       `json:"metrica"`
	Clubes    []ClubRef    `json:"clubes,omitempty"`
	Jogadores []RankPlayer `json:"jogadores,omitempty"`
}

// RankPlayer is one player in the global ranking.
type RankPlayer struct {
	PlayerID     string  `json:"player_id"`
	Gamertag     string  `json:"gamertag"`
	Posicao      string  `json:"posicao"`
	ClubID       string  `json:"club_id"`
	ClubeNome    string  `json:"clube_nome"`
	ClubeSigla   string  `json:"club_sigla"`
	Jogos        int     `json:"jogos"`
	Gols         int     `json:"gols"`
	Assistencias int     `json:"assistencias"`
	Nota         float64 `json:"nota"`
	GolsPorJogo  float64 `json:"gols_por_jogo"`
	Overall      int     `json:"overall"`
	Verificado   bool    `json:"verificado"`
}

// WatchEntry is one club a person follows.
type WatchEntry struct {
	ClubID        string    `json:"club_id"`
	Nome          string    `json:"nome"`
	Sigla         string    `json:"sigla"`
	Divisao       int       `json:"divisao"`
	Nivel         int       `json:"nivel"`
	SeguindoDesde time.Time `json:"seguindo_desde"`
	Origem        string    `json:"origem"`
}

// NotificationPrefs is one person's notification toggles.
type NotificationPrefs struct {
	Canal             string `json:"canal"`
	ResumoPeriodico   bool   `json:"resumo_periodico"`
	RecordesEDivisoes bool   `json:"recordes_e_divisoes"`
	ResultadoPartidas bool   `json:"resultado_partidas"`
}

// ClaimedPro is the pro a person claimed.
type ClaimedPro struct {
	ClubID     string `json:"club_id"`
	PlayerID   string `json:"player_id"`
	Verificado bool   `json:"verificado"`
}

// SyncRun is the progress of one person's background sync — the payload the
// SPA polls to draw the three-level indicator without blocking navigation.
type SyncRun struct {
	// UsuarioEmail só é preenchido na leitura de pendentes (o worker precisa
	// saber de quem é cada pedido); na leitura por pessoa ele fica vazio,
	// porque quem chama já sabe de quem é.
	UsuarioEmail string    `json:"usuario_email,omitempty"`
	Rodando      bool      `json:"rodando"`
	Nivel        int       `json:"nivel"`
	Total        int       `json:"total"`
	Concluidos   int       `json:"concluidos"`
	Atual        string    `json:"atual"`
	Novos        []string  `json:"novos"`
	IniciadoEm   time.Time `json:"iniciado_em"`
	ConcluidoEm  time.Time `json:"concluido_em"`
}

// AdminStatus is the technical overview the admin area renders.
type AdminStatus struct {
	ClubesTotal        int            `json:"clubes_total"`
	ClubesAcompanhados int            `json:"clubes_acompanhados"`
	ClubesPendentes    int            `json:"clubes_pendentes"`
	Partidas           int            `json:"partidas"`
	Jogadores          int            `json:"jogadores"`
	Snapshots          int            `json:"snapshots"`
	MudancasDivisao    int            `json:"mudancas_divisao"`
	Anuncios           int            `json:"anuncios"`
	UltimaPartida      *time.Time     `json:"ultima_partida"`
	PorDivisao         map[string]int `json:"por_divisao"`
	TopClubes          []ClubRef      `json:"top_clubes"`
}

// IngestEstado é a saúde do worker de ingestão. Ele não serve HTTP, então este
// é o único jeito de ver, pela API, se ele está coletando e qual foi o último
// erro -- inclusive o caso em que o CDN da fonte bloqueia o IP do datacenter.
type IngestEstado struct {
	UltimoCicloEm  *time.Time `json:"ultimo_ciclo_em"`
	Rodadas        int        `json:"rodadas"`
	ClubesOK       int        `json:"clubes_ok"`
	ClubesFalhos   int        `json:"clubes_falhos"`
	PartidasNovas  int        `json:"partidas_novas"`
	Snapshots      int        `json:"snapshots"`
	BootstrapFeito bool       `json:"bootstrap_feito"`
	UltimoErro     string     `json:"ultimo_erro"`
	UltimoErroEm   *time.Time `json:"ultimo_erro_em"`
	// Vivo é derivado: um ciclo nos últimos 3 intervalos esperados.
	Vivo bool `json:"vivo"`
}
