// The vendor registry — the BFF's only Betano-specific code, and even
// that is a URL matcher. Adding bet365 later is one entry here plus a
// driver in bet-runner; the BFF never learns more about any house than
// "which hostnames belong to it".
export type VendorId = "betano";

export type VendorDef = {
  id: VendorId;
  label: string;
  // Hostnames a bet link for this vendor lives on (or redirects to —
  // short links included). matchHost below strips the port first.
  hostnames: string[];
};

export const VENDORS: VendorDef[] = [
  {
    id: "betano",
    label: "Betano",
    hostnames: [
      "betano.com",
      "betano.com.br",
      "www.betano.com",
      "www.betano.com.br",
      "betano.bet",
      "betano.bet.br",
    ],
  },
];

// null = unknown vendor, and POST /api/bets rejects the link — an
// unsupported house must fail loudly at submission, not silently at
// execution time.
export function resolveVendorFromUrl(rawUrl: string): VendorId | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Strip a trailing port, then allow exact matches or subdomains of a
  // known hostname (aposta.betano.com etc. all count as betano).
  for (const vendor of VENDORS) {
    for (const known of vendor.hostnames) {
      if (host === known || host.endsWith(`.${known}`)) return vendor.id;
    }
  }
  return null;
}

export function vendorLabel(id: VendorId): string {
  return VENDORS.find((v) => v.id === id)?.label ?? id;
}