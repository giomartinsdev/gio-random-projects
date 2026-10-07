import { loadConfig, type ProspectaConfig } from "./config";
import type {
  AgentRunEvent,
  AuthSession,
  Campaign,
  CampaignInput,
  Company,
  Conversation,
  ConversationDetail,
  Icp,
  Lead,
  LeadDetail,
  LoginInput,
  MessageInput,
  Paged,
  SignupInput,
} from "./types";

// Cliente HTTP da prospecta-api (BFF/ACL). O backend aceita DUAS identidades:
//   · sessão por cookie HttpOnly (modo cliente) — vai com credentials:"include";
//   · X-API-Key (modo operador) — a chave vive no localStorage e é lida na hora
//     da request, então trocá-la em Configurações vale sem reload.
// Toda chamada manda os dois: quem tem sessão não precisa de chave e vice-versa.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiUrl(cfg: ProspectaConfig, path: string): string {
  return `${cfg.apiUrl.replace(/\/$/, "")}${path}`;
}

function headers(cfg: ProspectaConfig, json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (cfg.apiKey.trim()) h["X-API-Key"] = cfg.apiKey.trim();
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = loadConfig();
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg, path), {
      method,
      credentials: "include",
      headers: headers(cfg, body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "não foi possível falar com a prospecta-api");
  }
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? `falha (${res.status})`);
  return payload as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});

export const api = {
  // ---- Auth (sessão por cookie; credentials:"include" em toda request) ----
  signup(input: SignupInput): Promise<AuthSession> {
    return post("/auth/signup", input);
  },
  login(input: LoginInput): Promise<AuthSession> {
    return post("/auth/login", input);
  },
  me(): Promise<AuthSession> {
    return get("/auth/me");
  },
  logout(): Promise<void> {
    return request<void>("POST", "/auth/logout");
  },

  // ---- Company & ICP ----
  createCompany(input: { name: string; site: string; description: string }): Promise<{ id: string; status: string }> {
    return post("/companies", input);
  },
  company(id: string): Promise<Company> {
    return get(`/companies/${id}`);
  },
  defineIcp(companyId: string, icp: Icp): Promise<{ id?: string; status: string }> {
    return post(`/companies/${companyId}/icp`, icp);
  },

  // ---- Campaigns ----
  createCampaign(input: CampaignInput): Promise<{ id: string; status: string }> {
    return post("/campaigns", input);
  },
  campaigns(): Promise<Paged<Campaign>> {
    return get("/campaigns");
  },
  campaign(id: string): Promise<Campaign> {
    return get(`/campaigns/${id}`);
  },
  startCampaign(id: string): Promise<{ status: string }> {
    return post(`/campaigns/${id}/start`);
  },

  // ---- Leads ----
  leads(filter: { campaign_id?: string; status?: string; fit_min?: number } = {}): Promise<Paged<Lead>> {
    const qs = new URLSearchParams();
    if (filter.campaign_id) qs.set("campaign_id", filter.campaign_id);
    if (filter.status) qs.set("status", filter.status);
    if (filter.fit_min != null) qs.set("fit_min", String(filter.fit_min));
    const suffix = qs.toString() ? `?${qs}` : "";
    return get(`/leads${suffix}`);
  },
  lead(id: string): Promise<LeadDetail> {
    return get(`/leads/${id}`);
  },
  qualifyLead(id: string, fit: number): Promise<{ status: string }> {
    return post(`/leads/${id}/qualify`, { fit });
  },

  // ---- Conversations & Messages ----
  conversations(): Promise<{ items: Conversation[] }> {
    return get("/conversations");
  },
  conversation(id: string): Promise<ConversationDetail> {
    return get(`/conversations/${id}`);
  },
  sendMessage(input: MessageInput): Promise<{ id?: string; status: string }> {
    return post("/messages", input);
  },
  approveMessage(id: string): Promise<{ status: string }> {
    return post(`/messages/${id}/approve`);
  },

  health(): Promise<{ status: string }> {
    return get("/healthz");
  },
} as const;

// Feed SSE de /agent/activity. O EventSource nativo não manda header, então
// lemos o stream via fetch e parseamos os frames `event:`/`data:` à mão —
// mantendo o X-API-Key no header (e não na query string).
export interface ActivityStreamHandle {
  close(): void;
}

export function openActivityStream(
  onEvent: (event: AgentRunEvent) => void,
  onError?: (err: unknown) => void,
): ActivityStreamHandle {
  const cfg = loadConfig();
  const controller = new AbortController();
  let closed = false;

  (async () => {
    try {
      const res = await fetch(apiUrl(cfg, "/agent/activity"), {
        credentials: "include",
        headers: { ...headers(cfg), Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new ApiError(res.status, `stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            onEvent(JSON.parse(dataLine.slice(5).trim()) as AgentRunEvent);
          } catch {
            // Frame parcial/inválido: ignora.
          }
        }
      }
    } catch (err) {
      if (!closed) onError?.(err);
    }
  })();

  return {
    close() {
      closed = true;
      controller.abort();
    },
  };
}
