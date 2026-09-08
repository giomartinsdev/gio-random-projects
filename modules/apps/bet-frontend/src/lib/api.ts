// The BFF surface, typed. Every call goes with credentials:"include" --
// that's what makes the Cloudflare Access cookie ride along cross-origin
// and what makes the edge inject the Cf-Access-Jwt-Assertion header the
// BFF validates. A bare fetch() without it silently logs the user out.

const API_BASE = import.meta.env.VITE_BET_API_URL ?? "";

// The Access team domain this zone belongs to -- the logout hop goes to
// the team's logout endpoint (same pattern as hub-frontend's auth).
const TEAM_DOMAIN = "workwithgiomartinsdev.cloudflareaccess.com";

export type Me = {
  email: string;
  unitValueCents: number;
  credentials: string[];
  knownVendors: { id: string; label: string }[];
};

export type BetStatus = "queued" | "running" | "succeeded" | "failed";

export type BetReceipt = {
  steps?: string[];
  screenshotJpeg?: string;
  betRef?: string;
  balanceCents?: number;
  dryRun?: boolean;
};

export type Bet = {
  id: string;
  vendor: string;
  url: string;
  units: number;
  stakeCents: number;
  status: BetStatus;
  error: string | null;
  receipt: BetReceipt | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SavedCredential = {
  vendor: string;
  username: string;
  updatedAt: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `erro ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

/**
 * The auth probe. redirect:"manual" turns Access's login bounce into an
 * opaque response (status 0) -- anything that isn't a clean 200 counts
 * as "not logged in", exactly the trick the hub uses on its own /sso.
 */
export async function probeMe(): Promise<Me | null> {
  try {
    const response = await fetch(`${API_BASE}/api/me`, {
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
    });
    if (response.status !== 200) return null;
    return (await response.json()) as Me;
  } catch {
    return null;
  }
}

/**
 * The login hop: a top-level navigation through bet-api's /auth/sso,
 * which Cloudflare Access intercepts (Google one-click, 24h team
 * session). Google's login page can't complete inside the hub's
 * iframe, so when embedded we break out to the top window.
 */
export function goToSso() {
  const target = `${API_BASE}/auth/sso?return=${encodeURIComponent(window.location.href)}`;
  if (window.top && window.top !== window.self) {
    window.top.location.href = target;
  } else {
    window.location.href = target;
  }
}

// Clears the Access session itself (the hub's session dies with it --
// they're the same team cookie).
export function logout(): void {
  window.location.href = `https://${TEAM_DOMAIN}/cdn-cgi/access/logout`;
}

// ─── API calls ────────────────────────────────────────────────────────

export function getMe(): Promise<Me> {
  return request<Me>("/api/me");
}

export function saveUnitValue(cents: number): Promise<{ unitValueCents: number }> {
  return request("/api/me/settings", { method: "PUT", body: JSON.stringify({ unitValueCents: cents }) });
}

export function listCredentials(): Promise<{ credentials: SavedCredential[] }> {
  return request("/api/credentials");
}

export function saveCredential(vendor: string, username: string, password: string): Promise<{ saved: boolean }> {
  return request(`/api/credentials/${vendor}`, {
    method: "PUT",
    body: JSON.stringify({ username, password }),
  });
}

export function deleteCredential(vendor: string): Promise<{ deleted: boolean }> {
  return request(`/api/credentials/${vendor}`, { method: "DELETE" });
}

export function placeBet(url: string, units: number): Promise<Bet> {
  return request("/api/bets", { method: "POST", body: JSON.stringify({ url, units }) });
}

export function listBets(): Promise<{ bets: Bet[] }> {
  return request("/api/bets");
}