// Tipos e chamadas da harness-api, exatamente como em
// specs/001-harness-corporativo/contracts/api.md -- os campos espelham o
// JSON (snake_case incluso) para não haver tradução nenhuma na borda.

const API_BASE = import.meta.env.VITE_HARNESS_API_URL ?? "";

export { API_BASE };

// ─── Erro padrão ──────────────────────────────────────────────────────
// Toda falha vem como {"erro":{"codigo","mensagem"}} (contrato); 422
// acrescenta detalhes[{campo,problema}] e o 409 de edição traz `sessao`
// com o estado vigente. O campo `detalhes` pode chegar dentro de `erro`
// ou no topo do corpo -- a leitura aceita os dois.

export type DetalheValidacao = { campo: string; problema: string };

export class ApiError extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: string,
    readonly detalhes?: DetalheValidacao[],
    readonly sessao?: Sessao,
  ) {
    super(mensagem);
    this.name = "ApiError";
  }
}

type CorpoErro = {
  erro?: { codigo?: string; mensagem?: string; detalhes?: DetalheValidacao[] };
  detalhes?: DetalheValidacao[];
  sessao?: Sessao;
};

async function paraErro(response: Response): Promise<ApiError> {
  const corpo = (await response.json().catch(() => null)) as CorpoErro | null;
  const erro = corpo?.erro;
  return new ApiError(
    erro?.mensagem ?? `erro ${response.status}`,
    response.status,
    erro?.codigo ?? "desconhecido",
    erro?.detalhes ?? corpo?.detalhes,
    corpo?.sessao,
  );
}

// Toda chamada vai com credentials:"include" -- é o que faz o cookie do
// Cloudflare Access atravessar a origem cruzada (harness-frontend →
// harness-api) e chegar à validação do JWT na API. Um fetch() sem isso
// sai silenciosamente deslogado.
async function request<T>(caminho: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${caminho}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw await paraErro(response);
  return (await response.json()) as T;
}

// ─── Tipos dos endpoints ──────────────────────────────────────────────

export type Usuario = { email: string; nome: string };

export type StatusSessao = "em_andamento" | "entregue" | "arquivada";

export type Sessao = {
  id: number;
  titulo: string;
  objetivo: string;
  repo: string | null;
  contexto_md: string | null;
  proximos_passos_md: string | null;
  status: StatusSessao;
  criador: Usuario;
  dono_atual: Usuario;
  pr_link: string | null;
  origem_id: number | null;
  criado_em: number;
  atualizado_em: number;
};

// Item de GET /api/sessoes (lista do time, com resumo do objetivo).
export type SessaoLista = {
  id: number;
  titulo: string;
  repo: string | null;
  status: StatusSessao;
  dono_atual: Usuario;
  criador: Usuario;
  origem_id: number | null;
  atualizado_em: number;
  resumo_objetivo: string;
};

// Resumos embutidos no detalhe (GET /api/sessoes/{id}).
export type ResumoOrigem = { id: number; titulo: string; status: StatusSessao };
export type ResumoExtensao = { id: number; titulo: string; status: StatusSessao; dono_atual: Usuario };

export type SessaoDetalhe = Sessao & {
  origem?: ResumoOrigem | null;
  extensoes?: ResumoExtensao[];
};

export type TipoEvento =
  | "criacao"
  | "retomada"
  | "atualizacao_contexto"
  | "extensao_criada"
  | "status_mudou";

// Payload muda com o tipo (data-model.md); união discriminada por `tipo`
// para a timeline ler cada caso com tipo cheio.
export type Evento = {
  id: number;
  autor: Usuario;
  criado_em: number;
} & (
  | { tipo: "criacao"; payload: { titulo: string } }
  | { tipo: "retomada"; payload: { dono_anterior: string; dono_novo: string } }
  | { tipo: "atualizacao_contexto"; payload: { campos: string[]; force: boolean } }
  | { tipo: "extensao_criada"; payload: { extensao_id: number; titulo: string } }
  | { tipo: "status_mudou"; payload: { de: StatusSessao; para: StatusSessao; pr_link?: string | null } }
);

export type NovaSessaoInput = {
  titulo: string;
  objetivo: string;
  repo?: string;
  contexto_md?: string;
  proximos_passos_md?: string;
  origem_id?: number;
};

// PATCH /api/sessoes/{id} -- concorrência otimista (contrato, US-2).
export type PatchSessaoInput = {
  contexto_md?: string;
  proximos_passos_md?: string;
  base_atualizado_em?: number;
  force?: boolean;
};

export type AcaoStatus = "entregar" | "arquivar" | "reabrir";

export type FiltrosSessoes = {
  status?: StatusSessao[];
  dono?: string;
  origem?: number;
};

// ─── Chamadas ─────────────────────────────────────────────────────────

export function getMe(): Promise<Usuario> {
  return request("/api/me");
}

export function listSessoes(filtros: FiltrosSessoes = {}): Promise<{ sessoes: SessaoLista[] }> {
  const query = new URLSearchParams();
  for (const status of filtros.status ?? []) query.append("status", status);
  if (filtros.dono) query.set("dono", filtros.dono);
  if (filtros.origem != null) query.set("origem", String(filtros.origem));
  const qs = query.toString();
  return request(`/api/sessoes${qs ? `?${qs}` : ""}`);
}

export function getSessao(id: number): Promise<SessaoDetalhe> {
  return request(`/api/sessoes/${id}`);
}

export function createSessao(input: NovaSessaoInput): Promise<Sessao> {
  return request("/api/sessoes", { method: "POST", body: JSON.stringify(input) });
}

export function patchSessao(id: number, input: PatchSessaoInput): Promise<Sessao> {
  return request(`/api/sessoes/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Corpo "{}": a retomada não tem campos (contrato), mas um corpo JSON
// vazio deixa o decode do lado da API simples.
export function retomarSessao(id: number): Promise<Sessao> {
  return request(`/api/sessoes/${id}/retomar`, { method: "POST", body: "{}" });
}

export function mudarStatusSessao(id: number, acao: AcaoStatus, pr_link?: string): Promise<Sessao> {
  return request(`/api/sessoes/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ acao, pr_link }),
  });
}

export function listEventos(id: number): Promise<{ eventos: Evento[] }> {
  return request(`/api/sessoes/${id}/eventos`);
}