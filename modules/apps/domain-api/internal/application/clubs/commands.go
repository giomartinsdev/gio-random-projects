// Package clubs holds domain-api's copies of the clubs command payloads —
// the shapes domain-worker decodes on the other end. domain-api only ever
// BUILDS these, never applies them, so there is no Service/Handler here.
// Field names and json tags must not drift from
// domain-worker/internal/application/{club,partida,clubesnapshot,preferencia,anuncio}.
package clubs

type UpsertClubInput struct {
	ClubID        string `json:"club_id"`
	Nome          string `json:"nome"`
	Sigla         string `json:"sigla,omitempty"`
	Estadio       string `json:"estadio,omitempty"`
	RegiaoID      string `json:"regiao_id,omitempty"`
	TimeID        string `json:"time_id,omitempty"`
	EscudoAssetID string `json:"escudo_asset_id,omitempty"`
	Cor1          int    `json:"cor_1,omitempty"`
	Cor2          int    `json:"cor_2,omitempty"`
	Cor3          int    `json:"cor_3,omitempty"`
	Cor4          int    `json:"cor_4,omitempty"`
	Acompanhado   bool   `json:"acompanhado,omitempty"`
}

type TotaisInput struct {
	ClubID         string `json:"club_id"`
	Jogos          int    `json:"jogos"`
	Vitorias       int    `json:"vitorias"`
	Empates        int    `json:"empates"`
	Derrotas       int    `json:"derrotas"`
	Gols           int    `json:"gols"`
	GolsSofridos   int    `json:"gols_sofridos"`
	JogosSemSofrer int    `json:"jogos_sem_sofrer"`
	Pontos         int    `json:"pontos"`
	DivisaoAtual   int    `json:"divisao_atual"`
	MelhorDivisao  int    `json:"melhor_divisao"`
	Nivel          int    `json:"nivel"`
	Promocoes      int    `json:"promocoes"`
	Rebaixamentos  int    `json:"rebaixamentos"`
}

type PlayerLineInput struct {
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

type PartidaInput struct {
	MatchID                  string            `json:"match_id"`
	Timestamp                string            `json:"timestamp"`
	Tipo                     string            `json:"tipo"`
	RodadaPlayoff            string            `json:"rodada_playoff,omitempty"`
	ClubeCasaID              string            `json:"clube_casa_id"`
	ClubeForaID              string            `json:"clube_fora_id"`
	GolsCasa                 int               `json:"gols_casa"`
	GolsFora                 int               `json:"gols_fora"`
	HouveDesistencia         bool              `json:"houve_desistencia"`
	VencedorPorDesistenciaID string            `json:"vencedor_por_desistencia_id,omitempty"`
	ResultadoCasa            string            `json:"resultado_casa"`
	Lances                   []any             `json:"lances,omitempty"`
	Jogadores                []PlayerLineInput `json:"jogadores"`
}

type SnapshotInput struct {
	ClubID        string `json:"club_id"`
	Nivel         int    `json:"nivel"`
	Divisao       int    `json:"divisao"`
	Jogos         int    `json:"jogos"`
	Vitorias      int    `json:"vitorias"`
	Empates       int    `json:"empates"`
	Derrotas      int    `json:"derrotas"`
	Gols          int    `json:"gols"`
	GolsSofridos  int    `json:"gols_sofridos"`
	TamanhoElenco int    `json:"tamanho_elenco"`
}

type AnuncioInput struct {
	Tipo          string `json:"tipo"`
	Titulo        string `json:"titulo"`
	Texto         string `json:"texto,omitempty"`
	ReferenciaID  string `json:"referencia_id,omitempty"`
	Icone         string `json:"icone,omitempty"`
	ExpiraEmHoras int    `json:"expira_em_horas,omitempty"`
}

// CareerInput são os totais de carreira de um jogador num clube, do
// members/career/stats da fonte.
type CareerInput struct {
	ClubID        string  `json:"club_id"`
	Gamertag      string  `json:"gamertag"`
	Jogos         int     `json:"jogos"`
	Gols          int     `json:"gols"`
	Assistencias  int     `json:"assistencias"`
	MelhorEmCampo int     `json:"melhor_em_campo"`
	Nota          float64 `json:"nota"`
	Posicao       string  `json:"posicao"`
}

type WatchInput struct {
	UsuarioEmail string `json:"usuario_email"`
	ClubID       string `json:"club_id"`
	Origem       string `json:"origem,omitempty"`
	Seguindo     bool   `json:"seguindo"`
}

type NotifyInput struct {
	UsuarioEmail      string `json:"usuario_email"`
	Canal             string `json:"canal,omitempty"`
	ResumoPeriodico   bool   `json:"resumo_periodico"`
	RecordesEDivisoes bool   `json:"recordes_e_divisoes"`
	ResultadoPartidas bool   `json:"resultado_partidas"`
}

type ClaimInput struct {
	UsuarioEmail string `json:"usuario_email"`
	ClubID       string `json:"club_id"`
	PlayerID     string `json:"player_id"`
	Verificado   bool   `json:"verificado"`
}

type SyncRunInput struct {
	UsuarioEmail string   `json:"usuario_email"`
	Rodando      bool     `json:"rodando"`
	Nivel        int      `json:"nivel"`
	Total        int      `json:"total"`
	Concluidos   int      `json:"concluidos"`
	Atual        string   `json:"atual,omitempty"`
	Novos        []string `json:"novos,omitempty"`
	Concluido    bool     `json:"concluido,omitempty"`
}

// IngestEstadoInput é o que o worker de ingestão publica a cada ciclo. Ele não
// tem host nem porta, então este é o canal para a saúde dele chegar até a API.
type IngestEstadoInput struct {
	Rodadas        int    `json:"rodadas"`
	ClubesOK       int    `json:"clubes_ok"`
	ClubesFalhos   int    `json:"clubes_falhos"`
	PartidasNovas  int    `json:"partidas_novas"`
	Snapshots      int    `json:"snapshots"`
	BootstrapFeito bool   `json:"bootstrap_feito"`
	UltimoErro     string `json:"ultimo_erro,omitempty"`
}

// FetchRunInput é o pedido de sync sob demanda (a SPA grava) e o resultado que
// o worker de ingestão publica de volta. `alvo` diz se é clube ou jogador --
// a fila é uma só, e para jogador o worker resolve os clubes dele.
type FetchRunInput struct {
	Alvo      string `json:"alvo"`
	AlvoID    string `json:"alvo_id"`
	Rotulo    string `json:"rotulo,omitempty"`
	Rodando   bool   `json:"rodando"`
	Jogadores int    `json:"jogadores,omitempty"`
	Partidas  int    `json:"partidas,omitempty"`
	Clubes    int    `json:"clubes,omitempty"`
	Erro      string `json:"erro,omitempty"`
	Concluido bool   `json:"concluido,omitempty"`
}

// SearchRunInput é o pedido de busca ao vivo na fonte e o resultado que o
// worker publica de volta. A busca do diretório é local; esta é a saída para
// um clube que o hub ainda não viu.
type SearchRunInput struct {
	Termo       string `json:"termo"`
	Rodando     bool   `json:"rodando"`
	Encontrados int    `json:"encontrados,omitempty"`
	Erro        string `json:"erro,omitempty"`
	Concluido   bool   `json:"concluido,omitempty"`
}
