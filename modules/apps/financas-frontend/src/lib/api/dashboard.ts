// Cliente do BFF dashboard-api (contracts/dashboard-api.md). O
// dashboard-api só guarda a COMPOSIÇÃO do layout -- os dados exibidos em
// cada bloco vêm direto de contas-api/transacional-api/asset-manager-api
// (ver src/modules/dashboard/blocos), então este cliente não tem nenhuma
// rota de "dados", só de layout.
export const DASHBOARD_API_URL =
  import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:8023";

export type TipoVisualizacao = "linha" | "barra" | "pizza" | "indicador" | "tabela";

export type FonteDados =
  | { tipo: "saldo-consolidado" }
  | { tipo: "gastos-por-categoria"; contaId?: string; periodoDias?: number }
  | { tipo: "evolucao-patrimonial"; periodoDias?: number }
  | { tipo: "extrato-conta"; contaId: string }
  | { tipo: "carteira-ativos"; contaId?: string };

export interface Bloco {
  id: string;
  tipoVisualizacao: TipoVisualizacao;
  titulo: string;
  fonteDados: FonteDados;
  posicao: { x: number; y: number };
  tamanho: { largura: number; altura: number };
}

export interface DashboardLayout {
  blocos: Bloco[];
}

class DashboardApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export { DashboardApiError as ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DASHBOARD_API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new DashboardApiError(`dashboard-api ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// 404 -> nenhum layout salvo ainda; o chamador cai para o layout padrão
// embutido (defaultLayout.ts), como o contrato define.
export async function buscarLayout(): Promise<DashboardLayout | null> {
  try {
    return await request<DashboardLayout>("/api/layout");
  } catch (err) {
    if (err instanceof DashboardApiError && err.status === 404) return null;
    throw err;
  }
}

export function salvarLayout(layout: DashboardLayout): Promise<DashboardLayout> {
  return request<DashboardLayout>("/api/layout", {
    method: "PUT",
    body: JSON.stringify(layout),
  });
}

export function removerLayout(): Promise<void> {
  return request<void>("/api/layout", { method: "DELETE" });
}
