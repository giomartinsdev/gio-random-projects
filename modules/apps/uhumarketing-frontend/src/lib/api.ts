// Cliente HTTP do uhumarketing-api.
//
// Toda requisição autenticada leva `Authorization: Bearer <token de sessão>`.
// O token não identifica só a pessoa: é ele que resolve o workspace no
// servidor. Não existe workspace no corpo de nenhuma chamada — se existisse, o
// cliente poderia escolher de quem é o dado.
//
// Sobre o PUT /state: o editor de fluxo salva o grafo inteiro, e as telas fazem
// várias mutações em sequência (criar campanha → criar fluxo → apontar a
// campanha para o fluxo). Salvar o documento editorial inteiro numa chamada
// debounced é o que evita estados intermediários inválidos no banco.

import type {
  ActivityEvent,
  Campaign,
  Contact,
  Flow,
  Segment,
  Send,
  Template,
  User,
  Workspace,
} from "./types";
import { clearToken, readToken } from "./token";

const BASE = (import.meta.env.VITE_UHU_API_URL ?? "http://localhost:8195").replace(/\/$/, "");

/** Conta devolvida por cadastro/login. O token é opaco; só o servidor o lê. */
export interface Account {
  userId: string;
  workspaceId: string;
  name: string;
  email: string;
  company: string;
  token: string;
}

export interface Bootstrap {
  workspace: Workspace;
  user: User;
  templates: Template[];
  segments: Segment[];
  campaigns: Campaign[];
  sends: Send[];
  flows: Flow[];
  contacts: Contact[];
  activity: ActivityEvent[];
  provider: {
    name: string;
    mode: string;
    live: boolean;
    hasNumber: boolean;
    note: string;
  };
  /** Funil diário agregado no servidor (todos os envios, não a página). */
  series: { date: string; sent: number; delivered: number; read: number; replied: number }[];
  /** Por que a fila de cada campanha em execução está (ou não) parada. */
  queue: {
    campaignId: string;
    queued: number;
    blockedBy: "" | "window" | "empty";
    nextOpenAt?: string;
    timezone?: string;
  }[];
  serverTime: string;
}

export interface EditorialState {
  workspace: Workspace;
  templates: Template[];
  segments: Segment[];
  campaigns: Campaign[];
  flows: Flow[];
}

export class ApiError extends Error {
  field?: string;
  status: number;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const token = readToken();
  const needsAuth = init?.auth !== false;

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(needsAuth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(`Não consegui falar com ${BASE}. O backend está no ar?`, 0);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // 401 significa que o token morreu: apagar aqui evita que cada tela tenha
    // que lembrar de fazer isso, e o próximo request já sai sem credencial.
    if (res.status === 401) clearToken();
    throw new ApiError(body?.error ?? `Erro ${res.status}`, res.status, body?.field);
  }
  return body as T;
}

export const api = {
  base: BASE,

  signup: (name: string, email: string, password: string, company: string) =>
    request<Account>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password, company }),
      auth: false,
    }),

  login: (email: string, password: string) =>
    request<Account>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      auth: false,
    }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  me: () =>
    request<{ userId: string; workspaceId: string; name: string; email: string }>("/auth/me"),

  bootstrap: () => request<Bootstrap>("/bootstrap"),

  putState: (doc: EditorialState) =>
    request<Bootstrap>("/state", { method: "PUT", body: JSON.stringify(doc) }),

  launchCampaign: (id: string) =>
    request<{ campaignId: string; queued: number; skipped: number; duplicate: number }>(
      `/campaigns/${id}/launch`,
      { method: "POST" },
    ),

  pauseCampaign: (id: string) => request<void>(`/campaigns/${id}/pause`, { method: "POST" }),
  resumeCampaign: (id: string) => request<void>(`/campaigns/${id}/resume`, { method: "POST" }),

  testSend: (id: string) =>
    request<{ campaignId: string; queued: number; skipped: number; duplicate: number }>(
      `/campaigns/${id}/test`,
      { method: "POST" },
    ),

  submitTemplate: (id: string) => request<Template>(`/templates/${id}/submit`, { method: "POST" }),

  syncTemplate: (id: string) => request<Template>(`/templates/${id}/sync`, { method: "POST" }),

  checkChannel: () =>
    request<{
      live: boolean;
      ok: boolean;
      number?: string;
      verifiedName?: string;
      note: string;
    }>("/channel"),

  createContact: (contact: {
    name: string;
    phone: string;
    email?: string;
    city?: string;
    uf?: string;
    tags?: string[];
    optIn: boolean;
    optInSource?: string;
  }) => request<Contact>(`/contacts`, { method: "POST", body: JSON.stringify(contact) }),

  optOut: (contactId: string) =>
    request<void>(`/contacts/${contactId}/opt-out`, { method: "POST" }),

  /** Apaga os dados DA CONTA (não a conta). O workspace vem da sessão. */
  resetAccount: () => request<{ cleared: boolean }>("/dev/reset", { method: "POST" }),

  workerTick: () => request<{ processed: number }>("/dev/worker-tick", { method: "POST" }),

  simulateStatus: (messageId: string, status: string) =>
    request<{ applied: boolean }>("/dev/simulate-status", {
      method: "POST",
      body: JSON.stringify({ messageId, status }),
    }),
};
