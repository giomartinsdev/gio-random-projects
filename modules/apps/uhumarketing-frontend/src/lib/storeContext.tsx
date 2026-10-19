// O contexto do Store vive num arquivo próprio para que existam DOIS providers
// (mock e backend) sem que um importe o outro. Se o provider remoto importasse
// `store.tsx`, o mock inteiro — e os dados de exemplo — iriam para o bundle de
// quem escolheu o backend real.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Store } from "./store";

export const StoreContext = createContext<Store | null>(null);

export function StoreContextBridge({ value, children }: { value: Store; children: ReactNode }) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore precisa estar dentro de um provider");
  return ctx;
}

/** Atalhos de leitura: id → objeto. */
export function useLookup() {
  const { templates, segments, campaigns, flows } = useStore();
  return useMemo(
    () => ({
      template: (id?: string) => templates.find((t) => t.id === id),
      segment: (id?: string) => segments.find((s) => s.id === id),
      campaign: (id?: string) => campaigns.find((c) => c.id === id),
      flow: (id?: string) => flows.find((f) => f.id === id),
    }),
    [templates, segments, campaigns, flows],
  );
}
