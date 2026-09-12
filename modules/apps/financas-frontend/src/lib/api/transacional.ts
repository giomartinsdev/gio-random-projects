// Cliente do BFF transacional-api (contracts/transacional-api.md).
export const TRANSACIONAL_API_URL =
  import.meta.env.VITE_TRANSACIONAL_API_URL || "http://localhost:8021";

export type TipoTransacao = "entrada" | "saida";

export interface Transacao {
  id: string;
  contaId: string;
  tipo: TipoTransacao;
  valor: number;
  data: string;
  categoria: string;
  descricao?: string;
  anexoImagem?: string;
  criadoEm: string;
  atualizadoEm: string;
}

export interface FiltroTransacoes {
  conta?: string;
  de?: string;
  ate?: string;
  categoria?: string;
}

export interface NovaTransacao {
  contaId: string;
  tipo: TipoTransacao;
  valor: number;
  data: string;
  categoria: string;
  descricao?: string;
  anexoImagem?: string;
}

class TransacionalApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}
export { TransacionalApiError as ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TRANSACIONAL_API_URL}${path}`, {
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
      // sem corpo JSON de erro.
    }
    throw new TransacionalApiError(`transacional-api ${res.status}`, res.status, codigo);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listarTransacoes(filtro: FiltroTransacoes = {}): Promise<Transacao[]> {
  const params = new URLSearchParams();
  if (filtro.conta) params.set("conta", filtro.conta);
  if (filtro.de) params.set("de", filtro.de);
  if (filtro.ate) params.set("ate", filtro.ate);
  if (filtro.categoria) params.set("categoria", filtro.categoria);
  const qs = params.toString();
  return request<Transacao[]>(`/api/transacoes${qs ? `?${qs}` : ""}`);
}

export function criarTransacao(input: NovaTransacao): Promise<Transacao> {
  return request<Transacao>("/api/transacoes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function editarTransacao(
  id: string,
  input: Partial<NovaTransacao>,
): Promise<Transacao> {
  return request<Transacao>(`/api/transacoes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function excluirTransacao(id: string): Promise<void> {
  return request<void>(`/api/transacoes/${id}`, { method: "DELETE" });
}

// FR-023: aceita o arquivo como base64 no corpo do POST/PATCH. Nenhum
// processamento de OCR ocorre nesta fase -- só armazenamos.
export function arquivoParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
