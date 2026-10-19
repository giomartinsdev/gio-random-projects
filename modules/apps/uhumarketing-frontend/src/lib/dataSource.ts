// Origem dos dados da POC: Demonstração (localStorage) ou Backend real
// (uhumarketing-api).
//
// A escolha fica no localStorage e não no build: a mesma build roda nos dois
// modos, e trocar não exige reiniciar o Vite. Quem abre o app pela primeira vez
// cai no modo que VITE_UHU_DATA_SOURCE definir ("demo" por padrão) — assim o
// link de demonstração continua funcionando sem backend no ar.

import { useCallback, useEffect, useState } from "react";

export type DataSource = "demo" | "backend";

const KEY = "uhumarketing:data-source";
const ENV_DEFAULT: DataSource =
  import.meta.env.VITE_UHU_DATA_SOURCE === "backend" ? "backend" : "demo";

export function readDataSource(): DataSource {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "demo" || raw === "backend") return raw;
  } catch {
    // storage bloqueado: usa o default do build
  }
  return ENV_DEFAULT;
}

export function writeDataSource(source: DataSource): void {
  try {
    localStorage.setItem(KEY, source);
  } catch {
    // sem storage, a escolha vale só até o reload
  }
}

/** Hook com a escolha reativa — trocar recarrega a árvore de dados. */
export function useDataSource(): [DataSource, (next: DataSource) => void] {
  const [source, setSource] = useState<DataSource>(readDataSource);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "demo" || e.newValue === "backend")) {
        setSource(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const change = useCallback((next: DataSource) => {
    writeDataSource(next);
    setSource(next);
  }, []);

  return [source, change];
}

export const API_URL = import.meta.env.VITE_UHU_API_URL ?? "http://localhost:8195";
