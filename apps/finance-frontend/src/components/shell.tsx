import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Bell,
  CreditCard,
  Database,
  Gauge,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Link,
  Settings,
} from "lucide-react";
import { hrefFor, type Route } from "@/lib/router";
import type { SessionInfo } from "@/lib/auth";
import { SearchOverlay, SearchTrigger, Kbd } from "@/components/search";
import { AiDots } from "@/components/aidots";
import { api, type OFAccount, type Transaction } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = { route: Route; label: string; icon: ReactNode };

const TABS: Tab[] = [
  { route: { name: "dashboard" }, label: "Painel", icon: <LayoutDashboard className="size-[15px]" /> },
  { route: { name: "transactions" }, label: "Transações", icon: <ArrowLeftRight className="size-[15px]" /> },
  { route: { name: "accounts" }, label: "Contas", icon: <Landmark className="size-[15px]" /> },
  { route: { name: "investments" }, label: "Investimentos", icon: <span className="text-[15px] leading-none">{`📈`}</span> },
  { route: { name: "credit" }, label: "Cartões e crédito", icon: <CreditCard className="size-[15px]" /> },
  { route: { name: "limits" }, label: "Limites", icon: <Gauge className="size-[15px]" /> },
  { route: { name: "notifications" }, label: "Avisos", icon: <Bell className="size-[15px]" /> },
  { route: { name: "openfinance" }, label: "Open Finance", icon: <Link className="size-[15px]" /> },
  { route: { name: "raw" }, label: "Dados brutos", icon: <Database className="size-[15px]" /> },
  { route: { name: "personalize" }, label: "Personalizar", icon: <LayoutGrid className="size-[15px]" /> },
  { route: { name: "settings" }, label: "Ajustes", icon: <Settings className="size-[15px]" /> },
];

// Shell V3: sidebar estável (232-236px) com marca em dots de IA, nav com
// indicador no ativo, user+status no rodapé; topbar com título/contexto e
// busca ⌘K. Em telas pequenas a sidebar vira nav rolável no topo.
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [accs, setAccs] = useState<OFAccount[]>([]);
  const [indexed, setIndexed] = useState(false);

  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener("finance:open-search", open);
    return () => window.removeEventListener("finance:open-search", open);
  }, []);

  useEffect(() => {
    if (indexed) return;
    let alive = true;
    Promise.all([api.transactions(""), api.ofAccounts().catch(() => ({ accounts: [] }))])
      .then(([t, a]) => {
        if (!alive) return;
        setTxs((t.transactions ?? []).slice(0, 200));
        setAccs(a.accounts ?? []);
        setIndexed(true);
      })
      .catch(() => setIndexed(true));
    return () => {
      alive = false;
    };
  }, [indexed]);

  const current = TABS.find((t) => t.route.name === active);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-[236px] shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-4">
          <AiDots width={30} height={28} tone="brand" />
          <div className="leading-tight">
            <p className="text-[14px] font-semibold tracking-tight">finance</p>
            <p className="font-mono text-[8.5px] text-fg-dim">operando · v3</p>
          </div>
        </div>
        <nav className="mt-1 flex flex-col gap-0.5 px-2">
          {TABS.map((t) => (
            <a
              key={t.route.name}
              href={hrefFor(t.route)}
              data-on={active === t.route.name}
              className={cn(
                "group flex h-[34px] items-center gap-2.5 rounded-[8px] px-2 transition-colors",
                active === t.route.name ? "bg-surface-2 text-fg" : "text-fg-dim hover:bg-surface-2/60 hover:text-fg",
              )}
            >
              <span className={cn(active === t.route.name && "text-accent")}>{t.icon}</span>
              <span className={cn("flex-1 text-[12.5px]", active === t.route.name ? "font-medium" : "font-normal")}>
                {t.label}
              </span>
              {active === t.route.name && <span className="size-[5px] rounded-full bg-accent" aria-hidden />}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="border-t border-border px-2 pb-2 pt-3">
          <div className="flex items-center gap-2.5 px-1">
            <span className="grid size-7 place-items-center rounded-full bg-surface-2 font-mono text-[9.5px] font-semibold">
              {(session.name || session.email || "GM").slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[11px] font-medium">{session.name || "Usuário"}</span>
              <span className="block truncate font-mono text-[8.5px] text-fg-dim">{session.email}</span>
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between px-1">
            <span className="pill text-[10px]"><span className="dot bg-up" />webhook ativo</span>
            <button onClick={onLogout} className="px-2 text-[11px] text-fg-dim transition-colors hover:text-fg">
              Sair
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-border bg-surface px-5 md:px-7">
          <span className="md:hidden"><AiDots width={26} height={24} tone="brand" /></span>
          <div className="leading-tight md:hidden">
            <p className="text-[13px] font-semibold">{current?.label ?? "Finance"}</p>
          </div>
          <div className="hidden leading-tight md:block">
            <p className="text-[15px] font-semibold tracking-tight">{current?.label ?? "Painel"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchTrigger onClick={() => setSearchOpen(true)} />
            <button className="hidden rounded-[10px] bg-fg px-3.5 py-1.5 text-[12.5px] font-medium text-bg sm:block">
              Registrar
            </button>
          </div>
        </header>

        {/* Nav rolável em telas pequenas */}
        <nav className="seg mx-5 mt-3 overflow-x-auto md:hidden">
          {TABS.map((t) => (
            <a key={t.route.name} href={hrefFor(t.route)} data-on={active === t.route.name}>
              {t.label}
            </a>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} transactions={txs} accounts={accs} />
    </div>
  );
}

function topLevel(route: Route): Route["name"] {
  return route.name === "transaction" ? "transactions" : route.name;
}

// re-export para páginas que queiram Kbd
export { Kbd };