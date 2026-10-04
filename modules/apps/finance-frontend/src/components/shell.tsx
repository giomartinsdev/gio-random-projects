import type { ReactNode } from "react";
import {
  Bell,
  LayoutDashboard,
  Link2,
  Receipt,
  Settings,
  Target,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefFor, type Route } from "@/lib/router";
import type { SessionInfo } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";

type Item = { route: Route; label: string; icon: ReactNode };

const NAV: Item[] = [
  { route: { name: "dashboard" }, label: "Dashboard", icon: <LayoutDashboard /> },
  { route: { name: "transactions" }, label: "Transações", icon: <Receipt /> },
  { route: { name: "accounts" }, label: "Contas", icon: <Wallet /> },
  { route: { name: "limits" }, label: "Limites", icon: <Target /> },
  { route: { name: "notifications" }, label: "Notificações", icon: <Bell /> },
  { route: { name: "openfinance" }, label: "Open Finance", icon: <Link2 /> },
  { route: { name: "settings" }, label: "Ajustes", icon: <Settings /> },
];

// O shell do site: barra lateral fixa (o mapa de tudo, clicável) + topo com a
// pessoa. Em telas pequenas a lateral vira uma faixa rolável no topo.
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
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-card md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Wallet className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="display text-[15px]">finance</p>
            <p className="text-[11px] text-muted-foreground">gestão financeira</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-6 scroll-thin">
          {NAV.map((item) => {
            const on = active === item.route.name;
            return (
              <a
                key={item.route.name}
                href={hrefFor(item.route)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors md:shrink",
                  on
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <span className="[&_svg]:size-4">{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col md:h-dvh">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="truncate text-[13px] text-muted-foreground">
            {session.name || session.email}
          </p>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={onLogout}
              className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Sair
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 md:overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-6xl px-5 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function topLevel(route: Route): Route["name"] {
  return route.name === "transaction" ? "transactions" : route.name;
}
