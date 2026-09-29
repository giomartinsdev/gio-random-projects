// Tipos que espelham o que o clubs-api devolve. O payload de leitura nunca
// carrega termo técnico (sem "snapshot", "ingest", "cache") — a nomenclatura
// de apresentação é toda daqui para baixo.

export type Position = "goalkeeper" | "defender" | "midfielder" | "forward";
export type Resultado = "win" | "draw" | "loss";
export type TipoPartida = "league" | "friendly" | "playoff";

export interface ClubRef {
  club_id: string;
  name: string;
  tag: string;
  // O escudo é desenhado a partir destes campos, então eles viajam em
  // qualquer referência de clube -- sem eles o ranking cairia no hash por
  // nome/id e o mesmo clube apareceria com dois escudos.
  crest_asset_id: string;
  color_1: number;
  color_2: number;
  color_3: number;
  color_4: number;
  division_at_read: number;
  skill_rating: number;
  points: number;
  goals: number;
  goals_conceded: number;
  clean_sheets: number;
  sequencia_invicta: number;
  tracked: boolean;
}

export interface Adversario {
  club_id: string;
  name: string;
  tag: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  goals_against: number;
  last_match: string;
}

export interface Club {
  club_id: string;
  name: string;
  tag: string;
  stadium: string;
  region_id: string;
  team_id: string;
  crest_asset_id: string;
  color_1: number;
  color_2: number;
  color_3: number;
  color_4: number;
  tracked: boolean;
  updated_at: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  goals_conceded: number;
  clean_sheets: number;
  points: number;
  division: number;
  best_division: number;
  skill_rating: number;
  promotions: number;
  relegations: number;
  win_rate: number;
  form: string[] | null;
  streak: { wins: number; unbeaten: number };
  adversarios: Adversario[] | null;
}

export interface PlayerLine {
  club_id: string;
  player_id: string;
  gamertag: string;
  position: Position;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  passes_made: number;
  passes_attempted: number;
  tackles_made: number;
  tackles_attempted: number;
  saves: number;
  saves_by_type?: Record<string, number> | null;
  seconds_played: number;
  man_of_the_match: boolean;
  red_card: boolean;
  clean_sheet: boolean;
}

export interface Match {
  id: string;
  match_id: string;
  timestamp: string;
  kind: TipoPartida;
  playoff_round: string;
  home_club_id: string;
  away_club_id: string;
  home_club_name: string;
  home_club_tag: string;
  away_club_name: string;
  away_club_tag: string;
  home_goals: number;
  away_goals: number;
  decided_by_forfeit: boolean;
  home_result: Resultado;
  our_side: "home" | "away";
  our_result: Resultado;
  our_goals: number;
  their_goals: number;
  opponent_id: string;
  opponent_name: string;
  opponent_tag: string;
  avg_rating: number;
  players?: PlayerLine[] | null;
  events?: Array<{ player_id: string; gamertag: string; eventos: Array<{ label: string; quantidade: number }>; inferido: boolean }> | null;
}

export interface SquadMember {
  player_id: string;
  gamertag: string;
  position: Position;
  played: number;
  goals: number;
  assists: number;
  rating: number;
  shots: number;
  passes_made: number;
  passes_attempted: number;
  tackles_made: number;
  tackles_attempted: number;
  saves: number;
  man_of_the_match: number;
  seconds_played: number;
  form: number[] | null;
  goals_per_game: number;
  assists_per_game: number;
  pass_accuracy: number;
  tackle_accuracy: number;
  clean_sheets: number;
  red_cards: number;
  goalkeeper: boolean;
  saves_by_type?: Record<string, number> | null;
  /** Alguém já reivindicou este pro (o hub não diz quem) — a tela de resgate
   * bloqueia os que já têm dono em vez de oferecer um botão que falharia. */
  resgatado?: boolean;
}

/** O estado do fetch sob demanda do elenco de um clube. A tela de resgate
 * grava o pedido e polla isto até `concluido_em` aparecer. */
/** O estado de um sync sob demanda. A SPA grava o pedido e polla isto até
 * `concluido_em` aparecer. O alvo pode ser um clube ou um jogador. */
export interface FetchRun {
  target: "club" | "player";
  target_id: string;
  label: string;
  running: boolean;
  players: number;
  matches: number;
  clubs: number;
  error: string;
  finished_at: string | null;
}

/** O estado da busca ao vivo de um termo na fonte. A busca do diretório é
 * local; esta alcança um clube que o hub ainda não viu. */
export interface SearchRun {
  termo: string;
  running: boolean;
  found: number;
  error: string;
  finished_at: string | null;
}

export interface PlayerClub {
  club_id: string;
  name: string;
  tag: string;
  played: number;
  goals: number;
  assists: number;
  rating: number;
  /** Totais ACUMULADOS no clube (carreira), quando a fonte os tem. Distinto
   * dos campos acima, que são a temporada das partidas acompanhadas. */
  career?: PlayerCareer | null;
}

export interface PlayerCareer {
  played: number;
  goals: number;
  assists: number;
  man_of_the_match: number;
  rating: number;
}

export interface PlayerMatch {
  match_id: string;
  timestamp: string;
  kind: TipoPartida;
  opponent_name: string;
  resultado: Resultado;
  home_goals: number;
  away_goals: number;
  rating: number;
  goals: number;
  assists: number;
  shots: number;
  passes_made: number;
  passes_attempted: number;
  tackles_made: number;
  tackles_attempted: number;
  seconds_played: number;
}

export interface PlayerProfile {
  player_id: string;
  gamertag: string;
  position: Position;
  club_id: string;
  club_name: string;
  club_tag: string;
  played: number;
  goals: number;
  assists: number;
  rating: number;
  goals_per_game: number;
  assists_per_game: number;
  pass_accuracy: number;
  tackle_accuracy: number;
  man_of_the_match: number;
  seconds_played: number;
  clean_sheets: number;
  red_cards: number;
  goalkeeper: boolean;
  form: number[] | null;
  saves_by_type?: Record<string, number> | null;
  clubs: PlayerClub[] | null;
  verified: boolean;
  matches?: PlayerMatch[] | null;
  // Evolução de gols por temporada (FR-013). A fonte não tem temporada,
  // então é derivada da data das partidas — ver seasonLabel no backend.
  seasons: PlayerSeason[];
}

export interface PlayerSeason {
  season: string;
  played: number;
  goals: number;
  assists: number;
  rating: number;
}

export interface Snapshot {
  read_at: string;
  skill_rating: number;
  division_at_read: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  goals_conceded: number;
  squad_size: number;
}

export interface Evolution {
  serie: Snapshot[] | null;
  total: number;
  current: Snapshot | null;
  // Explícito para a UI explicar "o histórico cresce a cada atualização" em
  // vez de desenhar um gráfico de um ponto só.
  historico_curto: boolean;
}

export interface DivisionChange {
  detected_at: string;
  previous_division: number;
  new_division: number;
  kind: "promotion" | "relegation";
}

/** Um evento datado da história do clube -- divisão, recorde, marco, entrada no
 * hub. É o acervo que a fonte não tem: a EA só conhece o agora. O `data` são os
 * fatos, para desenhar no idioma escolhido; `title` é o fallback. */
export interface TimelineEntry {
  at: string;
  kind: "divisao" | "recorde" | "marco" | "seguido";
  title: string;
  detail?: string;
  data?: Record<string, unknown> | null;
}

/** A mudança desde que a pessoa começou a acompanhar o clube. Só existe porque
 * o hub acumula leituras; a fonte não sabe responder "o que mudou desde X". */
export interface ClubDeltas {
  since: string | null;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  skill_delta: number;
  division_from: number;
  division_to: number;
}

export interface RecordMatch {
  match_id: string;
  timestamp: string;
  opponent_name: string;
  our_goals: number;
  their_goals: number;
  total_goals: number;
}

/** O clube dono de um recorde global, com o suficiente para desenhar o escudo. */
export interface GlobalRecordClub {
  club_id: string;
  name: string;
  tag: string;
}

export interface GlobalRecordMatch {
  match_id: string;
  timestamp: string;
  club: GlobalRecordClub;
  opponent: GlobalRecordClub;
  club_goals: number;
  opp_goals: number;
  total_goals: number;
}

export interface GlobalRecordLine {
  player_id: string;
  gamertag: string;
  club: GlobalRecordClub;
  opponent_name: string;
  match_id: string;
  timestamp: string;
  rating: number;
}

export interface GlobalRecordPlayer {
  player_id: string;
  gamertag: string;
  club: GlobalRecordClub;
  goals: number;
  assists: number;
  played: number;
}

/** Os recordes do hub inteiro (FR-011): cruzam todos os clubes acompanhados. */
export interface GlobalRecords {
  biggest_win: GlobalRecordMatch | null;
  highest_scoring_match: GlobalRecordMatch | null;
  best_rating: GlobalRecordLine | null;
  top_scorer: GlobalRecordPlayer | null;
  total_matches: number;
  total_clubs: number;
}

export interface RecordLine {
  player_id: string;
  gamertag: string;
  match_id: string;
  timestamp: string;
  opponent_name: string;
  rating: number;
  goals: number;
}

export interface Records {
  biggest_win: RecordMatch | null;
  worst_loss: RecordMatch | null;
  highest_scoring_match: RecordMatch | null;
  best_rating: RecordLine | null;
  most_goals_in_match: RecordLine | null;
  longest_win_streak: number;
  clean_sheets: number;
  total_matches: number;
}

export interface HeadToHead {
  club_a: ClubRef;
  club_b: ClubRef;
  played: number;
  wins_a: number;
  draws: number;
  losses_a: number;
  goals_a: number;
  goals_b: number;
  form_a: string[] | null;
  matches: Match[] | null;
}

/** O anúncio guarda os FATOS (`data`), não a frase pronta: quem desenha monta
 * o texto no idioma escolhido. `title` é o fallback de quem não tem os fatos
 * (linhas antigas, gravadas antes desta mudança). */
export interface Announcement {
  id: string;
  // Os valores reais do banco. O tipo antigo dizia "result"/"player" mas o
  // dado sempre foi "resultado"/"jogador" -- o TypeScript mentia.
  kind: "resultado" | "ranking" | "jogador" | "novidade";
  title: string;
  body: string;
  reference_id: string;
  icon: string;
  data?: AnnouncementData | null;
  generated_at: string;
}

/** Os fatos de um anúncio de resultado. */
export interface AnnouncementData {
  result?: Resultado;
  our_goals?: number;
  their_goals?: number;
  match_kind?: TipoPartida;
}

export interface RankPlayer {
  player_id: string;
  gamertag: string;
  position: Position;
  club_id: string;
  club_name: string;
  club_tag: string;
  played: number;
  goals: number;
  assists: number;
  rating: number;
  goals_per_game: number;
  verified: boolean;
}

export interface WatchEntry {
  club_id: string;
  name: string;
  tag: string;
  division_at_read: number;
  skill_rating: number;
  tracked_since: string;
  source: "own" | "rival" | "rival_of_rival" | "manual";
}

export interface NotificationPrefs {
  channel: string;
  weekly_digest: boolean;
  records_and_divisions: boolean;
  match_results: boolean;
}

export interface ClaimedPro {
  club_id: string;
  player_id: string;
  verified: boolean;
}

export interface SyncRun {
  running: boolean;
  skill_rating: number;
  total: number;
  completed: number;
  current: string;
  new_items: string[] | null;
  started_at: string;
  finished_at: string;
  /** Segundos restantes até poder sincronizar de novo (rate limit de 30 min do
   * servidor). 0 = liberado. */
  cooldown_segundos?: number;
}

/** A saúde da fonte (EA/CDN). `available:false` é a fornecedora dos dados fora
 * — a interface usa isto para avisar que é uma falha passageira dela, e não
 * "este clube não tem dados". Quando a fonte volta, o dado sincroniza sozinho. */
export interface SourceStatus {
  available: boolean;
  error: string;
  checked_at: string | null;
}

export interface AdminStatus {
  clubs_total: number;
  clubs_tracked: number;
  clubs_pending: number;
  matches: number;
  players: number;
  snapshots: number;
  division_changes: number;
  announcements: number;
  last_match_at: string | null;
  by_division: Record<string, number> | null;
  top_clubs: ClubRef[] | null;
}

// --- analytics do acervo (derivadas do histórico; a fonte não responde isto) --

export interface SeasonScorer {
  player_id: string;
  gamertag: string;
  played: number;
  goals: number;
  assists: number;
  rating: number;
}

export interface SeasonSummary {
  season: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  against: number;
  scorers: SeasonScorer[] | null;
}

export interface SeasonList {
  seasons: SeasonSummary[] | null;
  current: string;
}

export interface PositionCount {
  position: Position;
  players: number;
}

export interface PositionHeatmap {
  buckets: PositionCount[] | null;
  total: number;
}

export interface SquadChange {
  player_id: string;
  gamertag: string;
  position: Position;
  goals: number;
  kind: "entrou" | "saiu";
}

export interface SquadComparison {
  from: string;
  to: string;
  stayed: number;
  entraram: SquadChange[] | null;
  sairam: SquadChange[] | null;
}

export interface RollingGoals {
  matches: RollingGoalsPoint[] | null;
}

export interface RollingGoalsPoint {
  match_id: string;
  timestamp: string;
  opponent: string;
  our: number;
  their: number;
  result: Resultado;
}

export interface MainRival {
  club_id: string;
  name: string;
  tag: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  goals_against: number;
  last_match: string;
  matches: number;
}

export interface ClubIdle {
  last_match: string | null;
  days: number;
  idle: boolean;
}

export interface BestByPosition {
  position: Position;
  player: SquadMember;
}

export interface RegionCount {
  region_id: string;
  clubs: number;
  tracked: number;
  top_name: string;
}

export interface HubReport {
  clubs: number;
  tracked_clubs: number;
  matches: number;
  players: number;
  snapshots: number;
  first_match: string | null;
  last_match: string | null;
  coverage_days: number;
}

export interface RatingPoint {
  match_id: string;
  timestamp: string;
  opponent: string;
  rating: number;
  goals: number;
  assists: number;
  result: Resultado;
}

export interface PlayerRatingEvolution {
  points: RatingPoint[] | null;
}

export interface PlayerConsistency {
  played: number;
  mean: number;
  std_dev: number;
  best: number;
  worst: number;
  volatility: number;
}

export interface PlayerDiscipline {
  red_cards: number;
  matches: number;
  clean_sheets: number;
}

export interface PlayerClubTenure {
  club_id: string;
  club_name: string;
  first_seen: string;
  last_seen: string;
  matches: number;
  days: number;
}

export interface EventSummary {
  label: string;
  count: number;
}

export interface PlayerEventBreakdown {
  player_id: string;
  events: EventSummary[] | null;
}
