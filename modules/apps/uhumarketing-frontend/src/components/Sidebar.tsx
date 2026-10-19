import type { ComponentType } from "react";
import {
  BarChart3,
  BookUser,
  ChevronDown,
  LogOut,
  Megaphone,
  MessageSquareCode,
  ScrollText,
  Settings,
  Workflow,
  type LucideProps,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { navigate, navigatePublic, type AppRoute } from "@/lib/useHashRoute";
import { Orb } from "./ui/Orb";

// Sidebar de 248px (mesma anatomia do prospecta): brand, workspace, MENU, nav
// e usuário. "Mensagens" é o único item sem rota: ele aponta para
// Envios com filtro, e o submenu de fluxos vive dentro de Automação.
const NAV: { route: AppRoute; label: string; icon: ComponentType<LucideProps>; badge?: string }[] = [
  { route: "dashboard", label: "Visão geral", icon: BarChart3 },
  { route: "templates", label: "Templates Meta", icon: MessageSquareCode },
  { route: "campanhas", label: "Campanhas", icon: Megaphone },
  { route: "fluxos", label: "Automação", icon: Workflow },
  { route: "audiencias", label: "Audiências", icon: BookUser },
  { route: "envios", label: "Envios", icon: ScrollText },
  { route: "configuracoes", label: "Configurações", icon: Settings },
];

/** "America/Sao_Paulo" → "São Paulo". */
const TZ_LABEL: Record<string, string> = {
  "America/Sao_Paulo": "São Paulo",
  "America/Bahia": "Bahia",
};

export function Sidebar({ route }: { route: AppRoute }) {
  const { workspace, campaigns, flows } = useStore();
  const { user, logout } = useSession();

  const workspaceTimezoneLabel = TZ_LABEL[workspace.timezone] ?? workspace.timezone;
  const quality = workspace.quality;
  const running = campaigns.filter((c) => c.status === "running").length;
  const activeFlows = flows.filter((f) => f.status === "active").length;

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-4 py-5">
      <div className="flex items-center gap-2.5 pb-2">
        <Orb state={running > 0 ? "running" : "idle"} size={22} glow={false} />
        <span className="text-[17px] font-semibold tracking-tight text-fg">uhumarketing</span>
      </div>

      <button
        onClick={() => navigate("configuracoes")}
        className="flex w-full items-center gap-2.5 rounded-sm bg-elevated px-3 py-2.5 text-left transition-colors hover:bg-elevated/80"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs bg-accent-soft text-[12px] font-semibold uppercase text-accent-light">
          {workspace.name.slice(0, 1) || "•"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{workspace.name}</span>
          <span className="truncate text-[12px] text-fg-3">
            {workspace.plan} · {workspaceTimezoneLabel}
          </span>
        </div>
        <ChevronDown size={15} className="shrink-0 text-fg-3" />
      </button>

      <div className="px-2 pt-2">
        <span className="caps">Menu</span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ route: r, label, icon: Icon }) => {
          const active = r === route || (route === "fluxo" && r === "fluxos");
          let badge: string | undefined;
          if (r === "campanhas" && running > 0) badge = String(running);
          if (r === "fluxos" && activeFlows > 0) badge = String(activeFlows);
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
              <span className="flex-1 truncate">{label}</span>
              {badge && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-light">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="rounded-sm border border-line bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="caps">{quality ? "Qualidade do número" : "WhatsApp"}</span>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              quality === "green" ? "bg-success" : quality === "yellow" ? "bg-warn" : quality === "red" ? "bg-danger" : "bg-line",
            )}
          />
        </div>
        <p className="mt-1.5 font-mono text-[11px] text-fg-2">
          {workspace.whatsappNumber || "sem número conectado"}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-fg-3">
          {workspace.whatsappNumber
            ? workspace.messagingLimit || "qualidade informada pela Meta"
            : "conecte em Configurações para disparar"}
        </p>
      </div>

      <div className="flex items-center gap-2.5 rounded-sm px-2 py-2.5">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">
          {user ? user.name.slice(0, 1).toUpperCase() : "?"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-medium text-fg">{user?.name ?? "Operador"}</span>
          <span className="truncate text-[12px] text-fg-3">{user?.email ?? "sessão local"}</span>
        </div>
        {user && (
          <button
            onClick={() => {
              logout();
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
