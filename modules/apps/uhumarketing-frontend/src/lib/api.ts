// Cliente HTTP do uhumarketing-api.
//
// Uma decisão que vale explicar: as telas falam com `useStore()`, não com este
// arquivo. O cliente existe para o provider remoto (lib/storeRemote.tsx) poder
// ser trocado pelo mock (lib/store.tsx) sem nenhuma tela saber. Se uma tela
// importasse `fetchApi`, o modo Demo morreria na primeira divergência.
//
// Sobre o PUT /state: o editor de fluxo salva o grafo inteiro, e as telas fazem
// várias mutações em sequência (criar campanha → criar fluxo → apontar a
// campanha para o fluxo). Salvar o documento editorial inteiro numa chamada
// debounced é o que evita estados intermediários inválidos no banco.

import type {
  ActivityEvent,
  Campaign,
  Flow,
  Segment,
  Send,
  Template,
  User,
  Workspace,
} from "./types";

const BASE = (import.meta.env.VITE_UHU_API_URL ?? "http://localhost:8195").replace(/\/$/, "");
const KEY = import.meta.env.VITE_UHU_API_KEY ?? "dev-key";

export interface Bootstrap {
  workspace: Workspace;
  user: User;
  templates: Template[];
  segments: Segment[];
  campaigns: Campaign[];
  sends: Send[];
  flows: Flow[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        "X-API-Key": KEY,
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
    throw new ApiError(body?.error ?? `Erro ${res.status}`, res.status, body?.field);
  }
  return body as T;
}

export const api = {
  base: BASE,

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
    request<{ queued: number }>(`/campaigns/${id}/test`, { method: "POST" }),

  submitTemplate: (id: string) => request<Template>(`/templates/${id}/submit`, { method: "POST" }),

  optOut: (contactId: string) =>
    request<void>(`/contacts/${contactId}/opt-out`, { method: "POST" }),

  resetDemo: () => request<{ seeded: number }>("/dev/reset", { method: "POST" }),
  workerTick: () => request<{ processed: number }>("/dev/worker-tick", { method: "POST" }),

  simulateStatus: (messageId: string, status: string) =>
    request<{ applied: boolean }>("/dev/simulate-status", {
      method: "POST",
      body: JSON.stringify({ messageId, status }),
    }),
};
