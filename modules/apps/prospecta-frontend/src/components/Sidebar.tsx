import type { ComponentType } from "react";
import {
  Building2,
  ChevronsUpDown,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Settings,
  Users,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadConfig } from "@/lib/config";
import { navigate, type RouteName } from "@/lib/useHashRoute";
import { Orb } from "./ui/Orb";

// Sidebar de 248px (poc.pen §V1): brand com orb, workspace, MENU, nav e user.
const NAV: { route: RouteName; label: string; icon: ComponentType<LucideProps> }[] = [
  { route: "cockpit", label: "Cockpit", icon: LayoutDashboard },
  { route: "campanha", label: "Campanhas", icon: Megaphone },
  { route: "leads", label: "Leads", icon: Users },
  { route: "conversas", label: "Conversas", icon: MessageSquare },
  { route: "configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar({ route }: { route: RouteName }) {
  const cfg = loadConfig();
  const initials = cfg.userName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-4 py-5">
      <div className="flex items-center gap-2.5 pb-2">
        <Orb state="prospecting" size={22} glow={false} />
        <span className="text-[17px] font-semibold tracking-tight text-fg">Prospecta</span>
      </div>

      <div className="flex w-full items-center gap-2.5 rounded-sm bg-elevated px-3 py-2.5">
        <Building2 size={16} className="shrink-0 text-accent-light" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{cfg.workspace}</span>
          <span className="truncate text-[12px] text-fg-3">{cfg.plan}</span>
        </div>
        <ChevronsUpDown size={15} className="shrink-0 text-fg-3" />
      </div>

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
          {initials || "MR"}
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{cfg.userName}</span>
          <span className="truncate text-[12px] text-fg-3">{cfg.userRole}</span>
        </div>
      </div>
    </aside>
  );
}
