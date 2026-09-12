import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Shell } from "@/components/Shell";
import { PortaoLogin } from "@/components/PortaoLogin";
import { ContasPage } from "@/modules/contas/ContasPage";
import { TransacionalPage } from "@/modules/transacional/TransacionalPage";
import { AssetManagerPage } from "@/modules/asset-manager/AssetManagerPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";

export default function App() {
  return (
    <PortaoLogin>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/contas" element={<ContasPage />} />
            <Route path="/transacional" element={<TransacionalPage />} />
            <Route path="/investimentos" element={<AssetManagerPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </PortaoLogin>
  );
}
