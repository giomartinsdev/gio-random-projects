// Raiz do app: roteamento por hash, sessão e as telas.

import { useCallback, useEffect, useState } from "react";
import { Shell, type RouteId } from "./components/shell";
import { sair, useAuth, useSyncStatus, useTheme } from "./lib/hooks";
import { api } from "./lib/api";
import type { ClaimedPro, WatchEntry } from "./lib/types";
import { HomePage } from "./pages/HomePage";
import { ClubsPage } from "./pages/ClubsPage";
import { ClubPage } from "./pages/ClubPage";
import { MatchPage } from "./pages/MatchPage";
import { PlayerPage } from "./pages/PlayerPage";
import { PlayersPage } from "./pages/PlayersPage";
import { MyAreaPage } from "./pages/MyAreaPage";
import { ClaimPage } from "./pages/ClaimPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { AdminPage } from "./pages/AdminPage";

/** Rotas ocultas (detalhe) também vivem no hash, para o link direto sobreviver
 * a recarregar e ao botão voltar. */
type View = { route: RouteId; param?: string };

const ROUTE_PATHS: Record<RouteId, string> = {
  home: "",
  clubs: "clubs",
  club: "club",
  match: "match",
  player: "player",
  players: "players",
  claim: "claim",
  "my-area": "my-area",
  notifications: "notifications",
  admin: "admin",
};

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query ?? "");
  for (const [route, p] of Object.entries(ROUTE_PATHS) as Array<[RouteId, string]>) {
    if (p === path) {
      if (route === "club") return { route, param: params.get("id") ?? "" };
      if (route === "match") return { route, param: params.get("m") ?? "" };
      if (route === "player") return { route, param: params.get("p") ?? "" };
      return { route };
    }
  }
  return { route: "home" };
}

function hashFor(view: View): string {
  const p = ROUTE_PATHS[view.route];
  if (view.route === "club" && view.param) return `#/${p}?id=${encodeURIComponent(view.param)}`;
  if (view.route === "match" && view.param) return `#/${p}?m=${encodeURIComponent(view.param)}`;
  if (view.route === "player" && view.param) return `#/${p}?p=${encodeURIComponent(view.param)}`;
  return `#/${p}`;
}

export default function App() {
  const [view, setView] = useState<View>(parseHash);
  const { autenticado: authed, email, refresh: refreshAuth } = useAuth();
  const { theme, setTheme } = useTheme();
  const [watch, setWatch] = useState<WatchEntry[]>([]);
  // O pro reivindicado por esta pessoa. Vive aqui, e não na página do jogador,
  // para o botão "reivindicar" saber que ela JÁ reivindicou — e o selo de
  // verificado refletir isso sem esperar o próximo fetch.
  const [claimed, setClaimed] = useState<ClaimedPro | null>(null);

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
      .then((r) => setWatch(r.clubs ?? []))
      .catch(() => setWatch([]));
  }, [authed]);

  useEffect(loadWatch, [loadWatch]);
  // Quando a sincronização termina, a lista de clubes mudou.
  useEffect(() => {
    if (sync && !sync.running) loadWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.running]);

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
          ? [...prev, { club_id: clubId, name: "", tag: "", division_at_read: 0, skill_rating: 0, tracked_since: new Date().toISOString(), source: "manual" }]
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

  // O pro reivindicado, carregado quando a sessão fica autenticada.
  const loadClaimed = useCallback(() => {
    if (authed !== true) {
      setClaimed(null);
      return;
    }
    api
      .claimedPro()
      .then((r) => setClaimed(r.pro ?? null))
      .catch(() => setClaimed(null));
  }, [authed]);

  useEffect(loadClaimed, [loadClaimed]);

  const claimPro = useCallback(
    async (clubId: string, playerId: string) => {
      if (authed !== true) return;
      // Otimista: o selo aparece na hora; o worker confirma a gravação.
      setClaimed({ club_id: clubId, player_id: playerId, verified: true });
      try {
        await api.claimPro(clubId, playerId);
        // Reivindicar também SEGUE o clube (o worker faz isso), o que muda a
        // Minha Área e dispara a descoberta — recarrega os dois.
        loadClaimed();
        loadWatch();
        startSync();
      } catch {
        loadClaimed(); // reverte para o estado do servidor
        throw new Error("claim failed");
      }
    },
    [authed, loadClaimed, loadWatch, startSync],
  );

  const body = (() => {
    switch (view.route) {
      case "clubs":
        return (
          <ClubsPage
            onOpenClub={(id) => navigate("club", id)}
            isWatched={isWatched}
            onToggleWatch={toggleWatch}
            authed={authed}
          />
        );
      case "club":
        return view.param ? (
          <ClubPage
            clubId={view.param}
            onOpenMatch={(id) => navigate("match", id)}
            onOpenPlayer={(id) => navigate("player", id)}
            onOpenClub={() => navigate("clubs")}
            isWatched={isWatched}
            onToggleWatch={toggleWatch}
            authed={authed}
          />
        ) : (
          <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} />
        );
      case "match":
        return view.param ? (
          <MatchPage
            matchId={view.param}
            onOpenClub={(id) => navigate("club", id)}
            onOpenPlayer={(id) => navigate("player", id)}
            onBack={() => window.history.back()}
          />
        ) : (
          <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} />
        );
      case "player":
        return view.param ? (
          <PlayerPage
            playerId={view.param}
            authed={authed}
            claimed={claimed}
            onClaim={claimPro}
            onOpenClub={(id) => navigate("club", id)}
            onOpenMatch={(id) => navigate("match", id)}
            onBack={() => window.history.back()}
          />
        ) : (
          <PlayersPage onOpenPlayer={(id) => navigate("player", id)} />
        );
      case "players":
        return <PlayersPage onOpenPlayer={(id) => navigate("player", id)} />;
      case "claim":
        return (
          <ClaimPage
            authed={authed}
            claimed={claimed}
            onClaim={claimPro}
            onSignedIn={refreshAuth}
            onOpenClub={(id) => navigate("club", id)}
            onOpenPlayer={(id) => navigate("player", id)}
          />
        );
      case "my-area":
        return (
          <MyAreaPage
            authed={authed}
            email={email}
            sync={sync}
            onStartSync={startSync}
            onSignedIn={refreshAuth}
            onOpenClub={(id) => navigate("club", id)}
            onOpenPlayer={(id) => navigate("player", id)}
            onToggleWatch={toggleWatch}
          />
        );
      case "notifications":
        return <NotificationsPage authed={authed} onSignedIn={refreshAuth} />;
      case "admin":
        return <AdminPage authed={authed} />;
      default:
        return <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} />;
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
      onLogout={sair}
    >
      {body}
    </Shell>
  );
}
