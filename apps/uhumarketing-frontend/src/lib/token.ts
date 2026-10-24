// O token de sessão, num lugar só.
//
// Ele não fica no estado do React porque o cliente HTTP também precisa dele —
// e um request disparado por um efeito (o flush debounced, por exemplo) não
// pode depender de um re-render para enxergar o token novo.

const KEY = "uhumarketing:token:v1";

export function readToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // sem storage: o token vale só até o reload.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Chaves do modo demonstração (store em localStorage e seletor de origem). Elas
// não são lidas por nada desde a migração, mas continuariam ocupando espaço e,
// pior, parecendo estado válido para quem abrir o DevTools. Remover na subida é
// o único jeito de limpar navegador de quem já usou a versão antiga.
const LEGACY_KEYS = [
  "uhumarketing:state:v1",
  "uhumarketing:data-source",
  "uhumarketing:session:v1",
];

export function dropLegacyStorage(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
