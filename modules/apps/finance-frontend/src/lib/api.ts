// finance-api is a separate origin (its own container, its own hostname)
// -- VITE_FINANCE_API_URL is baked in at build time (see the CI's
// ts-frontend-ci-cd.yml) and empty locally, where the dev server's own
// proxy (vite.config.ts) makes relative paths reach finance-api anyway.
const API_URL = import.meta.env.VITE_FINANCE_API_URL ?? "";

// The house envelope the ACL speaks on both sides of its boundary
// (spec §4.1): {action, payload}. `finance.*` actions are relayed to
// domain-api, which owns persistence.
export type Envelope = { action: string; payload: Record<string, unknown> };

// The relayed outcome. Mirrors RelayResponse in
// finance-api/src/finance_api/presentation/schemas.py: `entity_id` and
// `error` appear only when they apply (exclude_none on the server).
export type RelayOutcome = {
  // The HTTP status the ACL answered with. Only `written` is 200; the
  // other two keep the status domain-api gave them.
  http: number;
  command_id: string;
  // "written" (confirmed) | "failed" (422, rejected) | "queued" (504:
  // timeout is NOT failure -- the command may still land).
  status: "written" | "failed" | "queued" | string;
  entity_id?: string;
  error?: string;
};

// A transport/auth failure, distinct from a *rejected command*: a 422
// outcome is a RelayOutcome with status "failed", never a thrown error.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Every write route needs X-API-Key (spec §12.3); the key's label names
// the caller in the audit trail. In the browser the key is a temporary
// operator credential the user pastes for this session, kept only in
// sessionStorage -- it is NOT baked into the bundle.
const KEY_STORAGE = "finance:api-key";

export function readApiKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function rememberApiKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage disabled (private mode): the key still works for this page's
    // lifetime, it just is not remembered across reloads.
  }
}

async function jsonHeaders(): Promise<HeadersInit> {
  const key = readApiKey();
  return {
    "content-type": "application/json",
    ...(key ? { "x-api-key": key } : {}),
  };
}

export const api = {
  // Public, no key (spec §10.6) -- the page's own liveness probe.
  async health(): Promise<{ status: string }> {
    const res = await fetch(`${API_URL}/healthz`);
    if (!res.ok) throw new ApiError(res.status, `offline (${res.status})`);
    return res.json() as Promise<{ status: string }>;
  },

  // The write door. 200 written / 422 failed / 504 queued are all returned
  // as a RelayOutcome (they are the documented contract, not errors); only
  // 401 (bad key) and 502 (unreachable upstream) throw, so a caller can
  // tell "the command was rejected" from "the request never got there".
  async submit(envelope: Envelope): Promise<RelayOutcome> {
    const res = await fetch(`${API_URL}/commands`, {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify(envelope),
    });
    const body = (await res.json().catch(() => null)) as
      | (Omit<RelayOutcome, "http"> & { error?: string })
      | null;
    if (res.status === 401 || res.status === 502) {
      throw new ApiError(res.status, body?.error ?? `falha na requisição (${res.status})`);
    }
    if (!body || typeof body.command_id !== "string") {
      throw new ApiError(res.status, body?.error ?? `resposta inesperada (${res.status})`);
    }
    return { http: res.status, ...body };
  },
};
