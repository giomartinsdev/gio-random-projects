import { useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { probeMe, type Me } from "@/lib/api";
import { initHubThemeSync } from "@/lib/hubTheme";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetPage } from "@/pages/BetPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { LoginGate } from "@/components/LoginGate";

// Hash routing, like the other micro apps: #/ (apostar), #/historico,
// #/ajustes. No router dependency -- three tabs don't need one.
const TABS = [
  { hash: "#/", label: "Apostar" },
  { hash: "#/historico", label: "Histórico" },
  { hash: "#/ajustes", label: "Ajustes" },
] as const;

type TabHash = (typeof TABS)[number]["hash"];

function currentTab(): TabHash {
  const hash = window.location.hash;
  if (TABS.some((tab) => tab.hash === hash)) return hash as TabHash;
  return "#/";
}

export default function App() {
  const [tab, setTab] = useState<TabHash>(currentTab);
  const [me, setMe] = useState<Me | null>(null);
  const [probing, setProbing] = useState(true);

  // The auth probe happens exactly once on load: a clean 200 = logged
  // in (Access injected the JWT and the BFF answered); an opaque
  // redirect (status 0) = not logged in -- LoginGate offers the hop
  // through bet-api's /auth/sso, which is what mints the session.
  useEffect(() => {
    let cancelled = false;
    void probeMe().then((result) => {
      if (cancelled) return;
      setMe(result);
      setProbing(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The hub's theme follows along while embedded (lib/hubTheme.ts).
  useEffect(() => initHubThemeSync(), []);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-4">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Dices className="size-6 text-primary" />
          bet
        </h1>
        <ThemeToggle />
      </header>

      {probing ? null : me === null ? (
        <LoginGate />
      ) : (
        <>
          <nav className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border-2 bg-card p-1">
            {TABS.map((entry) => (
              <button
                key={entry.hash}
                type="button"
                onClick={() => {
                  window.location.hash = entry.hash;
                  setTab(entry.hash);
                }}
                className={cn(
                  "rounded-xl px-2 py-2 text-sm font-semibold transition-colors",
                  tab === entry.hash ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <main className="flex-1">
            {tab === "#/" && <BetPage me={me} />}
            {tab === "#/historico" && <HistoryPage />}
            {tab === "#/ajustes" && <SettingsPage me={me} />}
          </main>
        </>
      )}
    </div>
  );
}