import type { ReactNode } from "react";
import { Mail, MessageCircle, Search, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useActivityStream } from "@/lib/useActivityStream";
import { useConfigured } from "@/lib/useConfig";
import type { AgentRunEvent, Campaign, Lead, Paged } from "@/lib/types";
import { AgentBadge, StatusBadge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardHead } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Orb } from "@/components/ui/Orb";
import { Table, TableBody, TableHead, TableRow } from "@/components/ui/Table";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ConfigureApiState, EmptyState, ErrorState, LoadingState } from "@/components/ApiState";
import { Topbar } from "@/components/Topbar";

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  qualified: { label: "Qualificado", tone: "accent" },
  replied: { label: "Respondeu", tone: "success" },
  contacted: { label: "Abordado", tone: "muted" },
};

// Considera a campanha "ativa" pelos estados que o backend pode reportar.
const ACTIVE_CAMPAIGN_STATES = new Set(["running", "active", "started", "prospecting"]);

export function CockpitPage() {
  const cfg = useConfigured();
  const leads = useAsync<Paged<Lead>>(() => api.leads(), [], cfg !== null);
  const campaigns = useAsync<Paged<Campaign>>(() => api.campaigns(), [], cfg !== null);
  const { events, live } = useActivityStream(cfg !== null);

  if (!cfg) return <Shell><ConfigureApiState /></Shell>;

  const leadItems = leads.data?.items ?? [];
  const campaignItems = campaigns.data?.items ?? [];
  const metrics = [
    { label: "Leads carregados", value: leadItems.length, hint: "nesta página" },
    { label: "Qualificados", value: leadItems.filter((l) => l.status === "qualified").length, hint: "status qualified" },
    { label: "Responderam", value: leadItems.filter((l) => l.status === "replied").length, hint: "status replied" },
    { label: "Campanhas ativas", value: campaignItems.filter((c) => ACTIVE_CAMPAIGN_STATES.has(c.status)).length, hint: `de ${campaignItems.length}` },
  ];

  const latestRuns = dedupeRuns(events).slice(0, 6);

  return (
    <Shell>
      <Topbar
        title="Cockpit"
        right={
          <>
            <AgentBadge
              label={live ? "Agentes ao vivo" : "Sem atividade"}
              state={live ? "prospecting" : "idle"}
            />
            <Input icon={<Search size={16} />} placeholder="Buscar leads…" className="w-[240px]" disabled />
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto scroll-thin px-7 pb-7 pt-6">
        <div className="flex gap-4">
          {metrics.map((m) => (
            <Card key={m.label} className="flex flex-1 flex-col gap-3 p-[18px]">
              <span className="text-[13px] text-fg-2">{m.label}</span>
              <span className="text-[28px] font-semibold leading-none tracking-tight text-fg">
                {leads.loading || campaigns.loading || leads.error || campaigns.error ? "—" : m.value}
              </span>
              <div className="flex items-center gap-1.5">
                <TrendingUp size={15} className="text-fg-3" />
                <span className="text-[12px] text-fg-3">{m.hint}</span>
              </div>
            </Card>
          ))}
        </div>
        <p className="-mt-3 text-[12px] text-fg-3">
          Métricas calculadas a partir dos dados reais carregados da API (o backend ainda não expõe endpoint de métricas).
        </p>

        <Card elevated className="flex flex-col gap-4 rounded-lg p-[22px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Orb state="prospecting" size={22} glow={false} />
              <h2 className="text-[16px] font-semibold text-fg">Agentes em ação</h2>
            </div>
            <span className="font-mono text-[12px] text-fg-3">feed /agent/activity</span>
          </div>
          {latestRuns.length === 0 ? (
            <EmptyState title="Nenhum agente em execução" hint="Os runs aparecem aqui ao vivo pelo SSE." />
          ) : (
            latestRuns.map((run) => (
              <div key={run.run_id} className="flex items-center gap-4">
                <Orb state="researching" size={28} glow={false} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-fg">{run.agent}</span>
                  <span className="truncate text-[12px] text-fg-2">{run.run_id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone={run.state === "done" ? "success" : run.state === "failed" ? "muted" : "accent"}>
                    {run.state}
                  </StatusBadge>
                  {run.metric && (
                    <span className="font-mono text-[12px] text-fg-2">
                      {Object.entries(run.metric)[0].join(" ")}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </Card>

        <div className="flex items-start gap-4">
          <Table className="min-w-0 flex-1">
            <TableHead>
              <div className="flex w-full items-center justify-between">
                <CardHead title="Leads" />
                <span className="font-mono text-[12px] text-fg-3">{leadItems.length} carregados</span>
              </div>
            </TableHead>
            <TableBody>
              {leads.loading ? (
                <LoadingState label="Carregando leads…" />
              ) : leads.error ? (
                <ErrorState error={leads.error} onRetry={leads.reload} compact />
              ) : leadItems.length === 0 ? (
                <EmptyState title="Nenhum lead ainda" hint="Os leads aparecem quando uma campanha começar a prospectar." />
              ) : (
                leadItems.map((lead) => {
                  const meta = STATUS_META[lead.status] ?? STATUS_META.contacted;
                  return (
                    <TableRow key={lead.id} className="gap-4">
                      <div className="flex w-[180px] shrink-0 flex-col">
                        <span className="truncate text-[14px] font-medium text-fg">{lead.company_name}</span>
                        <span className="truncate text-[12px] text-fg-3">{lead.segment}</span>
                      </div>
                      <div className="flex w-[120px] shrink-0 items-center gap-2 text-[13px] text-fg-2">
                        {lead.channel === "whatsapp" ? <MessageCircle size={14} /> : <Mail size={14} />}
                        {lead.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
                      </div>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          <ActivityFeed />
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

// Mantém só o estado mais recente por run_id, na ordem em que chegaram.
function dedupeRuns(events: AgentRunEvent[]): AgentRunEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.run_id) ? false : (seen.add(e.run_id), true)));
}
