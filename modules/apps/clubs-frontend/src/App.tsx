// Raiz do app: roteamento por hash, sessão e as telas.

import { useCallback, useEffect, useState } from "react";
import { Shell, type RouteId } from "./components/shell";
import { loginUrl, useAuth, useSyncStatus, useTheme } from "./lib/hooks";
import { api } from "./lib/api";
import type { WatchEntry } from "./lib/types";
import { HomePage } from "./pages/HomePage";
import { ClubesPage } from "./pages/ClubesPage";
import { ClubePage } from "./pages/ClubePage";
import { PartidaPage } from "./pages/PartidaPage";
import { JogadorPage } from "./pages/JogadorPage";
import { JogadoresPage } from "./pages/JogadoresPage";
import { MinhaAreaPage } from "./pages/MinhaAreaPage";
import { NotificacoesPage } from "./pages/NotificacoesPage";
import { AdminPage } from "./pages/AdminPage";

/** Rotas ocultas (detalhe) também vivem no hash, para o link direto sobreviver
 * a recarregar e ao botão voltar. */
type View = { route: RouteId; param?: string };

const ROUTE_PATHS: Record<RouteId, string> = {
  home: "",
  clubes: "clubes",
  clube: "clube",
  partida: "partida",
  jogador: "jogador",
  jogadores: "jogadores",
  "minha-area": "minha-area",
  notificacoes: "notificacoes",
  admin: "admin",
};

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query ?? "");
  for (const [route, p] of Object.entries(ROUTE_PATHS) as Array<[RouteId, string]>) {
    if (p === path) {
      if (route === "clube") return { route, param: params.get("id") ?? "" };
      if (route === "partida") return { route, param: params.get("m") ?? "" };
      if (route === "jogador") return { route, param: params.get("p") ?? "" };
      return { route };
    }
  }
  return { route: "home" };
}

function hashFor(view: View): string {
  const p = ROUTE_PATHS[view.route];
  if (view.route === "clube" && view.param) return `#/clube?id=${encodeURIComponent(view.param)}`;
  if (view.route === "partida" && view.param) return `#/partida?m=${encodeURIComponent(view.param)}`;
  if (view.route === "jogador" && view.param) return `#/jogador?p=${encodeURIComponent(view.param)}`;
  return `#/${p}`;
}

export default function App() {
  const [view, setView] = useState<View>(parseHash);
  const { autenticado: authed, email } = useAuth();
  const { theme, setTheme } = useTheme();
  const [watch, setWatch] = useState<WatchEntry[]>([]);

  // Só quem entrou tem sincronização — e ela nunca bloqueia a navegação.
  const { run: sync, start: startSync } = useSyncStatus(authed === true);

  useEffect(() => {
    const onHash = () => setView(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadWatch = useCallback(() => {
    if (authed !== true) {
      setWatch([]);
      return;
    }
    api
      .watchlist()
      .then((r) => setWatch(r.clubes ?? []))
      .catch(() => setWatch([]));
  }, [authed]);

  useEffect(loadWatch, [loadWatch]);
  // Quando a sincronização termina, a lista de clubes mudou.
  useEffect(() => {
    if (sync && !sync.rodando) loadWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.rodando]);

  const navigate = useCallback((route: RouteId, param?: string) => {
    const target = hashFor({ route, param });
    if (window.location.hash !== target) window.location.hash = target;
    else setView({ route, param });
    window.scrollTo({ top: 0 });
  }, []);

  const isWatched = useCallback((clubId: string) => watch.some((w) => w.club_id === clubId), [watch]);

  const toggleWatch = useCallback(
    async (clubId: string) => {
      if (authed !== true) return;
      const seguindo = !isWatched(clubId);
      // Optimista: a lista responde na hora e o servidor confirma depois.
      setWatch((prev) =>
        seguindo
          ? [...prev, { club_id: clubId, nome: "", sigla: "", divisao: 0, nivel: 0, seguindo_desde: new Date().toISOString(), origem: "manual" }]
          : prev.filter((w) => w.club_id !== clubId),
      );
      try {
        await api.setWatch(clubId, seguindo);
        loadWatch();
      } catch {
        loadWatch(); // reverte para o estado do servidor
      }
    },
    [authed, isWatched, loadWatch],
  );

  const body = (() => {
    switch (view.route) {
      case "clubes":
        return (
          <ClubesPage
            onOpenClub={(id) => navigate("clube", id)}
            isWatched={isWatched}
            onToggleWatch={toggleWatch}
            authed={authed}
          />
        );
      case "clube":
        return view.param ? (
          <ClubePage
            clubId={view.param}
            onOpenMatch={(id) => navigate("partida", id)}
            onOpenPlayer={(id) => navigate("jogador", id)}
            onOpenClub={() => navigate("clubes")}
            isWatched={isWatched}
            onToggleWatch={toggleWatch}
            authed={authed}
          />
        ) : (
          <HomePage onOpenClub={(id) => navigate("clube", id)} onOpenPlayer={(id) => navigate("jogador", id)} />
        );
      case "partida":
        return view.param ? (
          <PartidaPage
            matchId={view.param}
            onOpenClub={(id) => navigate("clube", id)}
            onOpenPlayer={(id) => navigate("jogador", id)}
            onBack={() => window.history.back()}
          />
        ) : (
          <HomePage onOpenClub={(id) => navigate("clube", id)} onOpenPlayer={(id) => navigate("jogador", id)} />
        );
      case "jogador":
        return view.param ? (
          <JogadorPage
            playerId={view.param}
            onOpenClub={(id) => navigate("clube", id)}
            onOpenMatch={(id) => navigate("partida", id)}
            onBack={() => window.history.back()}
          />
        ) : (
          <JogadoresPage onOpenPlayer={(id) => navigate("jogador", id)} />
        );
      case "jogadores":
        return <JogadoresPage onOpenPlayer={(id) => navigate("jogador", id)} />;
      case "minha-area":
        return (
          <MinhaAreaPage
            authed={authed}
            email={email}
            sync={sync}
            onStartSync={startSync}
            onOpenClub={(id) => navigate("clube", id)}
            onOpenPlayer={(id) => navigate("jogador", id)}
            onToggleWatch={toggleWatch}
          />
        );
      case "notificacoes":
        return <NotificacoesPage authed={authed} />;
      case "admin":
        return <AdminPage authed={authed} />;
      default:
        return <HomePage onOpenClub={(id) => navigate("clube", id)} onOpenPlayer={(id) => navigate("jogador", id)} />;
    }
  })();

  return (
    <Shell
      route={view.route}
      onNavigate={(r) => navigate(r)}
      authed={authed}
      email={email}
      theme={theme}
      onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      sync={sync}
      isAdmin={authed === true}
    >
      {body}
    </Shell>
  );
}

export { loginUrl };
