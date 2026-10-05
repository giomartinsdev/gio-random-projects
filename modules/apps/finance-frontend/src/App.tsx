import { useCallback, useEffect, useState } from "react";
import { applyTheme, loadTheme } from "@/lib/theme";
import { fetchSession, logout, type SessionInfo } from "@/lib/auth";
import { useHashRoute } from "@/lib/useHashRoute";
import { initHubThemeSync } from "@/lib/hubTheme";
import { LoginPage } from "@/pages/LoginPage";
import { PhoneLinkPage } from "@/pages/PhoneLinkPage";
import { Shell } from "@/components/shell";
import { DashboardPage } from "@/pages/DashboardPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { TransactionDetailPage } from "@/pages/TransactionDetailPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { LimitsPage } from "@/pages/LimitsPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { OpenFinancePage } from "@/pages/OpenFinancePage";
import { InvestmentsPage } from "@/pages/InvestmentsPage";
import { PersonalizePage } from "@/pages/PersonalizePage";
import { SettingsPage } from "@/pages/SettingsPage";

type Gate =
  | { state: "loading" }
  | { state: "anonymous" }
  | { state: "needs-phone"; session: SessionInfo }
  | { state: "ready"; session: SessionInfo };

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  const route = useHashRoute();

  // Tema antes do primeiro paint já foi aplicado em main.tsx; aqui ligamos a
  // ponte com o hub (quando embutidos) e reaplicamos por segurança.
  useEffect(() => {
    applyTheme(loadTheme());
    return initHubThemeSync(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    if (!session.authenticated) return setGate({ state: "anonymous" });
    if (!session.phone) return setGate({ state: "needs-phone", session });
    setGate({ state: "ready", session });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (gate.state === "loading") {
    return <div className="flex min-h-dvh items-center justify-center text-[13px] text-muted-foreground">carregando…</div>;
  }
  if (gate.state === "anonymous") return <LoginPage onLogged={refresh} />;
  if (gate.state === "needs-phone") return <PhoneLinkPage session={gate.session} onLinked={refresh} />;

  async function sair() {
    await logout();
    refresh();
  }

  return (
    <Shell route={route} session={gate.session} onLogout={sair}>
      {renderRoute(route)}
    </Shell>
  );
}

function renderRoute(route: ReturnType<typeof useHashRoute>) {
  switch (route.name) {
    case "dashboard":
      return <DashboardPage />;
    case "transactions":
      return <TransactionsPage month={route.month} />;
    case "transaction":
      return <TransactionDetailPage id={route.id} />;
    case "accounts":
      return <AccountsPage />;
    case "limits":
      return <LimitsPage />;
    case "notifications":
      return <NotificationsPage />;
    case "openfinance":
      return <OpenFinancePage />;
    case "investments":
      return <InvestmentsPage />;
    case "personalize":
      return <PersonalizePage />;
    case "settings":
      return <SettingsPage />;
  }
}
