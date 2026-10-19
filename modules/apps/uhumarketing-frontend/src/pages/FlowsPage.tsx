import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  Clock,
  GitBranch,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ago, num } from "@/lib/format";
import type { Flow, FlowStatus } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Card, StatCard } from "@/components/ui/Card";
import { StatusBadge, Tag } from "@/components/ui/Badge";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { EmptyState } from "@/components/States";
import { Modal } from "@/components/ui/Drawer";
import { navigate } from "@/lib/useHashRoute";
import { specOf } from "@/lib/nodeCatalog";
import { cn } from "@/lib/utils";

const FLOW_STATUS: Record<FlowStatus, { label: string; tone: "success" | "warn" | "muted" }> = {
  active: { label: "Ativo", tone: "success" },
  paused: { label: "Pausado", tone: "warn" },
  draft: { label: "Rascunho", tone: "muted" },
};

export function FlowsPage() {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);

  const flows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.flows.filter((f) => {
      if (status !== "all" && f.status !== status) return false;
      return !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
    });
  }, [store.flows, query, status]);

  const active = store.flows.filter((f) => f.status === "active");
  const totalRuns = store.flows.reduce((a, f) => a + f.runs.total, 0);
  const failures = store.flows.reduce((a, f) => a + f.runs.failed, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Automação"
        left={<span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{flows.length}</span>}
        right={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Novo fluxo
          </Button>
        }
      />

      <PageBody>
        <PageHeader
          title="Fluxos livres, como no n8n"
          description="Descoberta, oferta e saída no mesmo canvas. O operador monta o caminho; o produto cuida do resto (aprovação, vazão, opt-out)."
        />

        <div className="flex flex-wrap gap-4">
          <StatCard label="Fluxos" value={store.flows.length} hint={`${active.length} ativos`} icon={<Workflow size={16} />} />
          <StatCard label="Execuções" value={num(totalRuns)} hint="desde a criação" icon={<Play size={16} />} />
          <StatCard label="Falhas" value={num(failures)} hint={totalRuns ? `${((failures / totalRuns) * 100).toFixed(1)}% das execuções` : "sem execuções"} icon={<Circle size={16} />} />
          <StatCard label="Blocos disponíveis" value="19" hint="gatilho → descoberta → saída" icon={<GitBranch size={16} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            icon={<Search size={16} />}
            placeholder="Buscar fluxo…"
            className="max-w-[300px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[150px]">
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="paused">Pausados</option>
            <option value="draft">Rascunhos</option>
          </Select>
          <div className="flex-1" />
          <Note className="hidden xl:block">
            Um fluxo pode existir sem campanha — serve para testar a descoberta antes de comprometer verba.
          </Note>
        </div>

        {flows.length === 0 ? (
          <EmptyState title="Nenhum fluxo" hint="Crie um fluxo para desenhar a campanha do zero." icon={<Workflow size={18} />} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {flows.map((flow) => (
              <FlowCard key={flow.id} flow={flow} />
            ))}
          </div>
        )}
      </PageBody>

      <NewFlowModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function FlowCard({ flow }: { flow: Flow }) {
  const store = useStore();
  const [menu, setMenu] = useState(false);
  const meta = FLOW_STATUS[flow.status];
  const campaign = store.campaigns.find((c) => c.id === flow.campaignId);

  const counts = flow.nodes.reduce(
    (acc, n) => {
      const spec = specOf(n.type);
      acc[spec.group] = (acc[spec.group] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <button className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left" onClick={() => navigate("fluxo", flow.id)}>
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-fg">{flow.name}</span>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          </span>
          <span className="line-clamp-2 text-[12px] leading-snug text-fg-3">{flow.description}</span>
        </button>
        <div className="relative">
          <IconButton label="Mais ações" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={15} />
          </IconButton>
          {menu && (
            <div className="absolute right-0 top-9 z-30 w-[180px] overflow-hidden rounded-sm border border-line bg-elevated py-1 shadow-card">
              <MenuItem
                onClick={() => {
                  store.updateFlow(flow.id, { status: flow.status === "active" ? "paused" : "active" });
                  store.logActivity({
                    kind: "flow",
                    title: flow.status === "active" ? "Fluxo pausado" : "Fluxo ativado",
                    detail: flow.name,
                    refId: flow.id,
                  });
                  setMenu(false);
                }}
              >
                {flow.status === "active" ? "Pausar" : "Ativar"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const copy = store.createFlow({
                    ...flow,
                    name: `${flow.name} (cópia)`,
                    status: "draft",
                    campaignId: undefined,
                  });
                  setMenu(false);
                  navigate("fluxo", copy.id);
                }}
              >
                Duplicar
              </MenuItem>
              {campaign && (
                <MenuItem
                  onClick={() => {
                    navigate("campanhas");
                    setMenu(false);
                  }}
                >
                  Ver campanha
                </MenuItem>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{`${flow.nodes.length} blocos`}</Tag>
        {counts.descoberta ? <Tag>{`${counts.descoberta} descoberta`}</Tag> : null}
        {counts.mensagem ? <Tag>{`${counts.mensagem} mensagem`}</Tag> : null}
        {campaign ? <Tag>{campaign.name.split("—")[0].trim()}</Tag> : <Tag>sem campanha</Tag>}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-3">
        <div className="flex items-center gap-3 font-mono text-[11px] text-fg-3">
          <span className="flex items-center gap-1">
            <Play size={11} /> {num(flow.runs.total)}
          </span>
          <span className={cn("flex items-center gap-1", flow.runs.failed > 0 && "text-warn")}>
            <Circle size={11} /> {num(flow.runs.failed)} falhas
          </span>
          {flow.lastRunAt && (
            <span className="flex items-center gap-1">
              <Clock size={11} /> {ago(flow.lastRunAt)}
            </span>
          )}
        </div>
        <button
          onClick={() => navigate("fluxo", flow.id)}
          className="flex items-center gap-1 text-[12px] font-medium text-accent-light transition-colors hover:text-fg"
        >
          Abrir editor <ArrowUpRight size={13} />
        </button>
      </div>
    </Card>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-surface hover:text-fg"
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------- novo fluxo */

function NewFlowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<"trigger.manual" | "trigger.schedule" | "trigger.event">("trigger.manual");
  const [segmentId, setSegmentId] = useState(store.segments[0]?.id ?? "");
  const [error, setError] = useState("");

  function create() {
    if (!name.trim()) {
      setError("Dê um nome ao fluxo.");
      return;
    }
    const id = `nf_${Date.now()}`;
    const flow = store.createFlow({
      name: name.trim(),
      description: description.trim() || "Fluxo em branco — arraste os blocos para desenhar o caminho.",
      status: "draft",
      nodes: [
        {
          id: `${id}_trigger`,
          type: trigger,
          title:
            trigger === "trigger.schedule" ? "Agendamento" : trigger === "trigger.event" ? "Evento recebido" : "Disparo manual",
          x: 80,
          y: 200,
          config:
            trigger === "trigger.schedule"
              ? { type: "trigger.schedule", cron: "0 9 * * 1-5", note: "" }
              : trigger === "trigger.event"
                ? { type: "trigger.event", event: "carrinho.abandonado" }
                : { type: "trigger.manual", note: "" },
        },
        {
          id: `${id}_segment`,
          type: "source.segment",
          title: store.segments.find((s) => s.id === segmentId)?.name ?? "Audiência",
          x: 360,
          y: 200,
          config: { type: "source.segment", segmentId },
        },
      ],
      edges: [{ id: `${id}_e1`, from: `${id}_trigger`, to: `${id}_segment` }],
    });
    store.logActivity({ kind: "flow", title: "Fluxo criado", detail: flow.name, refId: flow.id });
    onClose();
    setName("");
    setDescription("");
    setError("");
    navigate("fluxo", flow.id);
  }

  return (
    <Modal
      open={open}
      title="Novo fluxo"
      subtitle="Começa com gatilho e audiência. O resto você monta no canvas."
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={create}>
            Criar fluxo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nome do fluxo">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Winback de inativos — 60 dias" />
        </Field>

        <Field label="Descrição" hint="Aparece na lista e no topo do editor.">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Quem não compra há 60 dias recebe uma oferta de retorno."
          />
        </Field>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Gatilho">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)}>
              <option value="trigger.manual">Disparo manual</option>
              <option value="trigger.schedule">Agendamento</option>
              <option value="trigger.event">Evento recebido</option>
            </Select>
          </Field>
          <Field label="Audiência inicial">
            <Select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              {store.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {num(s.contactsCount)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {error && <span className="text-[12px] text-danger">{error}</span>}

        <Note>
          Fluxo sem campanha serve para testar a descoberta antes de comprometer verba. Ao publicar sem campanha, só a
          simulação roda — nenhuma mensagem sai.
        </Note>
      </div>
    </Modal>
  );
}
