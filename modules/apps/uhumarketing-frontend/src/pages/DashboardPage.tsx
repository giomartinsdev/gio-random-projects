import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  Coins,
  Eye,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Send as SendIcon,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { kpisFrom, seriesFor, useStore, useLookup } from "@/lib/store";
import { useSession } from "@/lib/session";
import { compact, fmtDateTime, money, num, pct, ago, fmtDate } from "@/lib/format";
import type { Range } from "@/lib/types";
import { Card, CardHead, EngineCard, StatCard } from "@/components/ui/Card";
import { FunnelRow, LineChart } from "@/components/ui/Charts";
import { Segmented } from "@/components/ui/Input";
import { Topbar, PageBody, PageHeader } from "@/components/Topbar";
import { CampaignStatusBadge } from "@/components/Status";
import { Button } from "@/components/ui/Button";
import { navigate } from "@/lib/useHashRoute";

const RANGES: { value: Range; label: string; days: number }[] = [
  { value: "7d", label: "7 dias", days: 7 },
  { value: "30d", label: "30 dias", days: 30 },
  { value: "90d", label: "90 dias", days: 90 },
];

const KIND_ICON = {
  campaign: Megaphone,
  template: Sparkles,
  flow: Workflow,
  send: SendIcon,
  billing: Coins,
  team: Users,
} as const;

export function DashboardPage() {
  const store = useStore();
  const lookup = useLookup();
  const { user } = useSession();
  const [range, setRange] = useState<Range>("30d");

  const days = RANGES.find((r) => r.value === range)!.days;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const kpis = useMemo(() => kpisFrom(store.campaigns, days), [store.campaigns, days]);
  // A série vem agregada de `sends` no servidor. O fallback devolve dias
  // zerados — nunca uma curva decorativa: inventar movimento num gráfico é a
  // mentira mais fácil de contar sem perceber.
  const series = useMemo(
    () => (store.series ? store.series(days) : seriesFor(store.campaigns, days)),
    [store.series, store.campaigns, days],
  );

  const running = store.campaigns.filter((c) => c.status === "running");
  const scheduled = store.campaigns.filter((c) => c.status === "scheduled");
  const activeFlows = store.flows.filter((f) => f.status === "active");
  const pendingTemplates = store.templates.filter((t) => t.status === "pending");
  const topTemplates = [...store.templates]
    .filter((t) => t.metrics.sent > 0)
    .sort((a, b) => b.metrics.read / Math.max(1, b.metrics.delivered) - a.metrics.read / Math.max(1, a.metrics.delivered))
    .slice(0, 4);

  const chartSeries = [
    { label: "Enviadas", values: series.map((p) => p.sent) },
    { label: "Lidas", values: series.map((p) => p.read), color: "#16A34A" },
  ];
  const labels = series.map((p) => fmtDate(p.date));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Visão geral"
        right={
          <>
            <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
            <Button size="sm" icon={<Sparkles size={15} />} onClick={() => navigate("campanhas")}>
              Nova campanha
            </Button>
          </>
        }
      />

      <PageBody>
        <PageHeader
          title={`${greeting}, ${(user?.name ?? store.user.name).split(" ")[0]}`}
          description="O que está no ar, o que está na fila e o que precisa da sua decisão."
          actions={
            <span className="inline-flex items-center gap-2 rounded-full bg-elevated px-3 py-1.5 font-mono text-[11px] text-fg-3">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              {activeFlows.length} fluxos ativos
            </span>
          }
        />

        <div className="flex flex-wrap gap-4">
          <StatCard
            label="Mensagens enviadas"
            value={num(kpis.sent)}
            hint={`${pct(kpis.deliveryRate)} entregues`}
            icon={<SendIcon size={16} />}
          />
          <StatCard
            label="Taxa de leitura"
            value={pct(kpis.readRate)}
            hint={`${num(kpis.read)} lidas`}
            icon={<Eye size={16} />}
          />
          <StatCard
            label="Respostas"
            value={num(kpis.replied)}
            hint={`${pct(kpis.replyRate)} de quem leu`}
            icon={<MessageCircle size={16} />}
          />
          <StatCard
            label="Conversões"
            value={num(kpis.converted)}
            hint={`${money(kpis.revenue)} em receita`}
            icon={<MousePointerClick size={16} />}
          />
          <StatCard
            label="Custo por conversão"
            value={money(kpis.costPerConversion)}
            hint={`${money(kpis.cost)} no período`}
            icon={<Target size={16} />}
          />
        </div>

        <div className="flex items-start gap-5">
          <Card className="flex min-w-0 flex-1 flex-col gap-4 p-5">
            <CardHead
              title="Enviadas e lidas"
              subtitle="Volume diário do período selecionado"
              right={
                <span className="font-mono text-[11px] text-fg-3">
                  {num(kpis.failed)} {kpis.failed === 1 ? "falha" : "falhas"}
                </span>
              }
            />
            <LineChart series={chartSeries} labels={labels} />
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
              <MiniKpi label="Entregues" value={num(kpis.delivered)} />
              <MiniKpi label="Lidas" value={num(kpis.read)} />
              <MiniKpi label="Respondidas" value={num(kpis.replied)} />
              <MiniKpi label="Opt-out" value={num(kpis.optOut)} />
            </div>
          </Card>

          <Card className="flex w-[318px] shrink-0 flex-col gap-4 p-5">
            <CardHead title="Funil do período" subtitle="Da fila à conversão" />
            <div className="flex flex-col gap-3.5">
              <FunnelRow label="Enviadas" value={kpis.sent} total={kpis.sent} />
              <FunnelRow label="Entregues" value={kpis.delivered} total={kpis.sent} color="#7DA6FF" />
              <FunnelRow label="Lidas" value={kpis.read} total={kpis.sent} color="#16A34A" />
              <FunnelRow label="Respondidas" value={kpis.replied} total={kpis.sent} color="#D97706" />
              <FunnelRow label="Convertidas" value={kpis.converted} total={kpis.sent} color="#A78BFA" />
            </div>
            <div className="flex items-center gap-2 rounded-sm bg-bg px-3 py-2.5">
              <Users size={14} className="shrink-0 text-fg-3" />
              <span className="text-[11px] leading-snug text-fg-3">
                {num(store.segments.reduce((a, s) => a + s.contactsCount, 0))} contatos em {store.segments.length} audiências.
              </span>
            </div>
          </Card>
        </div>

        <div className="flex items-start gap-5">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-fg">Rodando agora</h3>
              <button
                onClick={() => navigate("campanhas")}
                className="flex items-center gap-1 text-[12px] text-fg-3 transition-colors hover:text-fg-2"
              >
                ver todas <ArrowRight size={13} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {running.map((c) => {
                const template = lookup.template(c.templateId);
                const progress = c.metrics.audience
                  ? ((c.metrics.sent + c.metrics.queued) / c.metrics.audience) * 100
                  : 0;
                return (
                  <button key={c.id} onClick={() => navigate("campanhas")} className="text-left">
                    <EngineCard
                      title={c.name}
                      state="running"
                      text={
                        c.metrics.sent > c.metrics.audience
                          ? `${template?.displayName ?? "template"} · ${num(c.metrics.sent)} enviadas · ${num(c.metrics.audience)} na audiência atual`
                          : `${template?.displayName ?? "template"} · ${num(c.metrics.sent)} de ${num(c.metrics.audience)}`
                      }
                      progress={progress}
                      className="h-full transition-colors hover:border-line-strong"
                      right={<CampaignStatusBadge status={c.status} />}
                    />
                  </button>
                );
              })}
              {scheduled.map((c) => (
                <button key={c.id} onClick={() => navigate("campanhas")} className="text-left">
                  <EngineCard
                    title={c.name}
                    state="idle"
                    text={`${num(c.metrics.audience)} contatos · ${fmtDateTime(c.schedule.startAt)}`}
                    className="h-full transition-colors hover:border-line-strong"
                    right={<CampaignStatusBadge status={c.status} />}
                  />
                </button>
              ))}
              {running.length + scheduled.length === 0 && (
                <Card className="col-span-2 p-6 text-center text-[13px] text-fg-3">Nenhuma campanha no ar agora.</Card>
              )}
            </div>

            <Card className="flex flex-col gap-4 p-5">
              <CardHead
                title="Templates com melhor leitura"
                subtitle="Taxa de leitura sobre entregues"
                right={
                  <button
                    onClick={() => navigate("templates")}
                    className="flex items-center gap-1 text-[12px] text-fg-3 transition-colors hover:text-fg-2"
                  >
                    Templates <ArrowUpRight size={13} />
                  </button>
                }
              />
              <div className="flex flex-col divide-y divide-line">
                {topTemplates.map((t) => {
                  const rate = t.metrics.delivered ? (t.metrics.read / t.metrics.delivered) * 100 : 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => navigate("templates")}
                      className="flex items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs bg-elevated">
                        <MessageCircle size={15} className="text-accent-light" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-medium text-fg">{t.displayName}</span>
                        <span className="truncate font-mono text-[11px] text-fg-3">{t.name}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[13px] text-fg">{pct(rate)}</span>
                        <span className="block text-[11px] text-fg-3">{compact(t.metrics.sent)} envios</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card className="flex w-[340px] shrink-0 flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <CardHead title="Atividade" />
              <span className="caps">ao vivo</span>
            </div>
            <div className="flex min-h-0 flex-col overflow-y-auto scroll-thin">
              {store.activity.slice(0, 7).map((e) => {
                const Icon = KIND_ICON[e.kind];
                return (
                  <div key={e.id} className="flex animate-feed-in gap-3 border-b border-line/60 py-3 last:border-0">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs bg-elevated">
                      <Icon size={13} className="text-accent-light" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-medium leading-tight text-fg">{e.title}</span>
                      <span className="text-[11px] leading-snug text-fg-2">{e.detail}</span>
                      <span className="font-mono text-[10px] text-fg-3">{ago(e.at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {pendingTemplates.length > 0 && (
              <div className="rounded-sm border border-warn/30 bg-warn-soft p-3">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-warn" />
                  <span className="text-[12px] font-medium text-warn">
                    {pendingTemplates.length} {pendingTemplates.length === 1 ? "template" : "templates"} em análise
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-fg-2">
                  {pendingTemplates.map((t) => t.displayName).join(", ")}
                </p>
              </div>
            )}
          </Card>
        </div>
      </PageBody>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-fg-3">{label}</span>
      <span className="font-mono text-[15px] font-medium text-fg">{value}</span>
    </div>
  );
}
