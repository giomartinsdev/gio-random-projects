// Configuração do operador: URL da prospecta-api, X-API-Key e o id da empresa.
// A chave é digitada em Configurações e persistida SÓ no localStorage (nunca
// vai pro bundle). Sem valores de negócio inventados: o que não foi preenchido
// fica vazio e as telas mostram o estado "Configure a API".
export interface ProspectaConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string;
}

const CONFIG_KEY = "prospecta:config";
const CONFIG_EVENT = "prospecta:config-changed";

// Em dev aponta para a prospecta-api local (:8022 do contrato); em produção,
// para o host de deploy. VITE_PROSPECTA_API_URL, se definido, tem precedência.
export const DEFAULT_API_URL =
  (import.meta.env.VITE_PROSPECTA_API_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8022" : "https://prospecta-api.giomartins.dev");

const DEFAULTS: ProspectaConfig = {
  apiUrl: DEFAULT_API_URL,
  apiKey: "",
  companyId: "",
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
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONFIG_EVENT));
}

// Notifica quem estiver montado quando a config muda (saveConfig ou outra aba).
export function subscribeConfig(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(CONFIG_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CONFIG_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// Uma tela só pode mostrar dados reais quando há chave e empresa definidas.
export function isConfigured(cfg: ProspectaConfig): boolean {
  return cfg.apiKey.trim().length > 0 && cfg.companyId.trim().length > 0;
}
