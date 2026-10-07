import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { isConfigured, loadConfig, subscribeConfig, type ProspectaConfig } from "./config";

// Config reativa: reflete o localStorage e re-renderiza quando ela muda (salvar
// em Configurações ou mexer em outra aba).
export function useConfig(): ProspectaConfig {
  const [cfg, setCfg] = useState<ProspectaConfig>(() => loadConfig());
  useEffect(() => subscribeConfig(() => setCfg(loadConfig())), []);
  return cfg;
}

// Uma tela mostra dados reais quando há identidade utilizável:
//   · modo cliente — sessão (cookie) + a empresa dela, sem X-API-Key;
//   · modo operador — X-API-Key + id da empresa no localStorage.
// Devolve a config efetiva (com o companyId da sessão injetado) ou null.
export function useConfigured(): ProspectaConfig | null {
  const cfg = useConfig();
  const { company } = useAuth();
  if (company) return { ...cfg, companyId: cfg.companyId || company.id };
  return isConfigured(cfg) ? cfg : null;
}
