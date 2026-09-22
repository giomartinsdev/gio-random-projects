// O shell: sidebar, roteador por hash e cabeçalho.
//
// Hash routing (não um router de dependência) pelo mesmo motivo do hub: um app
// de leitura não precisa de mais, e o link direto sobrevive a recarregar e ao
// botão voltar (FR-037).

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Badge } from "./ui";
import { fmt } from "../lib/format";
import type { SyncRun } from "../lib/types";
import type { Theme } from "../lib/hooks";

export type RouteId =
  | "home"
  | "clubes"
  | "clube"
  | "partida"
  | "jogador"
  | "jogadores"
  | "resgatar"
  | "minha-area"
  | "notificacoes"
  | "admin";

interface NavItem {
  id: RouteId;
  label: string;
  icon: string;
  group: "principal" | "minha conta" | "administração";
  requiresAuth?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: "home", label: "Início", icon: "🏠", group: "principal" },
  { id: "clubes", label: "Clubes", icon: "🛡️", group: "principal" },
  { id: "jogadores", label: "Jogadores", icon: "⭐", group: "principal" },
  { id: "resgatar", label: "Resgatar pro", icon: "🎯", group: "minha conta" },
  { id: "minha-area", label: "Minha área", icon: "👤", group: "minha conta" },
  { id: "notificacoes", label: "Notificações", icon: "🔔", group: "minha conta", requiresAuth: true },
  { id: "admin", label: "Administração", icon: "🔒", group: "administração", adminOnly: true },
];

export function Shell({
  route,
  onNavigate,
  authed,
  email,
  theme,
  onToggleTheme,
  sync,
  isAdmin,
  onLogout,
  children,
}: {
  route: RouteId;
  onNavigate: (r: RouteId) => void;
  authed: boolean | null;
  email: string;
  theme: Theme;
  onToggleTheme: () => void;
  sync: SyncRun | null;
  isAdmin: boolean;
  onLogout: () => void;
  children: ReactNode;
}) {
  const visible = NAV.filter((n) => {
    if (n.adminOnly) return isAdmin;
    if (n.requiresAuth) return authed === true;
    return true;
  });

  const groups: Array<NavItem["group"]> = ["principal", "minha conta", "administração"];

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar — vira navegação compacta abaixo de md. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-4 pb-3 pt-4">
          <div className="font-display text-lg font-bold tracking-tight">
            FC Clubs<span style={{ color: "var(--accent)" }}>.</span>hub
          </div>
          <div className="label mt-0.5">rankings e histórico</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => {
            const items = visible.filter((n) => n.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="label px-2.5 pb-1 pt-4">{g}</div>
                {items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onNavigate(n.id)}
                    aria-current={route === n.id ? "page" : undefined}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      route === n.id
                        ? "bg-[var(--accent-soft)] text-ink shadow-[inset_2px_0_0_var(--accent)]"
                        : "text-muted hover:bg-surface-3 hover:text-ink",
                    )}
                  >
                    <span className="w-[18px] text-center text-[15px] leading-none">{n.icon}</span>
                    <span className="truncate font-medium">{n.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <footer className="border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2">
            {authed ? (
              <>
                <span className="size-2 rounded-full" style={{ background: "var(--accent)" }} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={email}>
                  {email}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  title="Sair da conta"
                  className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-muted hover:text-ink"
                >
                  sair
                </button>
              </>
            ) : authed === false ? (
              <button
                type="button"
                onClick={() => onNavigate("minha-area")}
                className="flex-1 rounded-md border border-line-strong px-2 py-1 text-center text-xs text-muted transition-colors hover:text-ink"
              >
                Entrar com Google
              </button>
            ) : (
              <span className="text-xs text-faint">sondando sessão…</span>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              title={`Mudar para tema ${theme === "dark" ? "claro" : "escuro"}`}
              className="rounded-md border border-line-strong px-2 py-1 text-xs text-muted hover:text-ink"
            >
              {theme === "dark" ? "☾" : "☀"}
            </button>
          </div>
        </footer>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar mobile + chips de navegação. */}
        <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
          <span className="font-display text-base font-bold">
            FC Clubs<span style={{ color: "var(--accent)" }}>.</span>hub
          </span>
          <span className="ml-auto flex items-center gap-2">
            {authed ? (
              <Badge tone="accent">conectado</Badge>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate("minha-area")}
                className="rounded-md border border-line-strong px-2 py-1 text-xs text-muted"
              >
                Entrar
              </button>
            )}
            <button type="button" onClick={onToggleTheme} className="px-1 text-muted">
              {theme === "dark" ? "☾" : "☀"}
            </button>
          </span>
        </header>
        <div className="flex gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
          {visible.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavigate(n.id)}
              aria-current={route === n.id ? "page" : undefined}
              className={clsx(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                route === n.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-accent"
                  : "border-line bg-surface-2 text-muted",
              )}
            >
              {n.icon} {n.label}
            </button>
          ))}
        </div>

        {sync?.rodando && <SyncBanner sync={sync} />}

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}

/** O indicador de sincronização: mostra o progresso por nível sem bloquear
 * nada — a pessoa continua navegando enquanto o hub busca os clubes dela. */
function SyncBanner({ sync }: { sync: SyncRun }) {
  const niveis: Record<number, string> = {
    1: "seus clubes",
    2: "rivais diretos",
    3: "clubes de clubes",
  };
  const pct = sync.total > 0 ? Math.round((sync.concluidos / sync.total) * 100) : 0;
  return (
    <div
      className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs"
      style={{ background: "linear-gradient(180deg, var(--accent-soft), transparent)" }}
    >
      <span className="size-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
      <span className="font-display font-bold">Sincronizando</span>
      <span className="text-muted">
        {niveis[sync.nivel] ?? ""}
        {sync.atual ? ` · ${sync.atual}` : ""}
      </span>
      <span className="tnum ml-auto font-mono text-muted">
        {sync.total > 0 ? `${fmt(sync.concluidos)}/${fmt(sync.total)}` : "…"}
      </span>
      <span className="h-[3px] w-24 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <span className="block h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

export function PageHead({
  title,
  sub,
  crumb,
  actions,
}: {
  title: string;
  sub?: string;
  crumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        {crumb && <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">{crumb}</div>}
        <h1 className="font-display text-2xl font-bold uppercase tracking-wider md:text-3xl">{title}</h1>
        {sub && <p className="mt-1 max-w-[70ch] text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
