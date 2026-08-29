import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { BookOpen, ChevronsLeft, ChevronsRight, Home as HomeIcon, LogIn, LogOut, Menu, MonitorPlay, PanelLeftClose, PenLine } from "lucide-react";
import { NAV } from "../lib/nav.js";
import useMediaQuery from "../lib/useMediaQuery.js";
import type { RailState } from "../lib/useRailState.js";
import { isDiscordActivity } from "../lib/discordActivity.js";
import { signOut, useSession } from "../lib/authClient.js";
import { cn } from "../lib/cn.js";

// The rail's desktop icon set, index-aligned with lib/nav.ts's NAV.
const NAV_ICONS = [HomeIcon, BookOpen, MonitorPlay, PenLine] as const;

// The Excalidraw "drawer, can be closed" piece, in three desktop
// states (see useRailState): a 72px icon rail, the same rail with an
// overlay sheet of labels (mouse-leave / Escape / navigation close
// it), or gone entirely -- only a reopen pill in the corner. Mobile
// and the Discord Activity get the classic off-canvas drawer instead.
// The Activity gets no "Sair" either: its session is a module-scoped
// Discord bearer, not a cookie (see discordAuthToken.ts), so signing
// out there is meaningless -- a reload re-establishes it.
export default function Sidebar({ state, onState }: { state: RailState; onState: (s: RailState) => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activity = isDiscordActivity();
  const desktopViewport = useMediaQuery("(min-width: 1024px)");
  const isDesktop = !activity && desktopViewport;
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();
  const sheetOpen = mobileOpen || (isDesktop && state === "expanded");
  const leaveTimerRef = useRef<number | null>(null);

  // Route changes dismiss every transient sidebar surface: "expanded"
  // hands the row back to the content, the mobile drawer slides away.
  useEffect(() => {
    setMobileOpen(false);
    if (state === "expanded") onState("collapsed");
    // onState changes identity every render (setState wrapper);
    // depending on it would fire this effect constantly.
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (sheetOpen) {
        if (isDesktop) onState("collapsed");
        else setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, isDesktop, onState]);

  function scheduleCollapse() {
    if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => onState("collapsed"), 120);
  }

  function cancelCollapse() {
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }

  return (
    <>
      {/* Reopen pill -- mobile/Activity always, desktop when the rail
          was closed for real. */}
      {(!isDesktop || state === "hidden") && (
        <button
          type="button"
          onClick={() => (isDesktop ? onState("collapsed") : setMobileOpen(true))}
          title="Abrir menu"
          aria-label="Abrir menu"
          className="fixed top-3 left-3 z-40 w-10 h-10 grid place-items-center rounded-lg bg-buteco-brown-dark/90 border border-white/10 shadow-card text-buteco-cream/90 hover:text-buteco-amber hover:border-buteco-amber/40 transition-colors cursor-pointer"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Desktop rail -- never in an Activity, never when hidden. */}
      {isDesktop && state !== "hidden" && (
        <div className="fixed inset-y-0 left-0 z-30 hidden lg:flex w-[72px] flex-col items-center py-4 gap-1.5 bg-buteco-brown-dark/85 border-r border-white/5">
          <Link
            to="/"
            title="Sala de aula do Buteco"
            aria-label="Início -- Sala de aula do Buteco"
            className="mb-3 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <img src="/logo-cups.png" alt="" className="h-8 w-8" />
          </Link>

          <RailNav />

          <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
            {state === "collapsed" && (
              <button
                type="button"
                onClick={() => onState("expanded")}
                title="Expandir menu"
                aria-label="Expandir menu"
                className="w-10 h-10 grid place-items-center rounded-lg text-buteco-cream/50 hover:text-buteco-amber hover:bg-white/5 transition-colors cursor-pointer"
              >
                <ChevronsRight size={18} />
              </button>
            )}
            <RailUser session={session} />
          </div>
        </div>
      )}

      {/* The label sheet: desktop expansion and the Activity style
          overlay drawer share one geometry; only the scrim + dialog
          semantics differ. */}
      {sheetOpen && (
        <>
          {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={() => setMobileOpen(false)} />}
          <div
            role={mobileOpen ? "dialog" : undefined}
            aria-modal={mobileOpen || undefined}
            aria-label={mobileOpen ? "Menu" : undefined}
            onMouseLeave={scheduleCollapse}
            onMouseEnter={cancelCollapse}
            className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col py-4 px-3 bg-buteco-brown-dark/95 border-r border-white/10 shadow-card animate-fade-in-up"
            style={{ animationDuration: mobileOpen ? "200ms" : "150ms" }}
          >
            <div className="flex items-center justify-between mb-4 px-1">
              <Link to="/" title="Sala de aula do Buteco" className="flex items-center gap-2 rounded-lg">
                <img src="/logo-cups.png" alt="" className="h-8 w-8" />
                <span className="font-heading font-bold text-sm text-buteco-amber">Buteco</span>
              </Link>
              <div className="flex items-center">
                {isDesktop && (
                  <button
                    type="button"
                    onClick={() => onState("hidden")}
                    title="Fechar o menu de vez (reabre pelo canto)"
                    aria-label="Fechar o menu"
                    className="w-8 h-8 grid place-items-center rounded-lg text-buteco-cream/40 hover:text-buteco-cream hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <PanelLeftClose size={18} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isDesktop ? onState("collapsed") : setMobileOpen(false))}
                  title={isDesktop ? "Recolher" : "Fechar"}
                  aria-label={isDesktop ? "Recolher menu" : "Fechar menu"}
                  className="w-8 h-8 grid place-items-center rounded-lg text-buteco-cream/50 hover:text-buteco-cream hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <ChevronsLeft size={18} />
                </button>
              </div>
            </div>

            <nav aria-label="Navegação principal" className="flex flex-col gap-1">
              {NAV.map((item, i) => {
                const Icon = NAV_ICONS[i];
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    title={item.label}
                    aria-label={item.label}
                    aria-current={active || undefined}
                    className={cn(
                      "flex items-center gap-3 px-3 h-10 rounded-lg font-heading font-medium text-sm transition-colors",
                      active ? "text-buteco-amber bg-buteco-amber/12" : "text-buteco-cream/75 hover:text-buteco-cream hover:bg-white/5",
                    )}
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto">
              {session ? (
                <div className="glass-card p-3 flex items-center gap-2.5">
                  <Link to="/perfil" title="Seu perfil" className="shrink-0">
                    <span className="w-9 h-9 rounded-full bg-buteco-amber/15 text-buteco-amber grid place-items-center font-heading font-bold">
                      {session.user.name.charAt(0).toUpperCase()}
                    </span>
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/perfil"
                      className="block font-heading text-sm text-buteco-cream hover:text-buteco-amber transition-colors truncate"
                    >
                      {session.user.name}
                    </Link>
                    <span className="block text-[0.65rem] font-mono uppercase tracking-wide text-buteco-cream/40">perfil</span>
                  </div>
                  {!activity && (
                    <button
                      type="button"
                      title="Sair"
                      aria-label="Sair"
                      onClick={async () => {
                        await signOut();
                        setMobileOpen(false);
                        navigate("/login");
                      }}
                      className="w-8 h-8 grid place-items-center rounded-lg text-buteco-cream/40 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <LogOut size={15} />
                    </button>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  className="flex items-center gap-3 px-3 h-10 rounded-lg font-heading font-medium text-sm text-buteco-cream/75 hover:text-buteco-cream hover:bg-white/5 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  <LogIn size={18} />
                  Entrar
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function RailNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Navegação principal" className="flex flex-col items-center gap-1.5">
      {NAV.map((item, i) => {
        const Icon = NAV_ICONS[i];
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.label}
            aria-label={item.label}
            aria-current={active || undefined}
            className={cn(
              "w-10 h-10 grid place-items-center rounded-lg transition-colors",
              active ? "bg-buteco-amber/12 text-buteco-amber" : "text-buteco-cream/70 hover:text-buteco-cream hover:bg-white/5",
            )}
          >
            <Icon size={20} />
          </Link>
        );
      })}
    </nav>
  );
}

function RailUser({ session }: { session: { user: { name: string } } | null | undefined }) {
  if (!session) {
    return (
      <Link
        to="/login"
        title="Entrar"
        aria-label="Entrar"
        className="w-10 h-10 grid place-items-center rounded-lg text-buteco-cream/70 hover:text-buteco-amber hover:bg-white/5 transition-colors"
      >
        <LogIn size={20} />
      </Link>
    );
  }
  return (
    <Link
      to="/perfil"
      title={session.user.name}
      aria-label="Seu perfil"
      className="w-10 h-10 grid place-items-center rounded-full bg-buteco-amber/15 text-buteco-amber font-heading font-bold hover:bg-buteco-amber/25 transition-colors"
    >
      {session.user.name.charAt(0).toUpperCase()}
    </Link>
  );
}