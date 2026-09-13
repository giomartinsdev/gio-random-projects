import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { motion } from "framer-motion";
import { LayoutGrid, Wallet, ArrowLeftRight, LineChart, Dices, Sun, Moon, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadTheme, toggleTheme, type Theme } from "@/lib/theme";
import { logout } from "@/lib/auth";
import { useState } from "react";

const itens = [
  { to: "/app/dashboard", label: "Visão geral", icone: LayoutGrid },
  { to: "/app/contas", label: "Contas", icone: Wallet },
  { to: "/app/transacional", label: "Transações", icone: ArrowLeftRight },
  { to: "/app/investimentos", label: "Investimentos", icone: LineChart },
  { to: "/app/apostas", label: "Apostas", icone: Dices },
];

export function Shell({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Theme>(loadTheme());
  const navigate = useNavigate();

  async function sair() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center gap-1 border-b border-border bg-card px-3 py-2 md:h-dvh md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-4 md:py-6">
        <div className="mb-0 mr-4 flex items-center gap-2 px-1 md:mb-8 md:mr-0">
          <span className="font-display text-lg font-semibold tracking-tight text-primary">
            ◆
          </span>
          <span className="hidden font-display text-lg font-semibold tracking-tight md:inline">
            finanças
          </span>
        </div>

        <nav className="flex flex-1 flex-row gap-1 md:flex-col md:gap-1">
          {itens.map(({ to, label, icone: Icone }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
                  "hover:bg-secondary hover:text-foreground",
                  isActive && "bg-secondary text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-ativo"
                      className="absolute inset-0 -z-10 rounded-md bg-secondary"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icone size={17} strokeWidth={2} />
                  <span className="hidden md:inline">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => setTema(toggleTheme(tema))}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Alternar tema"
        >
          {tema === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span className="hidden md:inline">{tema === "dark" ? "Claro" : "Escuro"}</span>
        </button>

        <button
          onClick={sair}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Sair"
        >
          <LogOut size={17} />
          <span className="hidden md:inline">Sair</span>
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
