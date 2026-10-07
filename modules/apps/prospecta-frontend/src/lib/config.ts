// Configuração do operador: URL da prospecta-api e X-API-Key. A chave é
// digitada em Configurações e persistida SÓ no localStorage (nunca vai pro
// bundle). O default da URL é o mesmo host local do dev (porta 8022 do contrato).
export interface ProspectaConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string;
  campaignId: string;
  workspace: string;
  plan: string;
  userName: string;
  userRole: string;
}

const CONFIG_KEY = "prospecta:config";

export const DEFAULT_API_URL =
  (import.meta.env.VITE_PROSPECTA_API_URL as string | undefined) ?? "http://localhost:8022";

const DEFAULTS: ProspectaConfig = {
  apiUrl: DEFAULT_API_URL,
  apiKey: "",
  companyId: "",
  campaignId: "",
  workspace: "Northwind Log",
  plan: "Plano Growth",
  userName: "Marina Reis",
  userRole: "Admin",
};

export function loadConfig(): ProspectaConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ProspectaConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: ProspectaConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // Storage indisponível (modo privado): a config vale só nesta aba.
  }
}

export function hasApiKey(cfg: ProspectaConfig): boolean {
  return cfg.apiKey.trim().length > 0;
}
