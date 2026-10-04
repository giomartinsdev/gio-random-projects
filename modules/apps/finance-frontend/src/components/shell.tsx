import type { ReactNode } from "react";
import { Search, Wallet } from "lucide-react";
import { hrefFor, type Route } from "@/lib/router";
import type { SessionInfo } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";

type Tab = { route: Route; label: string };

// A navegação do cockpit: um controle SEGMENTADO em pílula no topo (o
// `.switch` do seuimposto), não uma sidebar.
const TABS: Tab[] = [
  { route: { name: "dashboard" }, label: "Painel" },
  { route: { name: "transactions" }, label: "Transações" },
  { route: { name: "accounts" }, label: "Contas" },
  { route: { name: "limits" }, label: "Limites" },
  { route: { name: "notifications" }, label: "Avisos" },
  { route: { name: "openfinance" }, label: "Open Finance" },
];

// Shell de tela cheia: barra de topo fixa + frame que ocupa o resto, sem scroll
// de página (o scroll vive dentro das colunas). Espelha a estrutura `.pbar` +
// `.frame` do original.
export function Shell({
  route,
  session,
  onLogout,
  children,
}: {
  route: Route;
  session: SessionInfo;
  onLogout: () => void;
  children: ReactNode;
}) {
  const active = topLevel(route);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <a href={hrefFor({ name: "dashboard" })} className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Wallet className="size-3.5" />
          </span>
          <span className="display text-[15px]">finance</span>
        </a>

        <nav className="seg ml-2 hidden md:inline-flex">
          {TABS.map((t) => (
            <a key={t.route.name} href={hrefFor(t.route)} data-on={active === t.route.name}>
              {t.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="pill hidden lg:inline-flex">
            <Search className="size-3" />
            {session.name || session.email}
          </span>
          <ThemeToggle />
          <button
            onClick={onLogout}
            className="rounded-full px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:bg-fg/8 hover:text-fg"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Nav rolável em telas pequenas (a segmentada some no md). */}
      <nav className="seg m-3 overflow-x-auto md:hidden">
        {TABS.map((t) => (
          <a key={t.route.name} href={hrefFor(t.route)} data-on={active === t.route.name}>
            {t.label}
          </a>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function topLevel(route: Route): Route["name"] {
  return route.name === "transaction" ? "transactions" : route.name;
}
