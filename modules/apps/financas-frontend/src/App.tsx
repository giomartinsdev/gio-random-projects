import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Shell } from "@/components/Shell";
import { PortaoLogin } from "@/components/PortaoLogin";
import { LandingPage } from "@/modules/landing/LandingPage";
import { EntrarPage } from "@/modules/auth/EntrarPage";
import { PrivacidadePage } from "@/modules/legal/PrivacidadePage";
import { TermosPage } from "@/modules/legal/TermosPage";
import { ContasPage } from "@/modules/contas/ContasPage";
import { TransacionalPage } from "@/modules/transacional/TransacionalPage";
import { AssetManagerPage } from "@/modules/asset-manager/AssetManagerPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";

// "/" é a landing pública -- captura de lead, sem nenhuma checagem de
// sessão. O produto de verdade mora em "/app/*", atrás do PortaoLogin
// (que hoje sonda /api/me em contas-api e, se não houver sessão,
// manda a pessoa de volta pra landing em vez de mostrar um gate cru).
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/entrar" element={<EntrarPage />} />
        <Route path="/privacidade" element={<PrivacidadePage />} />
        <Route path="/termos" element={<TermosPage />} />
        <Route
          path="/app/*"
          element={
            <PortaoLogin>
              <Shell>
                <Routes>
                  <Route path="/" element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="contas" element={<ContasPage />} />
                  <Route path="transacional" element={<TransacionalPage />} />
                  <Route path="investimentos" element={<AssetManagerPage />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </Shell>
            </PortaoLogin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
