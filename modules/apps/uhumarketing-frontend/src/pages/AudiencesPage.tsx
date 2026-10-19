import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookUser,
  Filter,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ago, compact, num, pct } from "@/lib/format";
import type { ContactField, Segment, SegmentKind, SegmentRule } from "@/lib/types";
import { CONTACT_FIELD_LABEL } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Table";
import { StatCard } from "@/components/ui/Card";
import { Drawer, Modal } from "@/components/ui/Drawer";
import { Tag } from "@/components/ui/Badge";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { num as fmtNum, uid } from "@/lib/format";
import { navigate } from "@/lib/useHashRoute";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SegmentKind, string> = {
  static: "Lista fixa",
  dynamic: "Dinâmica",
  import: "Importada",
};

const OPERATOR_LABEL: Record<SegmentRule["operator"], string> = {
  eq: "é",
  neq: "não é",
  contains: "contém",
  gt: "maior que",
  lt: "menor que",
  in_days: "nos últimos dias",
};

export function AudiencesPage() {
  const store = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const segments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.segments.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.source.toLowerCase().includes(q),
    );
  }, [store.segments, query]);

  const totalContacts = store.segments.reduce((a, s) => a + s.contactsCount, 0);
  const segment = store.segments.find((s) => s.id === selected) ?? null;

  /** Cria um fluxo já ancorado nesta audiência — o passo seguinte é montar a saída. */
  function useInFlow(source: Segment) {
    const flow = store.createFlow({
      name: `Fluxo · ${source.name}`,
      description: `Começa em ${source.name} — ${fmtNum(source.contactsCount)} contatos. Falta decidir as regras e a saída.`,
      status: "draft",
      nodes: [
        {
          id: `nf_${Date.now()}_t`,
          type: "trigger.manual",
          title: "Disparo manual",
          x: 80,
          y: 200,
          config: { type: "trigger.manual", note: "" },
        },
        {
          id: `nf_${Date.now()}_s`,
          type: "source.segment",
          title: source.name,
          x: 360,
          y: 200,
          config: { type: "source.segment", segmentId: source.id },
        },
      ],
      edges: [],
    });
    store.logActivity({ kind: "flow", title: "Fluxo criado", detail: `${flow.name} · a partir da audiência`, refId: flow.id });
    setSelected(null);
    navigate("fluxo", flow.id);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Audiências"
          left={<span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{segments.length}</span>}
          right={
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Nova audiência
            </Button>
          }
        />

        <PageBody>
          <PageHeader
            title="De onde as pessoas vêm"
            description="Audiências são o ponto de partida de qualquer fluxo. Dinâmicas se atualizam sozinhas; importadas entram com opt-in assinado."
          />

          <div className="flex flex-wrap gap-4">
            <StatCard label="Contatos únicos" value={compact(totalContacts)} hint="somatório das audiências" icon={<Users size={16} />} />
            <StatCard label="Audiências dinâmicas" value={store.segments.filter((s) => s.kind === "dynamic").length} hint="recalculadas a cada execução" icon={<RefreshCw size={16} />} />
            <StatCard label="Listas importadas" value={store.segments.filter((s) => s.kind === "import").length} hint="CSV com opt-in" icon={<Upload size={16} />} />
            <StatCard label="Opt-in médio" value={pct(96.4)} hint="da base total" icon={<BookUser size={16} />} />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              icon={<Search size={16} />}
              placeholder="Buscar audiência, origem…"
              className="max-w-[320px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex-1" />
            <Note className="hidden lg:block">
              LGPD: quem não tem opt-in não entra em campanha de marketing — o filtro é aplicado no envio, não na lista.
            </Note>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {segments.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={cn(
                  "card flex flex-col gap-3 p-4 text-left transition-colors hover:border-line-strong",
                  selected === s.id && "border-accent/50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-[14px] font-semibold text-fg">{s.name}</span>
                    <span className="truncate text-[11px] text-fg-3">{s.source}</span>
                  </div>
                  <ArrowUpRight size={14} className="mt-1 shrink-0 text-fg-3" />
                </div>
                <p className="line-clamp-2 text-[12px] leading-snug text-fg-2">{s.description}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag>{KIND_LABEL[s.kind]}</Tag>
                  {s.rules.length > 0 && <Tag>{`${s.rules.length} regras`}</Tag>}
                  <Tag>{ago(s.updatedAt)}</Tag>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="font-mono text-[18px] font-medium text-fg">{num(s.contactsCount)}</span>
                  <span className="text-[11px] text-fg-3">contatos</span>
                </div>
              </button>
            ))}
          </div>
        </PageBody>
      </div>

      <Drawer
        open={segment !== null}
        title={segment?.name ?? "Audiência"}
        subtitle={segment ? `${KIND_LABEL[segment.kind]} · ${segment.source}` : undefined}
        onClose={() => setSelected(null)}
        width={480}
        footer={
          segment && (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                icon={<RefreshCw size={14} />}
                onClick={() => store.updateSegment(segment.id, { updatedAt: new Date().toISOString() })}
              >
                Recalcular
              </Button>
              <Button size="sm" className="flex-1" icon={<Filter size={14} />} onClick={() => useInFlow(segment)}>
                Usar em fluxo
              </Button>
            </>
          )
        }
      >
        {segment && <SegmentDetail segment={segment} />}
      </Drawer>

      <NewSegmentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function SegmentDetail({ segment }: { segment: Segment }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-fg-2">{segment.description}</p>

      <div className="grid grid-cols-2 gap-2.5">
        <Mini label="Contatos" value={num(segment.contactsCount)} />
        <Mini label="Tipo" value={KIND_LABEL[segment.kind]} />
        <Mini label="Origem" value={segment.source.split("·")[0].trim()} />
        <Mini label="Atualizada" value={ago(segment.updatedAt)} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Regras</span>
        {segment.rules.length === 0 ? (
          <Note>Lista fixa — sem regra. Os contatos foram importados diretamente.</Note>
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-sm border border-line bg-bg">
            {segment.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3.5 py-2.5">
                <span className="w-[110px] shrink-0 text-[12px] text-fg-2">{CONTACT_FIELD_LABEL[r.field]}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-3">{OPERATOR_LABEL[r.operator]}</span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-fg">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Amostra</span>
        {segment.sample.length === 0 ? (
          <Note>Sem amostra para esta audiência.</Note>
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-sm border border-line">
            {segment.sample.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <Avatar initials={c.name.slice(0, 2).toUpperCase()} size={26} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] text-fg">{c.name}</span>
                  <span className="truncate font-mono text-[10px] text-fg-3">{c.phone}</span>
                </div>
                <span className="shrink-0 text-[11px] text-fg-3">{c.city}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-bg px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>
      <span className="truncate font-mono text-[13px] text-fg">{value}</span>
    </div>
  );
}

/* --------------------------------------------------- nova audiência */

function NewSegmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<SegmentKind>("dynamic");
  const [rules, setRules] = useState<SegmentRule[]>([
    { id: uid("r"), field: "ultima_compra", operator: "gt", value: "90" },
    { id: uid("r"), field: "opt_in", operator: "eq", value: "sim" },
  ]);
  const [error, setError] = useState("");

  function create() {
    if (!name.trim()) {
      setError("Dê um nome à audiência.");
      return;
    }
    const segment = store.createSegment({
      name: name.trim(),
      description: description.trim() || "Criada na POC — as regras definem quem entra.",
      kind,
      rules: kind === "dynamic" ? rules : [],
      source: kind === "import" ? "Importação CSV" : "Regras do produto",
      contactsCount: 0,
    });
    store.logActivity({
      kind: "campaign",
      title: "Audiência criada",
      detail: segment.name,
      refId: segment.id,
    });
    onClose();
    setName("");
    setDescription("");
    setError("");
  }

  return (
    <Modal
      open={open}
      title="Nova audiência"
      subtitle="Regras viram filtro executável no envio — não é só um nome bonito."
      onClose={onClose}
      width={680}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={create}>
            Criar audiência
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leads frios (90+ dias)" />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as SegmentKind)}>
              <option value="dynamic">Dinâmica (recalcula)</option>
              <option value="static">Lista fixa</option>
              <option value="import">Importada</option>
            </Select>
          </Field>
        </div>

        <Field label="Descrição">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Comprou alguma vez, mas não volta há mais de 90 dias."
          />
        </Field>

        {kind === "dynamic" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="caps">Regras</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={13} />}
                onClick={() => setRules((r) => [...r, { id: uid("r"), field: "tag", operator: "contains", value: "" }])}
              >
                Adicionar
              </Button>
            </div>
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-end gap-2">
                <Field className="flex-1" label="Campo">
                  <Select
                    value={rule.field}
                    onChange={(e) =>
                      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, field: e.target.value as ContactField } : r)))
                    }
                  >
                    {Object.entries(CONTACT_FIELD_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field className="w-[150px]" label="Operador">
                  <Select
                    value={rule.operator}
                    onChange={(e) =>
                      setRules((rs) =>
                        rs.map((r) => (r.id === rule.id ? { ...r, operator: e.target.value as SegmentRule["operator"] } : r)),
                      )
                    }
                  >
                    {Object.entries(OPERATOR_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field className="w-[120px]" label="Valor">
                  <Input
                    value={rule.value}
                    onChange={(e) => setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, value: e.target.value } : r)))}
                  />
                </Field>
                <IconButton label="Remover" onClick={() => setRules((rs) => rs.filter((r) => r.id !== rule.id))} className="mb-1">
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            <Note>
              Tudo em E: o contato precisa cumprir todas as regras. A prévia de contagem aparece no card depois de criar.
            </Note>
          </div>
        )}

        {kind === "import" && (
          <button className="flex flex-col items-center gap-2 rounded-sm border border-dashed border-line-strong bg-bg px-4 py-8 transition-colors hover:border-accent/50">
            <Upload size={20} className="text-fg-3" />
            <span className="text-[13px] font-medium text-fg-2">Enviar CSV com opt-in</span>
            <span className="text-[11px] text-fg-3">nome, telefone, e-mail, cidade, data do consentimento</span>
          </button>
        )}

        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </Modal>
  );
}
