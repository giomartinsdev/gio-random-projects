import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Usuario } from "@/lib/api";
import { goToSso, limparMarcaSso, marcarSaidaSso, probeMe, voltouDoSso } from "@/lib/auth";
import { ListaSessoes } from "@/pages/ListaSessoes";
import { NovaSessao } from "@/pages/NovaSessao";
import { PaginaSessao } from "@/pages/PaginaSessao";

// ─── Roteamento ───────────────────────────────────────────────────────
// Por window.location.pathname, sem lib (contrato de UI em
// contracts/api.md): cada navegação é um <a> comum; tanto o dev server
// do Vite quanto o nginx ingress caem no index.html em qualquer rota
// (fallback SPA). Nada muda de rota sem recarregar, então a rota é
// lida uma única vez.
//
//   /                lista de sessões do time
//   /sessoes/nova    form de criação (?origem={id} → form de extensão)
//   /sessoes/{id}    página da sessão

type Rota =
  | { tela: "lista" }
  | { tela: "nova"; origemId: number | null }
  | { tela: "sessao"; id: number }
  | { tela: "rotaDesconhecida"; caminho: string };

function rotaAtual(): Rota {
  // Barra final é ruído de URL -- /sessoes/42/ é a mesma rota.
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = window.location.search;
  if (pathname === "/" || pathname === "") return { tela: "lista" };
  if (pathname === "/sessoes/nova") {
    const origem = new URLSearchParams(search).get("origem");
    return { tela: "nova", origemId: origem && /^\d+$/.test(origem) ? Number(origem) : null };
  }
  const sessao = /^\/sessoes\/(\d+)\/?$/.exec(pathname);
  if (sessao) return { tela: "sessao", id: Number(sessao[1]) };
  return { tela: "rotaDesconhecida", caminho: pathname };
}

// ─── Shell ────────────────────────────────────────────────────────────
// O probe de login (lib/auth) decide o primeiro estado: carregando →
// pronta | login (hop SSO) | erro (API inalcançável, com retry).

type EstadoApp =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string }
  | { fase: "login" }
  | { fase: "pronta"; usuario: Usuario };

export default function App() {
  const [rota] = useState<Rota>(rotaAtual);
  const [estado, setEstado] = useState<EstadoApp>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  // Título do document para a rota sem página própria; as páginas reais
  // (ListaSessoes/NovaSessao/PaginaSessao) definem o seu ao carregar.
  useEffect(() => {
    if (rota.tela === "rotaDesconhecida") document.title = "Página não encontrada — harness";
  }, [rota.tela]);

  useEffect(() => {
    let ativo = true;
    setEstado({ fase: "carregando" });
    probeMe()
      .then((usuario) => {
        if (!ativo) return;
        if (usuario) {
          limparMarcaSso();
          setEstado({ fase: "pronta", usuario });
        } else if (voltouDoSso()) {
          // O hop já aconteceu e o probe segue sem sessão: hop de novo
          // entraria em loop (cookie do Access existe, a API recusa o
          // JWT — config errada). Estado de erro; "Tentar de novo" limpa
          // a marca e faz o hop de novo.
          limparMarcaSso();
          setEstado({
            fase: "erro",
            mensagem: "O login pelo Cloudflare Access não foi concluído.",
          });
        } else {
          // Não autenticado: hop de login pela API (D3). O SPA não tem
          // rota de login -- a navegação sai do app e não volta aqui.
          marcarSaidaSso();
          setEstado({ fase: "login" });
          goToSso();
        }
      })
      .catch(() => {
        if (ativo) setEstado({ fase: "erro", mensagem: "Não foi possível falar com a API." });
      });
    return () => {
      ativo = false;
    };
  }, [tentativa]);

  if (estado.fase !== "pronta") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        {estado.fase === "carregando" && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {estado.fase === "login" && <p className="text-sm text-muted-foreground">Indo para o login…</p>}
        {estado.fase === "erro" && (
          <div className="card w-full max-w-sm p-5 text-center">
            <p className="text-sm text-destructive">{estado.mensagem}</p>
            <button
              type="button"
              className="btn btn-secundario mt-4"
              onClick={() => setTentativa((t) => t + 1)}
            >
              Tentar de novo
            </button>
          </div>
        )}
      </div>
    );
  }

  const { usuario } = estado;
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border pb-3">
        <a href="/" className="text-base font-semibold tracking-tight">
          harness
        </a>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{usuario.nome}</span>
          <a href="/sessoes/nova" className="btn btn-primario">
            Nova sessão
          </a>
        </div>
      </header>
      <main className="pt-5">{conteudoDaRota(rota, usuario)}</main>
    </div>
  );
}

// ─── Conteúdo por rota ────────────────────────────────────────────────
// Páginas das stories US1–US5: T011/T019 (ListaSessoes), T012 (NovaSessao)
// e T013/T017/T023/T027 (PaginaSessao). Cada página cuida do próprio
// document.title.

function conteudoDaRota(rota: Rota, usuario: Usuario): ReactNode {
  switch (rota.tela) {
    case "lista":
      return <ListaSessoes />;
    case "nova":
      return <NovaSessao origemId={rota.origemId} />;
    case "sessao":
      return <PaginaSessao id={rota.id} eu={usuario} />;
    case "rotaDesconhecida":
      return (
        <section className="card p-5 sm:p-6">
          <h1 className="text-lg font-semibold">Página não encontrada</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nada em <code className="rounded bg-muted px-1 py-0.5">{rota.caminho}</code>.
          </p>
          <a href="/" className="btn btn-secundario mt-4">
            Voltar para a lista
          </a>
        </section>
      );
  }
}