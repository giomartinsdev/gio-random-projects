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
