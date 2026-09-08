// Money is integer cents everywhere in this system (no floats). These
// two helpers are the only places cents touch the outside world:
// BRL formatting for the UI/runner ("R$ 10,00" / "10,00" for a betano
// stake input) and parsing what the settings form sends back.

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBRLPrefixed(cents: number): string {
  return `R$ ${formatBRL(cents)}`;
}

// Accepts "10", "10,50", "10.50", "R$ 10,50" — what an <input> sends.
// Returns null when nothing numeric is there; cents must be >= 0 and
// integral (a fraction of a cent has no Betano input to live in).
export function parseBRLToCents(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/^r\$/i, "")
    .trim()
    // A pt-BR decimal is comma-first; a lone dot is a decimal separator
    // too (an API client's "10.50"). Neither thousands separators nor
    // mixed separators are supported — keep the input honest.
    .replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}