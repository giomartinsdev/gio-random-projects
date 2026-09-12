// Cliente do BFF asset-manager-api (contracts/asset-manager-api.md).
export const ASSET_MANAGER_API_URL =
  import.meta.env.VITE_ASSET_MANAGER_API_URL || "http://localhost:8022";

export type StatusAtivo = "aberta" | "encerrada";
export type TipoMovimento = "compra" | "venda" | "provento";

export interface Ativo {
  id: string;
  contaId: string;
  ticker: string;
  quantidadeAtual: number;
  custoMedio: number;
  custoTotal: number;
  ultimaCotacao: number;
  ultimaCotacaoEm: string;
  desatualizada: boolean;
  valorMercadoAtual: number;
  proventosRecebidos: number;
  rentabilidadeAbsoluta: number;
  rentabilidadePercentual: number;
  status: StatusAtivo;
  criadoEm: string;
  atualizadoEm: string;
}

export interface AtivoMovimento {
  id: string;
  ativoId: string;
  tipo: TipoMovimento;
  quantidade?: number;
  precoUnitario?: number;
  valorProvento?: number;
  data: string;
  resultadoRealizado?: number;
  criadoEm: string;
}

export interface NovoAtivo {
  contaId: string;
  ticker: string;
  quantidade: number;
  precoUnitario: number;
  data: string;
}

export interface NovoMovimento {
  tipo: TipoMovimento;
  quantidade?: number;
  precoUnitario?: number;
  valorProvento?: number;
  data: string;
}

export interface Cotacao {
  ticker: string;
  valor: number;
  desatualizada: boolean;
  em: string;
}

class AssetManagerApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}
export { AssetManagerApiError as ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ASSET_MANAGER_API_URL}${path}`, {
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
      // sem corpo JSON.
    }
    throw new AssetManagerApiError(`asset-manager-api ${res.status}`, res.status, codigo);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listarAtivos(conta?: string): Promise<Ativo[]> {
  const qs = conta ? `?conta=${conta}` : "";
  return request<{ ativos: Ativo[] }>(`/api/ativos${qs}`).then((r) => r.ativos);
}

export function cadastrarAtivo(input: NovoAtivo): Promise<Ativo> {
  return request<Ativo>("/api/ativos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function registrarMovimento(
  ativoId: string,
  input: NovoMovimento,
): Promise<AtivoMovimento> {
  return request<AtivoMovimento>(`/api/ativos/${ativoId}/movimentos`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listarMovimentos(ativoId: string): Promise<AtivoMovimento[]> {
  return request<{ movimentos: AtivoMovimento[] }>(`/api/ativos/${ativoId}/movimentos`).then(
    (r) => r.movimentos,
  );
}

export function buscarCotacoes(tickers: string[]): Promise<Cotacao[]> {
  return request<{ cotacoes: Cotacao[] }>(`/api/cotacoes?tickers=${tickers.join(",")}`).then(
    (r) => r.cotacoes,
  );
}
