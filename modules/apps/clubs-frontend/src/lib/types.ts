// Tipos que espelham o que o clubs-api devolve. O payload de leitura nunca
// carrega termo técnico (sem "snapshot", "ingest", "cache") — a nomenclatura
// de apresentação é toda daqui para baixo.

export type Posicao = "goleiro" | "defensor" | "meio" | "atacante";
export type Resultado = "vitoria" | "empate" | "derrota";
export type TipoPartida = "liga" | "amistoso" | "playoff";

export interface ClubRef {
  club_id: string;
  nome: string;
  sigla: string;
  divisao: number;
  nivel: number;
  pontos: number;
  gols: number;
  gols_sofridos: number;
  jogos_sem_sofrer: number;
  sequencia_invicta: number;
  acompanhado: boolean;
}

export interface Adversario {
  club_id: string;
  nome: string;
  sigla: string;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  gols: number;
  gols_contra: number;
  ultimo_jogo: string;
}

export interface Club {
  club_id: string;
  nome: string;
  sigla: string;
  estadio: string;
  regiao_id: string;
  time_id: string;
  escudo_asset_id: string;
  cor_1: number;
  cor_2: number;
  cor_3: number;
  cor_4: number;
  acompanhado: boolean;
  atualizado_em: string;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  gols: number;
  gols_sofridos: number;
  jogos_sem_sofrer: number;
  pontos: number;
  divisao_atual: number;
  melhor_divisao: number;
  nivel: number;
  promocoes: number;
  rebaixamentos: number;
  aproveitamento: number;
  forma: string[] | null;
  sequencia: { vitorias: number; invicta: number };
  adversarios: Adversario[] | null;
}

export interface PlayerLine {
  club_id: string;
  player_id: string;
  gamertag: string;
  posicao: Posicao;
  nota: number;
  gols: number;
  assistencias: number;
  chutes: number;
  passes_certos: number;
  passes_tentados: number;
  desarmes_certos: number;
  desarmes_tentados: number;
  defesas: number;
  defesas_por_tipo?: Record<string, number> | null;
  segundos_jogados: number;
  melhor_em_campo: boolean;
  cartao_vermelho: boolean;
  jogo_sem_sofrer_gol: boolean;
}

export interface Match {
  id: string;
  match_id: string;
  timestamp: string;
  tipo: TipoPartida;
  rodada_playoff: string;
  clube_casa_id: string;
  clube_fora_id: string;
  clube_casa_nome: string;
  clube_casa_sigla: string;
  clube_fora_nome: string;
  clube_fora_sigla: string;
  gols_casa: number;
  gols_fora: number;
  houve_desistencia: boolean;
  resultado_casa: Resultado;
  nosso_lado: "casa" | "fora";
  nosso_resultado: Resultado;
  nossos_gols: number;
  gols_deles: number;
  adversario_id: string;
  adversario_nome: string;
  adversario_sigla: string;
  nota_agregada: number;
  jogadores?: PlayerLine[] | null;
  lances?: Array<{ player_id: string; gamertag: string; eventos: Array<{ rotulo: string; quantidade: number }>; inferido: boolean }> | null;
}

export interface SquadMember {
  player_id: string;
  gamertag: string;
  posicao: Posicao;
  jogos: number;
  gols: number;
  assistencias: number;
  nota: number;
  chutes: number;
  passes_certos: number;
  passes_tentados: number;
  desarmes_certos: number;
  desarmes_tentados: number;
  defesas: number;
  melhor_em_campo: number;
  segundos_jogados: number;
  forma: number[] | null;
  gols_por_jogo: number;
  assistencias_por_jogo: number;
  passes_precisao: number;
  desarmes_precisao: number;
  clean_sheets: number;
  cartoes_vermelhos: number;
  goleiro: boolean;
  defesas_por_tipo?: Record<string, number> | null;
  /** Alguém já reivindicou este pro (o hub não diz quem) — a tela de resgate
   * bloqueia os que já têm dono em vez de oferecer um botão que falharia. */
  resgatado?: boolean;
}

/** O estado do fetch sob demanda do elenco de um clube. A tela de resgate
 * grava o pedido e polla isto até `concluido_em` aparecer. */
/** O estado de um sync sob demanda. A SPA grava o pedido e polla isto até
 * `concluido_em` aparecer. O alvo pode ser um clube ou um jogador. */
export interface FetchRun {
  alvo: "clube" | "jogador";
  alvo_id: string;
  rotulo: string;
  rodando: boolean;
  jogadores: number;
  partidas: number;
  clubes: number;
  erro: string;
  concluido_em: string | null;
}

/** O estado da busca ao vivo de um termo na fonte. A busca do diretório é
 * local; esta alcança um clube que o hub ainda não viu. */
export interface SearchRun {
  termo: string;
  rodando: boolean;
  encontrados: number;
  erro: string;
  concluido_em: string | null;
}

export interface PlayerClub {
  club_id: string;
  nome: string;
  sigla: string;
  jogos: number;
  gols: number;
  assistencias: number;
  nota: number;
}

export interface PlayerMatch {
  match_id: string;
  timestamp: string;
  adversario_nome: string;
  resultado: Resultado;
  gols_casa: number;
  gols_fora: number;
  nota: number;
  gols: number;
  assistencias: number;
  chutes: number;
  passes_certos: number;
  passes_tentados: number;
  desarmes_certos: number;
  desarmes_tentados: number;
  segundos_jogados: number;
}

export interface PlayerProfile {
  player_id: string;
  gamertag: string;
  posicao: Posicao;
  club_id: string;
  clube_nome: string;
  club_sigla: string;
  jogos: number;
  gols: number;
  assistencias: number;
  nota: number;
  gols_por_jogo: number;
  assistencias_por_jogo: number;
  passes_precisao: number;
  desarmes_precisao: number;
  melhor_em_campo: number;
  segundos_jogados: number;
  clean_sheets: number;
  cartoes_vermelhos: number;
  goleiro: boolean;
  forma: number[] | null;
  defesas_por_tipo?: Record<string, number> | null;
  clubes: PlayerClub[] | null;
  verificado: boolean;
  partidas?: PlayerMatch[] | null;
}

export interface Snapshot {
  lido_em: string;
  nivel: number;
  divisao: number;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  gols: number;
  gols_sofridos: number;
  tamanho_elenco: number;
}

export interface Evolution {
  serie: Snapshot[] | null;
  total: number;
  atual: Snapshot | null;
  // Explícito para a UI explicar "o histórico cresce a cada atualização" em
  // vez de desenhar um gráfico de um ponto só.
  historico_curto: boolean;
}

export interface DivisionChange {
  detectado_em: string;
  de: number;
  para: number;
  tipo: "promocao" | "rebaixamento";
}

export interface RecordMatch {
  match_id: string;
  timestamp: string;
  adversario_nome: string;
  nossos_gols: number;
  gols_deles: number;
  total_gols: number;
}

export interface RecordLine {
  player_id: string;
  gamertag: string;
  match_id: string;
  timestamp: string;
  adversario_nome: string;
  nota: number;
  gols: number;
}

export interface Records {
  maior_goleada: RecordMatch | null;
  pior_derrota: RecordMatch | null;
  jogo_com_mais_gols: RecordMatch | null;
  melhor_nota: RecordLine | null;
  mais_gols_em_um_jogo: RecordLine | null;
  maior_sequencia_vitorias: number;
  jogos_sem_sofrer_gol: number;
  total_partidas: number;
}

export interface HeadToHead {
  clube_a: ClubRef;
  clube_b: ClubRef;
  jogos: number;
  vitorias_a: number;
  empates: number;
  derrotas_a: number;
  gols_a: number;
  gols_b: number;
  forma_a: string[] | null;
  partidas: Match[] | null;
}

export interface Announcement {
  id: string;
  tipo: "resultado" | "ranking" | "jogador" | "novidade";
  titulo: string;
  texto: string;
  referencia_id: string;
  icone: string;
  gerado_em: string;
}

export interface RankPlayer {
  player_id: string;
  gamertag: string;
  posicao: Posicao;
  club_id: string;
  clube_nome: string;
  club_sigla: string;
  jogos: number;
  gols: number;
  assistencias: number;
  nota: number;
  gols_por_jogo: number;
  verificado: boolean;
}

export interface WatchEntry {
  club_id: string;
  nome: string;
  sigla: string;
  divisao: number;
  nivel: number;
  seguindo_desde: string;
  origem: "proprio" | "rival" | "rival_de_rival" | "manual";
}

export interface NotificationPrefs {
  canal: string;
  resumo_periodico: boolean;
  recordes_e_divisoes: boolean;
  resultado_partidas: boolean;
}

export interface ClaimedPro {
  club_id: string;
  player_id: string;
  verificado: boolean;
}

export interface SyncRun {
  rodando: boolean;
  nivel: number;
  total: number;
  concluidos: number;
  atual: string;
  novos: string[] | null;
  iniciado_em: string;
  concluido_em: string;
}

export interface AdminStatus {
  clubes_total: number;
  clubes_acompanhados: number;
  clubes_pendentes: number;
  partidas: number;
  jogadores: number;
  snapshots: number;
  mudancas_divisao: number;
  anuncios: number;
  ultima_partida: string | null;
  por_divisao: Record<string, number> | null;
  top_clubes: ClubRef[] | null;
}
