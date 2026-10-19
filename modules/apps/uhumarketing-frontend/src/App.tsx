import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";
import { StoreProvider } from "@/lib/store";
import { navigate, navigatePublic, useHashRoute, type AppRoute } from "@/lib/useHashRoute";
import { Sidebar } from "@/components/Sidebar";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage, SignupPage } from "@/pages/AuthPages";
import { DashboardPage } from "@/pages/DashboardPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { FlowsPage } from "@/pages/FlowsPage";
import { FlowEditorPage } from "@/pages/FlowEditorPage";
import { AudiencesPage } from "@/pages/AudiencesPage";
import { SendsPage } from "@/pages/SendsPage";
import { SettingsPage } from "@/pages/SettingsPage";

// Raiz da SPA. Duas zonas, como no prospecta:
//   · pública — landing/login/cadastro (tema claro);
//   · app     — shell escuro (sidebar + tela), atrás de sessão mock.
// Sem sessão, qualquer rota #/app cai no login; o inverso também vale.
function Shell() {
  const route = useHashRoute();
  const { user, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!user && route.kind === "app") navigatePublic("login");
    if (user && route.kind === "public" && route.name !== "landing") navigate("dashboard");
  }, [loading, user, route]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-bg text-fg-2">
        <Loader2 size={20} className="animate-spin text-accent-light" />
        <span className="text-[14px]">Abrindo a demonstração…</span>
      </div>
    );
  }

  if (route.kind === "public") {
    if (route.name === "landing") return <LandingPage />;
    if (route.name === "login") return <LoginPage />;
    return <SignupPage />;
  }

  if (!user) return <LoginPage />;

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar route={route.name} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Screen route={route.name} param={route.param} />
      </main>
    </div>
  );
}

function Screen({ route, param }: { route: AppRoute; param?: string }) {
  switch (route) {
    case "dashboard":
      return <DashboardPage />;
    case "templates":
      return <TemplatesPage />;
    case "campanhas":
      return <CampaignsPage />;
    case "fluxos":
      return <FlowsPage />;
    case "fluxo":
      return <FlowEditorPage flowId={param} />;
    case "audiencias":
      return <AudiencesPage />;
    case "envios":
      return <SendsPage />;
    case "configuracoes":
      return <SettingsPage />;
  }
}

export default function App() {
  return (
    <SessionProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </SessionProvider>
  );
}
