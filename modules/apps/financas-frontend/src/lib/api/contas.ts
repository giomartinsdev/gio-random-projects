// Cliente do BFF contas-api (ver specs/002-gestao-financeira-modular/
// contracts/contas-api.md). Sem SDK gerado -- os 4 contratos são
// pequenos o bastante para chamar fetch direto, credentials:"include"
// carrega o cookie de Cloudflare Access através da origem cruzada.
export const CONTAS_API_URL =
  import.meta.env.VITE_CONTAS_API_URL || "http://localhost:8020";

export type TipoConta = "corrente" | "investimento";
export type StatusConta = "ativa" | "arquivada";

export interface Conta {
  id: string;
  nome: string;
  tipo: TipoConta;
  status: StatusConta;
  criadoEm: string;
  atualizadoEm: string;
}

export interface SaldoConta {
  contaId: string;
  saldo: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CONTAS_API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let codigo: string | undefined;
    try {
      const body = await res.json();
      codigo = body?.codigo ?? body?.error;
    } catch {
      // corpo de erro sem JSON -- segue só com o status.
    }
    throw new ApiError(`contas-api ${res.status}`, res.status, codigo);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listarContas(status?: StatusConta): Promise<Conta[]> {
  const qs = status ? `?status=${status}` : "";
  return request<Conta[]>(`/api/contas${qs}`);
}

export function criarConta(input: { nome: string; tipo: TipoConta }): Promise<Conta> {
  return request<Conta>("/api/contas", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function editarConta(id: string, nome: string): Promise<Conta> {
  return request<Conta>(`/api/contas/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ nome }),
  });
}

export function arquivarConta(id: string): Promise<Conta> {
  return request<Conta>(`/api/contas/${id}/arquivar`, { method: "POST" });
}

export function saldoConta(id: string): Promise<SaldoConta> {
  return request<SaldoConta>(`/api/contas/${id}/saldo`);
}
