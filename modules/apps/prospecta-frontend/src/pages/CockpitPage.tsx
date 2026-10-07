import { Mail, MessageCircle, Search, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { AGENT_RUNS, METRICS, LEADS as LEADS_FALLBACK } from "@/lib/fixtures";
import type { Lead, Paged } from "@/lib/types";
import { AgentBadge, StatusBadge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardHead } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Table, TableBody, TableHead, TableRow } from "@/components/ui/Table";
import { Orb } from "@/components/ui/Orb";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Topbar } from "@/components/Topbar";

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  qualified: { label: "Qualificado", tone: "accent" },
  replied: { label: "Respondeu", tone: "success" },
  contacted: { label: "Abordado", tone: "muted" },
};

export function CockpitPage() {
  const leads = useAsync<Paged<Lead>>(() => api.leads(), { items: LEADS_FALLBACK, next: null });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Cockpit"
        right={
          <>
            <AgentBadge label="Agentes ativos" state="prospecting" />
            <Input icon={<Search size={16} />} placeholder="Buscar leads…" className="w-[240px]" />
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto scroll-thin px-7 pb-7 pt-6">
        <div className="flex gap-4">
          {METRICS.map((m) => (
            <Card key={m.label} className="flex flex-1 flex-col gap-3 p-[18px]">
              <span className="text-[13px] text-fg-2">{m.label}</span>
              <span className="text-[28px] font-semibold leading-none tracking-tight text-fg">{m.value}</span>
              <div className="flex items-center gap-1.5">
                <TrendingUp size={15} className="text-success" />
                <span className="text-[12px] font-medium text-success">{m.delta}</span>
                <span className="text-[12px] text-fg-3">{m.period}</span>
              </div>
            </Card>
          ))}
        </div>

        <Card elevated className="flex flex-col gap-4 rounded-lg p-[22px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Orb state="prospecting" size={22} glow={false} />
              <h2 className="text-[16px] font-semibold text-fg">Agentes em ação</h2>
            </div>
            <span className="font-mono text-[12px] text-fg-3">rodada #142 · atualizado agora</span>
          </div>
          {AGENT_RUNS.map((run) => (
            <div key={run.agent} className="flex items-center gap-4">
              <Orb state="researching" size={28} glow={false} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-medium text-fg">{run.agent}</span>
                <span className="truncate text-[12px] text-fg-2">{run.task}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-[150px] overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${run.pct}%` }} />
                </div>
                <span className="w-9 font-mono text-[12px] text-fg-2">{run.pct}%</span>
              </div>
            </div>
          ))}
        </Card>

        <div className="flex items-start gap-4">
          <Table className="min-w-0 flex-1">
            <TableHead>
              <div className="flex w-full items-center justify-between">
                <CardHead title="Leads do agente" />
                <span className="font-mono text-[12px] text-fg-3">{leads.data.items.length * 21} novos hoje</span>
              </div>
            </TableHead>
            <TableBody>
              {leads.data.items.map((lead) => {
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
              })}
            </TableBody>
          </Table>

          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
