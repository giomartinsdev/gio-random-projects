import { useEffect, useState } from "react";
import { isConfigured, loadConfig, subscribeConfig, type ProspectaConfig } from "./config";

// Config reativa: reflete o localStorage e re-renderiza quando ela muda (salvar
// em Configurações ou mexer em outra aba). `useConfigured` devolve null quando
// falta chave/empresa — a tela então mostra o estado "Configure a API".
export function useConfig(): ProspectaConfig {
  const [cfg, setCfg] = useState<ProspectaConfig>(() => loadConfig());
  useEffect(() => subscribeConfig(() => setCfg(loadConfig())), []);
  return cfg;
}

export function useConfigured(): ProspectaConfig | null {
  const cfg = useConfig();
  return isConfigured(cfg) ? cfg : null;
}
