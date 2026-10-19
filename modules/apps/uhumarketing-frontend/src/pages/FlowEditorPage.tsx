import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  FlaskConical,
  Megaphone,
  Play,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { fmtDateTime, money, num, pct } from "@/lib/format";
import type { Flow } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { StatusBadge, Tag } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Drawer";
import { Topbar, Note } from "@/components/Topbar";
import { FlowCanvas } from "@/components/FlowCanvas";
import { validateFlow, hasErrors, type Issue } from "@/lib/validate";
import { simulateFlow, type SimulationResult } from "@/lib/simulate";
import { navigate } from "@/lib/useHashRoute";
import { cn } from "@/lib/utils";

/**
 * Editor de fluxo: canvas + validação + simulação. O salvamento é implícito
 * (cada arrasto/edição grava no store, que persiste em localStorage) — como
 * num editor de verdade, não existe "perdeu o que fez".
 */
export function FlowEditorPage({ flowId }: { flowId?: string }) {
  const store = useStore();
  const flow = flowId ? store.flows.find((f) => f.id === flowId) : undefined;
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [focus, setFocus] = useState<{ nodeId: string; nonce: number } | null>(null);

  const campaign = store.campaigns.find((c) => c.id === flow?.campaignId);

  const issues = useMemo<Issue[]>(
    () =>
      flow
        ? validateFlow(flow, (id) => store.templates.find((t) => t.id === id)?.status)
        : [],
    [flow, store.templates],
  );

  const sim = useMemo<SimulationResult | null>(
    () =>
      flow
        ? simulateFlow(flow, {
            segments: store.segments,
            templates: store.templates,
            throttlePerMinute: campaign?.schedule.throttlePerMinute ?? 120,
          })
        : null,
    [flow, store.segments, store.templates, campaign],
  );

  if (!flow) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <Workflow size={28} className="text-fg-3" />
        <span className="text-[14px] text-fg-2">Fluxo não encontrado.</span>
        <Button size="sm" variant="secondary" onClick={() => navigate("fluxos")}>
          Voltar para automação
        </Button>
      </div>
    );
  }

  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  function publish() {
    if (!flow) return;
    if (hasErrors(issues)) {
      setIssuesOpen(true);
      return;
    }
    store.updateFlow(flow.id, { status: "active", lastRunAt: new Date().toISOString() });
    if (campaign) {
      store.updateCampaign(campaign.id, { status: "running", lastRunAt: new Date().toISOString() });
      // No modo Backend, publicar também ENFILEIRA. Sem isso a campanha
      // apareceria "em execução" com a fila vazia e nada sairia — o pior tipo
      // de estado: parece que está rodando.
      if (store.launchCampaign) {
        store
          .launchCampaign(campaign.id)
          .then((res) =>
            store.logActivity({
              kind: "campaign",
              title: "Campanha disparada pelo fluxo",
              detail: `${campaign.name} · ${res.queued} na fila · ${res.skipped} sem opt-in`,
              refId: campaign.id,
            }),
          )
          .catch((err) => {
            store.logActivity({
              kind: "campaign",
              title: "Disparo recusado",
              detail: err instanceof Error ? err.message : "falha ao enfileirar",
              refId: campaign.id,
            });
          });
      }
    }
    store.logActivity({
      kind: "flow",
      title: "Fluxo publicado",
      detail: `${flow.name} · ${sim ? num(sim.sent) : 0} envios previstos`,
      refId: flow.id,
    });
  }

  function runTest() {
    if (!flow) return;
    // Simulação é prévia, não execução: não incrementa contador de execuções.
    // No modo Backend esses contadores vêm do servidor, e somar aqui faria o
    // número subir e voltar sozinho no próximo polling.
    store.logActivity({
      kind: "flow",
      title: "Simulação executada",
      detail: `${flow.name} · ${sim ? num(sim.sent) : 0} envios previstos`,
      refId: flow.id,
    });
    setSimulateOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title={
          <span className="flex items-center gap-2.5">
            <IconButton label="Voltar" onClick={() => navigate("fluxos")}>
              <ArrowLeft size={16} />
            </IconButton>
            <span className="truncate">{flow.name}</span>
            <StatusBadge tone={flow.status === "active" ? "success" : flow.status === "paused" ? "warn" : "muted"}>
              {flow.status === "active" ? "Ativo" : flow.status === "paused" ? "Pausado" : "Rascunho"}
            </StatusBadge>
          </span>
        }
        right={
          <>
            <button
              onClick={() => setIssuesOpen(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                errors.length
                  ? "bg-danger-soft text-danger hover:bg-danger/20"
                  : warns.length
                    ? "bg-warn-soft text-warn hover:bg-warn/20"
                    : "bg-success-soft text-success hover:bg-success/20",
              )}
            >
              {errors.length ? <CircleAlert size={13} /> : warns.length ? <TriangleAlert size={13} /> : <Check size={13} />}
              {errors.length
                ? `${errors.length} ${errors.length === 1 ? "erro" : "erros"}`
                : warns.length
                  ? `${warns.length} ${warns.length === 1 ? "aviso" : "avisos"}`
                  : "sem erros"}
            </button>
            <Button size="sm" variant="secondary" icon={<FlaskConical size={14} />} onClick={runTest}>
              Simular
            </Button>
            <Button size="sm" icon={<Play size={14} />} onClick={publish}>
              Publicar
            </Button>
          </>
        }
      />

      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-5 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-3">
          <Workflow size={12} className="shrink-0" />
          <span className="truncate">{flow.description}</span>
        </span>
        <span className="flex-1" />
        {campaign && (
          <button
            onClick={() => navigate("campanhas")}
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-fg-2 transition-colors hover:text-fg"
          >
            <Megaphone size={12} /> {campaign.name}
          </button>
        )}
        <Tag>{`${flow.nodes.length} blocos`}</Tag>
        <span className="shrink-0 font-mono text-[10px] text-fg-3">
          salvo {fmtDateTime(flow.updatedAt)}
        </span>
      </div>

      <FlowCanvas flow={flow} focus={focus} />

      <SimulationModal
        open={simulateOpen}
        onClose={() => setSimulateOpen(false)}
        flow={flow}
        result={sim}
        throttle={campaign?.schedule.throttlePerMinute ?? 120}
      />

      <IssuesModal
        open={issuesOpen}
        onClose={() => setIssuesOpen(false)}
        issues={issues}
        onSelect={(nodeId) => {
          if (!nodeId) return;
          setFocus({ nodeId, nonce: Date.now() });
          setIssuesOpen(false);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------- simulação */

function SimulationModal({
  open,
  onClose,
  flow,
  result,
  throttle,
}: {
  open: boolean;
  onClose: () => void;
  flow: Flow;
  result: SimulationResult | null;
  throttle: number;
}) {
  if (!result) return null;

  const duration =
    result.minutes < 60
      ? `${result.minutes} min`
      : result.minutes < 1440
        ? `${(result.minutes / 60).toFixed(1).replace(".", ",")} h`
        : `${(result.minutes / 1440).toFixed(1).replace(".", ",")} dias`;

  return (
    <Modal
      open={open}
      title="Simulação do fluxo"
      subtitle={`${flow.name} · nenhuma mensagem é enviada de verdade`}
      onClose={onClose}
      width={760}
      footer={
        <Button size="sm" onClick={onClose}>
          Entendi
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Metric label="No universo" value={num(result.universe)} hint="origem do fluxo" />
          <Metric label="Envios" value={num(result.sent)} hint="depois de filtros e opt-out" />
          <Metric label="Leitura prevista" value={pct(result.delivered ? (result.read / result.delivered) * 100 : 0)} />
          <Metric label="Receita prevista" value={money(result.revenue)} />
          <Metric label="Custo estimado" value={money(result.cost)} />
          <Metric label="Duração" value={duration} />
          <Metric label="Ignorados" value={num(result.skipped)} hint="opt-out / sem consentimento" />
          <Metric label="Falhas" value={num(result.failed)} hint="número sem WhatsApp" />
        </div>

        {result.warnings.length > 0 && (
          <div className="flex flex-col gap-2 rounded-sm border border-warn/30 bg-warn-soft p-3.5">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
              <TriangleAlert size={13} /> O fluxo tem pendências
            </span>
            {result.warnings.map((w, i) => (
              <span key={i} className="text-[12px] leading-snug text-fg-2">
                · {w}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="caps">Passo a passo</span>
          <div className="flex flex-col divide-y divide-line rounded-sm border border-line">
            {result.steps.map((step, i) => (
              <div key={step.nodeId} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-elevated font-mono text-[10px] text-fg-3">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-medium text-fg">{step.title}</span>
                  <span className="truncate text-[11px] text-fg-3">{step.note}</span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-fg-2">
                  {step.kind === "entrada" ? "—" : num(step.out)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {result.messages.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="caps">Mensagem que cada contato recebe</span>
            {result.messages.map((m) => (
              <div key={m.title} className="rounded-sm border border-line bg-bg p-3.5">
                <span className="caps">{m.title}</span>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">{m.body}</p>
              </div>
            ))}
          </div>
        )}

        <Note>
          Estimativa a partir das regras do fluxo e das taxas históricas da base ({throttle} msg/min). Custo de referência:
          R$ 0,0625 por conversa de marketing no WhatsApp.
        </Note>
      </div>
    </Modal>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-bg px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>
      <span className="font-mono text-[15px] font-medium text-fg">{value}</span>
      {hint && <span className="text-[10px] leading-snug text-fg-3">{hint}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ validação */

function IssuesModal({
  open,
  onClose,
  issues,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  issues: Issue[];
  onSelect: (nodeId?: string) => void;
}) {
  return (
    <Modal
      open={open}
      title="Antes de publicar"
      subtitle="O que a Meta e o próprio fluxo precisam que esteja certo."
      onClose={onClose}
      width={620}
      footer={
        <Button size="sm" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {issues.map((issue, i) => (
          <button
            key={i}
            disabled={!issue.nodeId}
            onClick={() => onSelect(issue.nodeId)}
            className={cn(
              "flex items-start gap-2.5 rounded-sm border p-3 text-left transition-colors",
              issue.level === "error"
                ? "border-danger/30 bg-danger-soft hover:bg-danger/15"
                : issue.level === "warn"
                  ? "border-warn/30 bg-warn-soft hover:bg-warn/15"
                  : "border-success/30 bg-success-soft",
            )}
          >
            {issue.level === "error" ? (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
            ) : issue.level === "warn" ? (
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
            ) : (
              <Check size={14} className="mt-0.5 shrink-0 text-success" />
            )}
            <span className="text-[13px] leading-snug text-fg-2">{issue.text}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
