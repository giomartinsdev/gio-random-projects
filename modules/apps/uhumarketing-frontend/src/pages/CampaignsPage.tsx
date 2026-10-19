import { useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Copy,
  Megaphone,
  Pause,
  Play,
  Plus,
  Search,
  Send as SendIcon,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { useStore, useLookup } from "@/lib/store";
import { compact, fmtDateTime, money, num, pct } from "@/lib/format";
import type { Campaign, CampaignObjective, Channel } from "@/lib/types";
import { CHANNEL_LABEL, OBJECTIVE_LABEL } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/Card";
import { Drawer, Modal } from "@/components/ui/Drawer";
import { Table, TableBody, TableHead, TableRow, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Badge";
import { CampaignStatusBadge, ChannelLabel } from "@/components/Status";
import { FunnelRow } from "@/components/ui/Charts";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { EmptyState } from "@/components/States";
import { WhatsAppPreview } from "@/components/WhatsAppPreview";
import { navigate } from "@/lib/useHashRoute";
import { cn } from "@/lib/utils";

export function CampaignsPage() {
  const store = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.campaigns.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      return !q || c.name.toLowerCase().includes(q) || OBJECTIVE_LABEL[c.objective].toLowerCase().includes(q);
    });
  }, [store.campaigns, query, status]);

  const totals = useMemo(
    () =>
      store.campaigns.reduce(
        (acc, c) => ({
          sent: acc.sent + c.metrics.sent,
          replied: acc.replied + c.metrics.replied,
          converted: acc.converted + c.metrics.converted,
          revenue: acc.revenue + c.metrics.revenue,
        }),
        { sent: 0, replied: 0, converted: 0, revenue: 0 },
      ),
    [store.campaigns],
  );

  const campaign = store.campaigns.find((c) => c.id === selected) ?? null;

  /** Duplica campanha + fluxo, zerando métricas e voltando para rascunho. */
  function duplicate(source: Campaign) {
    const copy = store.createCampaign({
      ...source,
      name: `${source.name} (cópia)`,
      status: "draft",
      flowId: undefined,
      requiresApproval: true,
      notes: `Cópia de "${source.name}". Revise a oferta e a audiência antes de publicar.`,
    });
    const sourceFlow = store.flows.find((f) => f.id === source.flowId);
    if (sourceFlow) {
      const flow = store.createFlow({
        ...sourceFlow,
        name: `${sourceFlow.name} (cópia)`,
        status: "draft",
        campaignId: copy.id,
        lastRunAt: undefined,
      });
      store.updateCampaign(copy.id, { flowId: flow.id });
      store.logActivity({ kind: "campaign", title: "Campanha duplicada", detail: `${copy.name} · com fluxo`, refId: copy.id });
      setSelected(null);
      navigate("fluxo", flow.id);
      return;
    }
    store.logActivity({ kind: "campaign", title: "Campanha duplicada", detail: copy.name, refId: copy.id });
    setSelected(null);
    navigate("campanhas");
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Campanhas"
          left={<span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{filtered.length}</span>}
          right={
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Nova campanha
            </Button>
          }
        />

        <PageBody>
          <PageHeader
            title="Do objetivo ao envio"
            description="Cada campanha é um fluxo. A lista mostra o que está no ar, o que espera aprovação e o que já entregou resultado."
          />

          <div className="flex flex-wrap gap-4">
            <StatCard label="Campanhas" value={store.campaigns.length} hint={`${store.campaigns.filter((c) => c.status === "running").length} em execução`} icon={<Megaphone size={16} />} />
            <StatCard label="Mensagens" value={compact(totals.sent)} hint="acumulado das campanhas" icon={<SendIcon size={16} />} />
            <StatCard label="Conversões" value={compact(totals.converted)} hint={`${pct(totals.sent ? (totals.converted / totals.sent) * 100 : 0)} dos envios`} icon={<Target size={16} />} />
            <StatCard label="Receita atribuída" value={money(totals.revenue)} hint="cupons e links rastreados" />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              icon={<Search size={16} />}
              placeholder="Buscar campanha…"
              className="max-w-[300px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[170px]">
              <option value="all">Todos os status</option>
              <option value="running">Em execução</option>
              <option value="scheduled">Agendadas</option>
              <option value="paused">Pausadas</option>
              <option value="finished">Concluídas</option>
              <option value="draft">Rascunhos</option>
            </Select>
          </div>

          <Table>
            <TableHead>
              <Th className="w-[300px] shrink-0">Campanha</Th>
              <Th className="w-[120px] shrink-0">Status</Th>
              <Th className="w-[100px] shrink-0">Canal</Th>
              <Th className="hidden w-[110px] shrink-0 text-right md:block">Audiência</Th>
              <Th className="hidden w-[100px] shrink-0 text-right md:block">Envios</Th>
              <Th className="hidden w-[100px] shrink-0 text-right lg:block">Leitura</Th>
              <Th className="hidden w-[100px] shrink-0 text-right lg:block">Conversão</Th>
              <Th className="w-[40px] shrink-0" />
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <EmptyState title="Nenhuma campanha aqui" hint="Crie uma nova ou mude o filtro." icon={<Megaphone size={18} />} />
              ) : (
                filtered.map((c) => {
                  const readRate = c.metrics.delivered ? (c.metrics.read / c.metrics.delivered) * 100 : 0;
                  const convRate = c.metrics.sent ? (c.metrics.converted / c.metrics.sent) * 100 : 0;
                  return (
                    <TableRow key={c.id} onClick={() => setSelected(c.id)} selected={selected === c.id}>
                      <Td className="flex w-[300px] shrink-0 flex-col">
                        <span className="truncate text-[14px] font-medium text-fg">{c.name}</span>
                        <span className="truncate text-[11px] text-fg-3">
                          {OBJECTIVE_LABEL[c.objective]}
                          {c.flowId ? " · com fluxo" : ""}
                        </span>
                      </Td>
                      <Td className="w-[120px] shrink-0">
                        <CampaignStatusBadge status={c.status} />
                      </Td>
                      <Td className="w-[100px] shrink-0">
                        <ChannelLabel channel={c.channel} />
                      </Td>
                      <Td className="hidden w-[110px] shrink-0 text-right font-mono text-[12px] text-fg-2 md:block">
                        {compact(c.metrics.audience)}
                      </Td>
                      <Td className="hidden w-[100px] shrink-0 text-right font-mono text-[12px] text-fg-2 md:block">
                        {compact(c.metrics.sent)}
                      </Td>
                      <Td className="hidden w-[100px] shrink-0 text-right font-mono text-[12px] text-fg-2 lg:block">
                        {c.metrics.delivered ? pct(readRate) : "—"}
                      </Td>
                      <Td className="hidden w-[100px] shrink-0 text-right font-mono text-[12px] text-fg-2 lg:block">
                        {c.metrics.sent ? pct(convRate) : "—"}
                      </Td>
                      <Td className="flex w-[40px] shrink-0 justify-end">
                        <ChevronRight size={15} className="text-fg-3" />
                      </Td>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </PageBody>
      </div>

      <Drawer
        open={campaign !== null}
        title={campaign?.name ?? "Campanha"}
        subtitle={campaign ? `${OBJECTIVE_LABEL[campaign.objective]} · ${CHANNEL_LABEL[campaign.channel]}` : undefined}
        onClose={() => setSelected(null)}
        width={490}
        footer={
          campaign && (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                icon={<Copy size={14} />}
                onClick={() => duplicate(campaign)}
              >
                Duplicar
              </Button>
              {campaign.flowId ? (
                <Button size="sm" className="flex-1" icon={<Workflow size={14} />} onClick={() => navigate("fluxo", campaign.flowId)}>
                  Abrir fluxo
                </Button>
              ) : (
                <Button size="sm" className="flex-1" onClick={() => navigate("fluxos")}>
                  Ver automação
                </Button>
              )}
            </>
          )
        }
      >
        {campaign && <CampaignDetail campaign={campaign} />}
      </Drawer>

      <NewCampaignModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const store = useStore();
  const lookup = useLookup();
  const template = lookup.template(campaign.templateId);
  const segments = campaign.segmentIds.map((id) => lookup.segment(id)).filter(Boolean);
  const delivered = campaign.metrics.delivered;
  const readRate = delivered ? (campaign.metrics.read / delivered) * 100 : 0;
  const replyRate = campaign.metrics.read ? (campaign.metrics.replied / campaign.metrics.read) * 100 : 0;

  const isRunning = campaign.status === "running";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <CampaignStatusBadge status={campaign.status} />
        <Tag>{CHANNEL_LABEL[campaign.channel]}</Tag>
        <Tag>{campaign.schedule.throttlePerMinute}/min</Tag>
        {campaign.requiresApproval && <Tag>exige aprovação</Tag>}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          icon={isRunning ? <Pause size={14} /> : <Play size={14} />}
          onClick={() =>
            store.updateCampaign(campaign.id, {
              status: isRunning ? "paused" : "running",
              lastRunAt: isRunning ? campaign.lastRunAt : new Date().toISOString(),
            })
          }
        >
          {isRunning ? "Pausar" : "Ativar"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          icon={<SendIcon size={14} />}
          onClick={() => {
            // Disparo de demonstração: um envio por clique, para ver a fila
            // andar e os números do dashboard reagirem.
            const segment = segments[0];
            store.enqueueSend({
              campaignId: campaign.id,
              contactName: segment?.sample[0]?.name ?? "Contato demo",
              destination: segment?.sample[0]?.phone ?? "+55 11 90000-0000",
              templateName: template?.name ?? "template",
              status: "sent",
              couponCode: campaign.offer.enabled ? campaign.offer.codePattern.replace("{nome}", "DEMO") : undefined,
            });
            store.logActivity({
              kind: "send",
              title: "Disparo manual",
              detail: `${campaign.name} · 1 mensagem de teste`,
              refId: campaign.id,
            });
          }}
        >
          Enviar teste
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Mini label="Audiência" value={num(campaign.metrics.audience)} />
        <Mini label="Na fila" value={num(campaign.metrics.queued)} />
        <Mini label="Enviadas" value={num(campaign.metrics.sent)} />
        <Mini label="Entregues" value={num(campaign.metrics.delivered)} />
        <Mini label="Lidas" value={num(campaign.metrics.read)} />
        <Mini label="Respostas" value={num(campaign.metrics.replied)} />
        <Mini label="Conversões" value={num(campaign.metrics.converted)} />
        <Mini label="Receita" value={money(campaign.metrics.revenue)} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-sm bg-bg p-3.5">
        <FunnelRow label="Entregues" value={campaign.metrics.delivered} total={campaign.metrics.sent} />
        <FunnelRow label="Lidas" value={campaign.metrics.read} total={campaign.metrics.sent} color="#16A34A" />
        <FunnelRow label="Respondidas" value={campaign.metrics.replied} total={campaign.metrics.sent} color="#D97706" />
        <FunnelRow label="Convertidas" value={campaign.metrics.converted} total={campaign.metrics.sent} color="#A78BFA" />
        <div className="mt-1 flex justify-between border-t border-line pt-2 font-mono text-[11px] text-fg-3">
          <span>leitura {pct(readRate)}</span>
          <span>resposta {pct(replyRate)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Audiências</span>
        {segments.map((s) => (
          <div key={s!.id} className="flex items-center gap-2.5 rounded-sm bg-bg px-3 py-2.5">
            <Users size={14} className="shrink-0 text-fg-3" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{s!.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-fg-3">{compact(s!.contactsCount)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Janela de envio</span>
        <div className="flex items-start gap-2.5 rounded-sm bg-bg px-3 py-2.5">
          <CalendarClock size={14} className="mt-0.5 shrink-0 text-fg-3" />
          <div className="flex flex-col gap-0.5 text-[12px] text-fg-2">
            <span>
              {String(campaign.schedule.windowStart).padStart(2, "0")}h–{String(campaign.schedule.windowEnd).padStart(2, "0")}h ·{" "}
              {campaign.schedule.days.length === 7 ? "todos os dias" : "dias úteis"}
            </span>
            <span className="text-[11px] text-fg-3">
              vazão {campaign.schedule.throttlePerMinute} msg/min · {campaign.schedule.timezone}
            </span>
            <span className="text-[11px] text-fg-3">
              {campaign.status === "scheduled"
                ? `começa ${fmtDateTime(campaign.schedule.startAt)}`
                : campaign.lastRunAt
                  ? `última execução ${fmtDateTime(campaign.lastRunAt)}`
                  : `criada ${fmtDateTime(campaign.createdAt)}`}
            </span>
          </div>
        </div>
      </div>

      {campaign.offer.enabled && (
        <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-bg p-3.5">
          <span className="caps">Oferta</span>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-fg">{campaign.offer.discountLabel}</span>
            <Tag>{campaign.offer.kind}</Tag>
          </div>
          <span className="font-mono text-[11px] text-fg-2">{campaign.offer.codePattern}</span>
          <span className="text-[11px] text-fg-3">válida até {fmtDateTime(campaign.offer.validUntil)}</span>
        </div>
      )}

      {template && (
        <div className="flex flex-col gap-2">
          <span className="caps">Template</span>
          <WhatsAppPreview template={template} />
        </div>
      )}

      {campaign.notes && <Note>{campaign.notes}</Note>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-bg px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>
      <span className="font-mono text-[13px] text-fg">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------- nova campanha */

const OBJECTIVES: CampaignObjective[] = ["reativacao", "conversao", "awareness", "pos_venda"];

function NewCampaignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective>("reativacao");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [segmentId, setSegmentId] = useState(store.segments[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(store.templates.find((t) => t.status === "approved")?.id ?? "");
  const [withCoupon, setWithCoupon] = useState(true);
  const [error, setError] = useState("");

  function create() {
    if (!name.trim()) {
      setError("Dê um nome à campanha.");
      return;
    }
    const now = new Date().toISOString();
    const segment = store.segments.find((s) => s.id === segmentId);

    const campaign = store.createCampaign({
      name: name.trim(),
      objective,
      status: "draft",
      channel,
      templateId,
      segmentIds: [segmentId],
      schedule: {
        startAt: now,
        windowStart: 9,
        windowEnd: 18,
        days: [1, 2, 3, 4, 5],
        throttlePerMinute: 120,
        timezone: "America/Sao_Paulo",
      },
      offer: {
        enabled: withCoupon,
        kind: "cupom",
        codePattern: "UHU-{nome}",
        discountLabel: withCoupon ? "15% off" : "",
        validUntil: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
      requiresApproval: true,
      notes: "Criada na POC — o fluxo abre no editor para montar descoberta e saída.",
    });

    const flow = store.createFlow({
      name: `Fluxo · ${name.trim()}`,
      description: "Monte a descoberta, a oferta e a saída. Arraste blocos e conecte.",
      status: "draft",
      campaignId: campaign.id,
      nodes: [
        {
          id: "n_start",
          type: "trigger.manual",
          title: "Disparo manual",
          x: 60,
          y: 200,
          config: { type: "trigger.manual", note: "Aprovação humana antes de enviar" },
        },
        {
          id: "n_seg",
          type: "source.segment",
          title: segment?.name ?? "Audiência",
          x: 340,
          y: 200,
          config: { type: "source.segment", segmentId },
        },
        {
          id: "n_rules",
          type: "filter.rules",
          title: "Regras de descobrimento",
          x: 620,
          y: 200,
          config: {
            type: "filter.rules",
            combinator: "and",
            rules: [{ id: "f1", field: "opt_in", operator: "eq", value: "sim" }],
          },
        },
        {
          id: "n_template",
          type: "action.template",
          title: "Template Meta",
          x: 900,
          y: 200,
          config: { type: "action.template", templateId, mapping: { "1": "primeiro_nome" } },
        },
        {
          id: "n_channel",
          type: "action.channel",
          title: "Canal de saída",
          x: 1180,
          y: 200,
          config: { type: "action.channel", channel, sender: store.workspace.whatsappNumber, throttled: true },
        },
      ],
      edges: [
        { id: "e1", from: "n_start", to: "n_seg" },
        { id: "e2", from: "n_seg", to: "n_rules" },
        { id: "e3", from: "n_rules", to: "n_template" },
        { id: "e4", from: "n_template", to: "n_channel" },
      ],
    });

    store.updateCampaign(campaign.id, { flowId: flow.id });
    store.logActivity({
      kind: "campaign",
      title: "Campanha criada",
      detail: `${campaign.name} · rascunho com fluxo`,
      refId: campaign.id,
    });
    onClose();
    setName("");
    setError("");
    navigate("fluxo", flow.id);
  }

  const approved = store.templates.filter((t) => t.status === "approved");

  return (
    <Modal
      open={open}
      title="Nova campanha"
      subtitle="O essencial para começar — o resto se monta no editor de fluxo."
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" icon={<Workflow size={15} />} onClick={create}>
            Criar e abrir o fluxo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nome da campanha">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reativação de leads frios — cupom pessoal" />
        </Field>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Objetivo">
            <Select value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective)}>
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Canal">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="sms">SMS</option>
            </Select>
          </Field>
        </div>

        <Field label="Audiência" hint="O universo inicial — as regras de descobrimento refinam no fluxo.">
          <Select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            {store.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {num(s.contactsCount)} contatos
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Template" hint="Só os aprovados pela Meta podem ser enviados.">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {approved.length === 0 && <option value="">nenhum template aprovado</option>}
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName} · {t.category}
              </option>
            ))}
          </Select>
        </Field>

        <button
          type="button"
          onClick={() => setWithCoupon((v) => !v)}
          className={cn(
            "flex items-center gap-3 rounded-sm border p-3 text-left transition-colors",
            withCoupon ? "border-accent/40 bg-accent-soft" : "border-line bg-bg hover:border-line-strong",
          )}
        >
          <span
            className={cn(
              "grid h-5 w-5 shrink-0 place-items-center rounded-xs border",
              withCoupon ? "border-accent bg-accent text-white" : "border-line-strong",
            )}
          >
            {withCoupon && "✓"}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium text-fg">Cupom personalizado</span>
            <span className="text-[11px] leading-snug text-fg-3">
              Um código por destinatário, com validade e desconto. Pode ser mapeado numa variável do template.
            </span>
          </span>
        </button>

        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </Modal>
  );
}
