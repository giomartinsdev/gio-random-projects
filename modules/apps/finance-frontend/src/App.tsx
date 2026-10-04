import { useCallback, useEffect, useState } from "react";
import { LogOut, Wallet } from "lucide-react";
import { setTheme } from "@/lib/theme";
import { initHubThemeSync } from "@/lib/hubTheme";
import { fetchSession, logout, type SessionInfo } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginPage } from "@/pages/LoginPage";
import { HomePage } from "@/pages/HomePage";
import { PhoneLinkPage } from "@/pages/PhoneLinkPage";

type Gate =
  | { state: "loading" }
  | { state: "anonymous" }
  | { state: "needs-phone"; session: SessionInfo }
  | { state: "ready"; session: SessionInfo };

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: "loading" });

  // Ponte de tema com o hub enquanto embutidos: `hub:theme` do pai vira a
  // escolha local (e o toggle daqui reporta de volta via broadcastTheme). Fora
  // do iframe é no-op. O tema inicial já foi aplicado em main.tsx.
  useEffect(() => initHubThemeSync(setTheme), []);

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    if (!session.authenticated) {
      setGate({ state: "anonymous" });
      return;
    }
    if (!session.phone) {
      setGate({ state: "needs-phone", session });
      return;
    }
    setGate({ state: "ready", session });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (gate.state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        carregando…
      </div>
    );
  }

  if (gate.state === "anonymous") {
    return <LoginPage onLogged={refresh} />;
  }

  if (gate.state === "needs-phone") {
    return <PhoneLinkPage session={gate.session} onLinked={refresh} />;
  }

  return (
    <Shell session={gate.session} onLogout={refresh}>
      <HomePage />
    </Shell>
  );
}

function Shell({
  session,
  onLogout,
  children,
}: {
  session: SessionInfo;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  async function sair() {
    await logout();
    onLogout();
  }
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Wallet className="size-4" />
            </span>
            finance
          </div>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.name || session.email}
            </span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={sair} title="Sair">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
