// Raiz do app: roteamento por caminho real, sessão e as telas.

import { useCallback, useEffect, useState } from "react";
import { Shell } from "./components/shell";
import { CommandPalette } from "./components/command-palette";
import { sair, useAuth, useCommandPalette, useSourceStatus, useSyncStatus, useTheme } from "./lib/hooks";
import { api } from "./lib/api";
import type { ClaimedPro, WatchEntry } from "./lib/types";
import { currentView, parsePath, pathFor, type View } from "./lib/routing";
import { legacyHashPath } from "./lib/legacy-hash";
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

/** Converte um link antigo em hash (`#/club?id=…`) no caminho real, uma vez,
 * antes do app montar. Sem isto, os links já compartilhados virariam link
 * morto. `replaceState` de propósito: não empilha uma entrada de história só
 * para consertar a URL. */
function migrateLegacyHash(): void {
  const path = legacyHashPath(window.location.hash);
  if (path === null) return;
  window.history.replaceState(null, "", path);
}

export default function App() {
  const [view, setView] = useState<View>(currentView);
  const { autenticado: authed, email, isAdmin, refresh: refreshAuth } = useAuth();
  const { theme, setTheme } = useTheme();
  const [watch, setWatch] = useState<WatchEntry[]>([]);
  // O pro reivindicado por esta pessoa. Vive aqui, e não na página do jogador,
  // para o botão "reivindicar" saber que ela JÁ reivindicou — e o selo de
  // verificado refletir isso sem esperar o próximo fetch.
  const [claimed, setClaimed] = useState<ClaimedPro | null>(null);

  // Só quem entrou tem sincronização — e ela nunca bloqueia a navegação.
  const { run: sync, start: startSync } = useSyncStatus(authed === true);
  // Saúde da fonte, para TODOS (logado ou não): a tela de resgate mostra o
  // elenco antes do login, e é aí que o aviso de "fonte fora" mais importa.
  const source = useSourceStatus();
  // ⌘K / Ctrl+K / "/" abre a busca rápida -- global, funciona em qualquer tela.
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  useEffect(() => {
    // Os links antigos em hash viram caminho real antes de qualquer coisa.
    migrateLegacyHash();
    // popstate é o voltar/avançar do navegador num app que usa pushState.
    const onPop = () => setView(currentView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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

  const navigate = useCallback((route: View["route"], param?: string) => {
    const target = pathFor({ route, param });
    // `pushState` dá link real e entrada de história (o voltar funciona sem
    // recarregar). Só empilha quando o caminho muda: clicar na rota atual é
    // no-op em vez de poluir a história.
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
    setView(parsePath(target));
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
          <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} onClaim={() => navigate("claim")} onBrowseClubs={() => navigate("clubs")} />
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
          <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} onClaim={() => navigate("claim")} onBrowseClubs={() => navigate("clubs")} />
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
        return <AdminPage authed={authed} isAdmin={isAdmin} />;
      default:
        return <HomePage onOpenClub={(id) => navigate("club", id)} onOpenPlayer={(id) => navigate("player", id)} onClaim={() => navigate("claim")} onBrowseClubs={() => navigate("clubs")} />;
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
      source={source}
      isAdmin={isAdmin}
      onLogout={sair}
      onOpenSearch={() => setPaletteOpen(true)}
    >
      {body}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenClub={(id) => navigate("club", id)}
        onOpenPlayer={(id) => navigate("player", id)}
      />
    </Shell>
  );
}
