import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  Loader2,
  LogIn,
  LogOut,
  Maximize2,
  Menu,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  MICROFRONTENDS,
  SHORTCUTS,
  appIdFromHash,
  findApp,
  microfrontendOrigins,
  type Microfrontend,
} from "@/lib/apps";
import { LOGIN_URL, LOGOUT_URL, probeGoogleLogin } from "@/lib/auth";
import { onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export default function App() {
  // One piece of routing state, driven by the URL hash so every
  // renderer deep-link survives refresh and back/forward:
  // hub.giomartins.dev/#/cch opens CCH straight away. No hash is home.
  const [appId, setAppId] = useState<string | null>(() => appIdFromHash(window.location.hash));
  const [drawerOpen, setDrawerOpen] = useState(false);
  // null = still probing /sso; until it resolves the shortcuts tier
  // just doesn't render, so a logged-out visitor never sees it flash.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setAppId(appIdFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    probeGoogleLogin().then(setAuthed);
  }, []);

  // The other half of the theme bridge (Renderer is the first half):
  // an embedded app whose own toggle was used reports its new theme
  // back, and the hub adopts it. Only frames from the registry's
  // origins are believed, and the payload has to be exactly a theme.
  useEffect(() => {
    const trusted = new Set(microfrontendOrigins());
    function onMessage(event: MessageEvent) {
      if (!trusted.has(event.origin)) return;
      const data = event.data as { type?: string; theme?: string } | null;
      if (data?.type !== "app:theme") return;
      if (data.theme !== "light" && data.theme !== "dark") return;
      setTheme(data.theme as Theme);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const app = findApp(appId);

  // The tab title follows what's open -- with several hubs pinned, the
  // tab that has CCH open should say so.
  useEffect(() => {
    document.title = app ? `${app.name} — hub` : "hub — central dos apps";
  }, [app]);

  function openApp(id: string) {
    window.location.hash = `#/${id}`;
    setDrawerOpen(false);
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar -- always visible, the sketch's left column. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
        <SidebarHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList appId={appId} authed={authed} onOpen={openApp} />
        </div>
        <SidebarFooter authed={authed} />
      </aside>

      {/* One content column for every breakpoint: on mobile a top bar
          (drawer trigger + current app + theme) sits above it. Exactly
          one <main> exists, so an opened app mounts exactly one iframe
          -- hiding elements with CSS would keep the hidden copy's
          iframe (and its WebSockets) alive. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menu"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Menu className="size-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {app ? `${app.emoji} ${app.name}` : "hub"}
          </span>
          <ThemeToggle />
        </header>

        <main className="flex min-w-0 flex-1 flex-col">
          {app ? <Renderer key={app.id} app={app} /> : <HomePane authed={authed} onOpen={openApp} />}
        </main>
      </div>

      {/* Mobile: the same sidebar as a drawer over a backdrop. */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
            />
            <motion.aside
              key="drawer"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card md:hidden"
            >
              <SidebarHeader onClose={() => setDrawerOpen(false)} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavList appId={appId} authed={authed} onOpen={openApp} />
              </div>
              <SidebarFooter authed={authed} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3 pt-4">
      <span className="truncate text-lg font-bold tracking-tight">
        hub<span className="text-muted-foreground">.giomartins.dev</span>
      </span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function NavList({
  appId,
  authed,
  onOpen,
}: {
  appId: string | null;
  authed: boolean | null;
  onOpen: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-1 p-2">
      <SectionLabel>apps</SectionLabel>
      {MICROFRONTENDS.map((app) => (
        <NavItem
          key={app.id}
          active={app.id === appId}
          onClick={() => onOpen(app.id)}
          emoji={app.emoji}
          name={app.name}
          description={app.description}
        />
      ))}
      {/* The admin tier: only for a visitor who logged in with Google
          (see lib/auth.ts). Not rendered at all while probing. */}
      {authed && (
        <>
          <SectionLabel className="mt-3">atalhos</SectionLabel>
          {SHORTCUTS.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={`${s.description} — abre em nova aba`}
              className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="text-base leading-none">{s.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ))}
        </>
      )}
    </nav>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

function NavItem({
  active,
  onClick,
  emoji,
  name,
  description,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  name: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {/* The active pill slides between items instead of blinking in
          and out -- layoutId makes framer-motion animate the move. */}
      {active && (
        <motion.span
          layoutId="active-nav"
          className="absolute inset-0 rounded-md border border-border bg-accent"
          transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
        />
      )}
      <span className="relative text-base leading-none">{emoji}</span>
      <span className="relative min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

// The sketch's "login - darkmode" footer. The hub itself is public --
// the Google login here is opt-in (via the /sso Access endpoint, see
// lib/auth.ts) and only reveals the shortcuts tier; each shortcut
// target still confirms Google on its own domain the first time.
// Darkmode is the hub's theme, and it propagates into whatever app is
// embedded (Renderer's half of the bridge).
function SidebarFooter({ authed }: { authed: boolean | null }) {
  return (
    <div className="flex items-center gap-2 border-t px-3 py-2.5">
      {authed === null ? null : authed ? (
        <span
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          title="Logado com o Google. Os atalhos aparecem; cada painel confirma o login na primeira visita (sessão de 24h)."
        >
          <ShieldCheck className="size-3.5 shrink-0 text-green-500" />
          <span className="truncate">Google conectado</span>
          <a
            href={LOGOUT_URL}
            aria-label="Sair"
            title="Sair da sessão do Google"
            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <LogOut className="size-3" />
          </a>
        </span>
      ) : (
        <a
          href={LOGIN_URL}
          title="Fazer login com o Google para revelar os atalhos dos painéis"
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogIn className="size-3.5 shrink-0" />
          Entrar com Google
        </a>
      )}
      <span className="ml-auto" />
      <ThemeToggle />
    </div>
  );
}

function HomePane({ authed, onOpen }: { authed: boolean | null; onOpen: (id: string) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold tracking-tight">tudo num lugar só</h1>
          <p className="mt-1 text-muted-foreground">
            Os frontends abrem aqui dentro, renderizados no hub. Escolha um app na barra lateral
            ou abaixo.
          </p>
        </motion.div>

        <div className="grid gap-3 sm:grid-cols-2">
          {MICROFRONTENDS.map((app, i) => (
            <motion.button
              key={app.id}
              type="button"
              onClick={() => onOpen(app.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * i, ease: "easeOut" }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">{app.emoji}</span>
                <span className="font-medium">{app.name}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{app.description}</p>
              <p className="mt-2 text-xs text-muted-foreground/70">{app.url.replace("https://", "")}</p>
            </motion.button>
          ))}
        </div>

        {authed ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
            className="mt-8"
          >
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              atalhos — abrem em nova aba
            </div>
            <div className="flex flex-wrap gap-2">
              {SHORTCUTS.map((s) => (
                <a
                  key={s.id}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.description}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span>{s.emoji}</span>
                  {s.name}
                  <ExternalLink className="size-3" />
                </a>
              ))}
            </div>
          </motion.div>
        ) : (
          authed === false && (
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
              className="mt-8 text-sm text-muted-foreground"
            >
              Os atalhos dos painéis aparecem{" "}
              <a
                href={LOGIN_URL}
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                depois de entrar com o Google
              </a>
              .
            </motion.p>
          )
        )}
      </div>
    </div>
  );
}

// The renderer: a header bar over a full-bleed iframe of the app --
// the sketch's "microfrontend opened" box. The iframe is deliberately
// NOT sandboxed: these are first-party apps that use their own
// localStorage and (tela) screen capture. The allow list exists so
// permission-gated features survive being embedded.
function Renderer({ app }: { app: Microfrontend }) {
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // A reload (or switching apps, via the parent's key) remounts the
  // iframe; the spinner shows until the new frame reports its load.
  const reload = useCallback(() => {
    setLoaded(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => setLoaded(false), [app.id, nonce]);

  // Hub → app half of the theme bridge: the hub's theme is the
  // embedded app's theme. Sent on every theme change (while a frame
  // is loaded) and once on each iframe load (a frame that mounts
  // after the last change would otherwise boot with its own saved
  // choice until the next toggle). Pushing before the frame has
  // navigated would throw a target-origin mismatch -- its initial
  // about:blank window still has the hub's origin -- so while
  // `loaded` is false the send is skipped; onLoad picks up the current
  // theme anyway, so nothing is lost. The app's listener is its
  // lib/hubTheme.ts; tela has no theme system (dark-only by design)
  // and simply ignores the message. The app echoing the value back is
  // absorbed by App's "app:theme" listener -- applying the same theme
  // again is a no-op, so no loop.
  const pushTheme = useCallback(() => {
    if (!loaded) return;
    const theme: Theme =
      document.documentElement.dataset.theme === "light" ? "light" : "dark";
    iframeRef.current?.contentWindow?.postMessage({ type: "hub:theme", theme }, app.url);
  }, [app.url, loaded]);

  useEffect(() => {
    if (!loaded) return;
    pushTheme();
    return onThemeChange(pushTheme);
  }, [pushTheme, loaded]);

  function fullscreen() {
    if (!document.fullscreenElement) {
      shellRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-3">
        <span className="text-base leading-none">{app.emoji}</span>
        <span className="text-sm font-medium">{app.name}</span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {app.url.replace("https://", "")}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <HeaderButton label="Recarregar" onClick={reload}>
            <RotateCw className="size-3.5" />
          </HeaderButton>
          <HeaderButton label="Tela cheia" onClick={fullscreen}>
            <Maximize2 className="size-3.5" />
          </HeaderButton>
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            title="Abrir em nova aba"
            aria-label="Abrir em nova aba"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </span>
      </header>

      <div ref={shellRef} className="relative min-h-0 flex-1">
        <AnimatePresence>
          {!loaded && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-background"
            >
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <span className="text-sm">abrindo {app.name}…</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.iframe
          key={`${app.id}:${nonce}`}
          src={app.url}
          title={app.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          onLoad={() => {
            setLoaded(true);
            pushTheme();
          }}
          ref={iframeRef}
          // display-capture: tela's screen sharing inside the frame;
          // fullscreen: children that go fullscreen themselves.
          allow="display-capture; fullscreen; camera; microphone; clipboard-write"
          className="absolute inset-0 size-full border-0"
        />
      </div>
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}