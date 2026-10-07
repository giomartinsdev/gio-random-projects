import { useHashRoute } from "@/lib/useHashRoute";
import { Sidebar } from "@/components/Sidebar";
import { CockpitPage } from "@/pages/CockpitPage";
import { CampanhaPage } from "@/pages/CampanhaPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { ConversasPage } from "@/pages/ConversasPage";
import { ConfiguracoesPage } from "@/pages/ConfiguracoesPage";

// Shell da SPA: sidebar fixa de 248px + a tela da rota. O documento inteiro é
// dark (poc.pen §V1); não há scroll de página — cada tela rola por dentro.
export default function App() {
  const route = useHashRoute();

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
