// O shell: sidebar, roteador por hash e cabeçalho.
//
// Hash routing (não um router de dependência) pelo mesmo motivo do hub: um app
// de leitura não precisa de mais, e o link direto sobrevive a recarregar e ao
// botão voltar (FR-037).

import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  Bell,
  House,
  Lock,
  LogOut,
  Moon,
  Shield,
  Star,
  Sun,
  Target,
  User,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "./ui";
import { fmt } from "../lib/format";
import type { SyncRun } from "../lib/types";
import type { Theme } from "../lib/hooks";
import { LOCALE_LABEL, LOCALE_SHORT, LOCALES, useI18n, type Key, type Locale } from "../lib/i18n";

export type RouteId =
  | "home"
  | "clubs"
  | "club"
  | "match"
  | "player"
  | "players"
  | "claim"
  | "my-area"
  | "notifications"
  | "admin";

interface NavItem {
  id: RouteId;
  /** Chave de i18n, não texto: o rótulo muda com o idioma escolhido. */
  label: Key;
  icon: LucideIcon;
  group: "discover" | "my-hub" | "system";
  requiresAuth?: boolean;
  adminOnly?: boolean;
}

// A ordem é a da jornada, não a alfabética: o público primeiro (o hub é
// usável sem conta), depois o que o login destrava, e o técnico por último.
// Ícones do lucide -- o resto do repo já usa, e emoji como ícone de navegação
// é o que dava o ar amador.
const NAV: NavItem[] = [
  { id: "home", label: "nav.home", icon: House, group: "discover" },
  { id: "clubs", label: "nav.clubs", icon: Shield, group: "discover" },
  { id: "players", label: "nav.players", icon: Star, group: "discover" },
  { id: "claim", label: "nav.claim", icon: Target, group: "my-hub" },
  { id: "my-area", label: "nav.myArea", icon: User, group: "my-hub" },
  { id: "notifications", label: "nav.notifications", icon: Bell, group: "my-hub", requiresAuth: true },
  { id: "admin", label: "nav.admin", icon: Lock, group: "system", adminOnly: true },
];

const GROUPS: Array<{ id: NavItem["group"]; label: Key }> = [
  { id: "discover", label: "nav.discover" },
  { id: "my-hub", label: "nav.myHub" },
  { id: "system", label: "nav.system" },
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
  const { t, locale, setLocale } = useI18n();

  const visible = NAV.filter((n) => {
    if (n.adminOnly) return isAdmin;
    if (n.requiresAuth) return authed === true;
    return true;
  });

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar — vira navegação compacta abaixo de md. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-4 pb-4 pt-5">
          <div className="font-display text-lg font-bold tracking-tight">
            FC Clubs<span style={{ color: "var(--accent)" }}>.</span>hub
          </div>
          <div className="label mt-1">{t("brand.tagline")}</div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
          {GROUPS.map((g) => {
            const items = visible.filter((n) => n.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="pt-3 first:pt-0">
                <div className="label px-2.5 pb-1.5">{t(g.label)}</div>
                {items.map((n) => {
                  const active = route === n.id;
                  const Icon = n.icon;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onNavigate(n.id)}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-[var(--accent-soft)] text-ink"
                          : "text-muted hover:bg-surface-3 hover:text-ink",
                      )}
                    >
                      {active && (
                        <span
                          className="absolute inset-y-2 left-0 w-0.5 rounded-full"
                          style={{ background: "var(--accent)" }}
                        />
                      )}
                      <Icon
                        className="size-4 shrink-0"
                        style={{ color: active ? "var(--accent)" : undefined }}
                        strokeWidth={2}
                      />
                      <span className="truncate font-display font-semibold tracking-wide">{t(n.label)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <footer className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-md font-mono text-[10px] font-bold"
              style={
                authed
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { background: "var(--surface-3)", color: "var(--text-faint)" }
              }
              aria-hidden="true"
            >
              {authed ? (email[0] ?? "?").toUpperCase() : "?"}
            </span>
            <span className="min-w-0 flex-1">
              {authed ? (
                <>
                  <span className="block truncate text-xs font-semibold">{email.split("@")[0]}</span>
                  <span className="block truncate font-mono text-[9.5px] text-faint" title={email}>
                    conectado
                  </span>
                </>
              ) : authed === false ? (
                <button
                  type="button"
                  onClick={() => onNavigate("my-area")}
                  className="text-xs font-semibold text-muted transition-colors hover:text-ink"
                >
                  {t("action.signIn")}
                </button>
              ) : (
                <span className="text-xs text-faint">{t("action.connecting")}</span>
              )}
            </span>
            {authed && (
              <button
                type="button"
                onClick={onLogout}
                title={t("action.signOut")}
                aria-label={t("action.signOut")}
                className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <LogOut className="size-3.5" />
              </button>
            )}
            <LocalePicker locale={locale} onChange={setLocale} />
            <button
              type="button"
              onClick={onToggleTheme}
              title={`tema: ${theme === "dark" ? "claro" : "escuro"}`}
              aria-label="Alternar tema"
              className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {theme === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
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
                onClick={() => onNavigate("my-area")}
                className="rounded-md border border-line-strong px-2 py-1 text-xs text-muted"
              >
                {t("action.connect")}
              </button>
            )}
            <LocalePicker locale={locale} onChange={setLocale} compact />
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Alternar tema"
              className="p-1 text-muted"
            >
              {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </button>
          </span>
        </header>
        <div className="flex gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
          {visible.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onNavigate(n.id)}
                aria-current={route === n.id ? "page" : undefined}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                  route === n.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-accent"
                    : "border-line bg-surface-2 text-muted",
                )}
              >
                <Icon className="size-3.5" />
                {t(n.label)}
              </button>
            );
          })}
        </div>

        {sync?.running && <SyncBanner sync={sync} />}

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Seletor de idioma. Um <select> nativo: abre o menu do sistema, funciona no
 * toque e no teclado, e não custa um dropdown próprio. */
function LocalePicker({
  locale,
  onChange,
  compact,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
  compact?: boolean;
}) {
  return (
    <label
      className="shrink-0 rounded-md p-1 text-faint transition-colors hover:text-ink"
      title={LOCALE_LABEL[locale]}
    >
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as Locale)}
        aria-label="Language"
        className="cursor-pointer bg-transparent font-mono text-[10px] uppercase outline-none"
        style={{ color: "inherit" }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} style={{ color: "var(--text)" }}>
            {compact ? LOCALE_SHORT[l] : LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** O indicador de sincronização: mostra o progresso por nível sem bloquear
 * nada — a pessoa continua navegando enquanto o hub busca os clubes dela. */
function SyncBanner({ sync }: { sync: SyncRun }) {
  const niveis: Record<number, string> = {
    1: "seus clubs",
    2: "rivais diretos",
    3: "clubes de clubes",
  };
  const pct = sync.total > 0 ? Math.round((sync.completed / sync.total) * 100) : 0;
  return (
    <div
      className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs"
      style={{ background: "linear-gradient(180deg, var(--accent-soft), transparent)" }}
    >
      <span className="size-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
      <span className="font-display font-bold">Sincronizando</span>
      <span className="text-muted">
        {niveis[sync.skill_rating] ?? ""}
        {sync.current ? ` · ${sync.current}` : ""}
      </span>
      <span className="tnum ml-auto font-mono text-muted">
        {sync.total > 0 ? `${fmt(sync.completed)}/${fmt(sync.total)}` : "…"}
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
