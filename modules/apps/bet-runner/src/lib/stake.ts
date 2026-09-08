// Stake formatting — the only money logic in the runner. Betano's
// stake input wants a pt-BR decimal ("10,50"); cents are the only
// currency representation anywhere in this system (see bet-api's
// lib/money.ts for the rest of the family — this is the runner's own
// copy, no shared package in this repo).
export function centsToStakeString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 1) {
    throw new Error(`stake must be an integer >= 1 cent, got ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole},${String(frac).padStart(2, "0")}`;
}

// Best-effort parse of a balance shown by the site ("R$ 1.234,56") —
// receipt sugar, not load-bearing: null just means "couldn't read it".
export function parseBalanceToCents(text: string): number | null {
  const cleaned = text.replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}