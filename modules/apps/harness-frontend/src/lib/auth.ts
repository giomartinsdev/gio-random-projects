// Login do harness: o Access protege a API, não o frontend (SPA estática
// em bucket -- research D3). O probe pergunta à API quem é o chamador;
// sem sessão, o login é um hop de navegação top-level por GET /api/sso,
// que o Access intercepta (Google one-click) e devolve o cookie do
// domínio da API.
import { API_BASE, type Usuario } from "./api";

/**
 * O probe. redirect:"manual" transforma o bounce de login do Access numa
 * resposta opaca (status 0) -- qualquer coisa que não seja um 200 limpo
 * conta como "não logado", o mesmo truque do bet-frontend e do hub.
 * Erros de rede propagam: sem API não há para onde redirecionar, e o
 * shell mostra o estado de erro com retry.
 */
export async function probeMe(): Promise<Usuario | null> {
  const response = await fetch(`${API_BASE}/api/me`, {
    credentials: "include",
    redirect: "manual",
    cache: "no-store",
  });
  if (response.status !== 200) return null;
  return (await response.json()) as Usuario;
}

/**
 * O hop de login: navegação top-level por /api/sso com a origem atual
 * como `return` (a API só aceita origens de HARNESS_FRONTEND_ORIGINS).
 * Dentro de iframe (hub), o login do Google não completa -- quebra para
 * a janela de topo.
 */
export function goToSso(): void {
  const destino = `${API_BASE}/api/sso?return=${encodeURIComponent(window.location.origin)}`;
  if (window.top && window.top !== window.self) {
    window.top.location.href = destino;
  } else {
    window.location.href = destino;
  }
}

// ── Anti-loop do hop ──────────────────────────────────────────────────
// Se o cookie do Access existe mas a API recusa o JWT (aud/issuer mal
// configurados), cada visita ao /api/sso devolve 302 de volta na hora:
// sem marca, o probe falha → hop → probe falha → hop… num loop sem fim.
// sessionStorage sobrevive à navegação do hop (mesma aba), então ele
// distingue "primeira tentativa" de "voltamos do hop e nada mudou".

const CHAVE_HOP_SSO = "harness:sso:hop-pendente";

/** Marca que o hop de login saiu daqui. */
export function marcarSaidaSso(): void {
  try {
    window.sessionStorage.setItem(CHAVE_HOP_SSO, "1");
  } catch {
    // sem storage: sem marca, pior caso é o loop de antes — não bloqueia.
  }
}

/** True quando o probe falhou logo após o retorno do hop: hora do
 * estado de erro, não de outro hop. */
export function voltouDoSso(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_HOP_SSO) === "1";
  } catch {
    return false;
  }
}

/** Limpa a marca — login concluído ou retry manual (hop de novo). */
export function limparMarcaSso(): void {
  try {
    window.sessionStorage.removeItem(CHAVE_HOP_SSO);
  } catch {
    // nada a limpar sem storage.
  }
}