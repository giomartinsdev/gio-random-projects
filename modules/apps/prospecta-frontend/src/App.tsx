import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { navigate, navigatePublic, useHashRoute, type AppRoute } from "@/lib/useHashRoute";
import { Sidebar } from "@/components/Sidebar";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { CockpitPage } from "@/pages/CockpitPage";
import { CampanhaPage } from "@/pages/CampanhaPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { ConversasPage } from "@/pages/ConversasPage";
import { ConfiguracoesPage } from "@/pages/ConfiguracoesPage";

// Raiz da SPA: provê a sessão (cookie) e escolhe entre a zona pública
// (landing/login/cadastro) e a zona do app (#/app/...), que é protegida.
export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

function Router() {
  const route = useHashRoute();
  const { user, loading } = useAuth();

  // Guardas: deslogado no app → /login; logado no login/cadastro → /app.
  useEffect(() => {
    if (loading) return;
    if (route.kind === "app" && !user) navigatePublic("login");
    if (route.kind === "public" && route.name !== "landing" && user) navigate("cockpit");
  }, [route, loading, user]);

  if (route.kind === "public") {
    if (route.name === "login") return user ? <Splash /> : <LoginPage />;
    if (route.name === "signup") return user ? <Splash /> : <SignupPage />;
    return <LandingPage />;
  }

  if (loading || !user) return <Splash />;
  return <AppShell route={route.name} />;
}

// Shell do app: sidebar fixa de 248px + a tela da rota. O documento inteiro é
// dark (poc.pen §V1); não há scroll de página — cada tela rola por dentro.
function AppShell({ route }: { route: AppRoute }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <Sidebar route={route} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {route === "cockpit" && <CockpitPage />}
        {route === "campanha" && <CampanhaPage />}
        {route === "leads" && <LeadsPage />}
        {route === "conversas" && <ConversasPage />}
        {route === "configuracoes" && <ConfiguracoesPage />}
      </main>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-dvh w-full items-center justify-center gap-3 bg-bg text-fg-2">
      <Loader2 size={20} className="animate-spin text-accent-light" />
      <span className="text-[14px]">carregando…</span>
    </div>
  );
}
