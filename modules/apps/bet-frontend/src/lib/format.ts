// Money is integer cents everywhere in this system (bet-api's
// lib/money.ts is the BFF-side family; the runner has its own copy).
// This is the frontend's view of the same rule: cents in, pt-BR out.

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

// A quick date/time in the user's locale — the history table shows it.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// The inverse of formatBRL for the settings form: the user types
// "10,50" (or "10", or "R$ 10,50"), we store cents. null = not a valid
// amount — the form just re-asks, nothing is sent to the BFF.
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0.01) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}