// Cada um dos 4 BFFs tem seu próprio Cloudflare Access + /sso (mesmo
// padrão de hub-frontend/bet-api: GET /sso responde 200 quando já existe
// sessão de Access válida para aquela origem, ou devolve um redirect
// para o login quando não existe). Como os 4 módulos vivem atrás do
// MESMO time de Access (mesma allowlist de e-mail, mesma zona), uma
// sessão de Access é compartilhada entre eles na prática -- não
// precisamos probar os 4. Escolhemos contas-api como "âncora" de login
// porque é o módulo raiz de todo o resto (US1: sem conta não existe onde
// lançar transação nem ativo) e é o primeiro contrato listado na spec.
// Um 401 de qualquer outro módulo durante o uso normal é tratado no
// próprio cliente daquele módulo (ver src/lib/api/*.ts), não aqui.
import { CONTAS_API_URL } from "./api/contas";

export const LOGIN_URL = `${CONTAS_API_URL}/api/sso`;

// A navegação real de login precisa de ?return= -- contas-api's
// handleSSO recusa com 422 "origem de retorno não permitida" sem um
// return cuja ORIGEM esteja em CONTAS_FRONTEND_ORIGINS (allowlist do
// Terraform). O probe acima não passa por essa checagem porque nunca
// segue o redirect (redirect:"manual"), mas a navegação top-level do
// botão "Entrar" precisa mandar a URL atual para voltar depois do
// login do Google.
export function loginNavigationUrl(): string {
  return `${LOGIN_URL}?return=${encodeURIComponent(window.location.href)}`;
}

export const LOGOUT_URL =
  "https://workwithgiomartinsdev.cloudflareaccess.com/cdn-cgi/access/logout";

// redirect:"manual" faz o redirect de login do Access chegar como uma
// resposta opaca (status 0); uma requisição que já passa pelo Access
// chega 200. Qualquer outra coisa (opaco, erro de rede) é tratada como
// "não logada" -- errar nesse sentido só esconde a UI, nunca vaza dado.
export async function probeLogin(): Promise<boolean> {
  try {
    const res = await fetch(LOGIN_URL, {
      redirect: "manual",
      cache: "no-store",
      credentials: "include",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
