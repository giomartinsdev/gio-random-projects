import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { probeMe, type Me } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BetPage } from "@/pages/BetPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { LoginGate } from "@/components/LoginGate";

// Hash routing stays (this is a hub micro app -- three tabs don't need
// a router dependency), but the tab switch itself is Radix Tabs, the
// same way tela does it: the Tabs value IS the hash, one source of
// truth.
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
  // through bet-api's /api/sso, which is what mints the session.
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

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <motion.div
          className="mb-8 text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h1 className="text-4xl font-bold tracking-tight">bet</h1>
          <p className="mt-2 text-muted-foreground">
            Cole o link da casa — o runner loga e coloca a aposta por você.
          </p>
        </motion.div>

        {probing ? (
          <p className="text-center text-sm text-muted-foreground">carregando…</p>
        ) : me === null ? (
          <LoginGate />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          >
            <Tabs
              value={tab}
              onValueChange={(value) => {
                window.location.hash = value;
                setTab(value as TabHash);
              }}
            >
              <TabsList className="grid w-full grid-cols-3">
                {TABS.map((entry) => (
                  <TabsTrigger key={entry.hash} value={entry.hash}>
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="#/">
                <BetPage me={me} />
              </TabsContent>
              <TabsContent value="#/historico">
                <HistoryPage />
              </TabsContent>
              <TabsContent value="#/ajustes">
                <SettingsPage me={me} />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          O Chrome headless roda no servidor; o recibo chega com screenshot.
        </p>
      </div>
    </div>
  );
}