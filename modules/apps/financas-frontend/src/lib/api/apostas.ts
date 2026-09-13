// Cliente do BFF apostas-api -- mesmo formato de asset-manager.ts.
export const APOSTAS_API_URL =
  import.meta.env.VITE_APOSTAS_API_URL || "http://localhost:8026";

export type StatusAposta = "pendente" | "green" | "red" | "cancelada";

export interface Aposta {
  id: string;
  contaId: string;
  descricao: string;
  valorApostado: number;
  odd?: number;
  status: StatusAposta;
  retornoObtido?: number;
  dataAposta: string;
  dataResultado?: string;
}

export interface NovaAposta {
  contaId: string;
  descricao: string;
  valorApostado: number;
  odd?: number;
  dataAposta: string;
}

export interface ResolverAposta {
  status: "green" | "red" | "cancelada";
  retornoObtido?: number;
  dataResultado: string;
}

class ApostasApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}
export { ApostasApiError as ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${APOSTAS_API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let codigo: string | undefined;
    try {
      const body = await res.json();
      codigo = body?.erro?.codigo ?? body?.codigo ?? body?.error;
    } catch {
      // sem corpo JSON.
    }
    throw new ApostasApiError(`apostas-api ${res.status}`, res.status, codigo);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listarApostas(conta?: string): Promise<Aposta[]> {
  const qs = conta ? `?conta=${conta}` : "";
  return request<{ apostas: Aposta[] }>(`/api/apostas${qs}`).then((r) => r.apostas);
}

export function registrarAposta(input: NovaAposta): Promise<{ id: string }> {
  return request<{ id: string }>("/api/apostas", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resolverAposta(id: string, input: ResolverAposta): Promise<void> {
  return request<void>(`/api/apostas/${id}/resolver`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
