import type { ComponentType } from "react";
import {
  Building2,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  Settings,
  Users,
  type LucideProps,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useAsync } from "@/lib/useAsync";
import { useConfig } from "@/lib/useConfig";
import { isConfigured } from "@/lib/config";
import { navigate, navigatePublic, type AppRoute } from "@/lib/useHashRoute";
import { Orb } from "./ui/Orb";

// Sidebar de 248px (poc.pen §V1): brand com orb, workspace, MENU, nav e user.
const NAV: { route: AppRoute; label: string; icon: ComponentType<LucideProps> }[] = [
  { route: "cockpit", label: "Cockpit", icon: LayoutDashboard },
  { route: "campanha", label: "Campanhas", icon: Megaphone },
  { route: "leads", label: "Leads", icon: Users },
  { route: "conversas", label: "Conversas", icon: MessageSquare },
  { route: "configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar({ route }: { route: AppRoute }) {
  const cfg = useConfig();
  const configured = isConfigured(cfg);
  const company = useAsync(() => api.company(cfg.companyId), [], configured);
  const { user, company: sessionCompany, logout } = useAuth();

  // Sessão tem prioridade; o modo operador (X-API-Key) continua como fallback.
  const workspace = user ? sessionCompany?.name ?? "Sua empresa" : configured ? company.data?.name ?? "Empresa" : "Sem empresa";
  const subtitle = user
    ? user.email
    : configured
      ? company.loading
        ? "carregando…"
        : company.error
          ? "não carregada"
          : cfg.companyId
      : "Configure a API";

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-4 py-5">
      <div className="flex items-center gap-2.5 pb-2">
        <Orb state="prospecting" size={22} glow={false} />
        <span className="text-[17px] font-semibold tracking-tight text-fg">Prospecta</span>
      </div>

      <button
        onClick={() => navigate("configuracoes")}
        className="flex w-full items-center gap-2.5 rounded-sm bg-elevated px-3 py-2.5 text-left transition-colors hover:bg-elevated/80"
      >
        <Building2 size={16} className="shrink-0 text-accent-light" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{workspace}</span>
          <span className="truncate text-[12px] text-fg-3">{subtitle}</span>
        </div>
        <ChevronsUpDown size={15} className="shrink-0 text-fg-3" />
      </button>

      <div className="px-2 pt-2">
        <span className="caps">Menu</span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ route: r, label, icon: Icon }) => {
          const active = r === route;
          return (
            <button
              key={r}
              onClick={() => navigate(r)}
              className={cn(
                "flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-[14px] transition-colors",
                active ? "bg-elevated font-medium text-fg" : "text-fg-2 hover:bg-elevated/60 hover:text-fg",
              )}
            >
              <Icon size={18} className={cn("shrink-0", active ? "text-accent-light" : "text-fg-2")} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 rounded-sm px-2 py-2.5">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">
          {user ? user.name.slice(0, 1).toUpperCase() : <Orb state="idle" size={16} glow={false} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{user ? user.name : "Operador"}</span>
          <span className="truncate text-[12px] text-fg-3">{user ? "sessão ativa" : "sessão local"}</span>
        </div>
        {user && (
          <button
            onClick={async () => {
              await logout();
              navigatePublic("login");
            }}
            title="Sair"
            aria-label="Sair"
            className="shrink-0 text-fg-3 transition-colors hover:text-fg"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
