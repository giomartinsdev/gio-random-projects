import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  Image as ImageIcon,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { compact, fmtDateTime, pct, ago } from "@/lib/format";
import type { Template, TemplateCategory, TemplateStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { navigate } from "@/lib/useHashRoute";
import { Input, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Table, TableBody, TableHead, TableRow, Td, Th } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Badge";
import { TemplateStatusBadge } from "@/components/Status";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { WhatsAppPreview, HighlightedBody } from "@/components/WhatsAppPreview";
import { FunnelRow } from "@/components/ui/Charts";
import { EmptyState } from "@/components/States";
import { TemplateEditor } from "./TemplateEditor";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { value: TemplateStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "approved", label: "Aprovados" },
  { value: "pending", label: "Em análise" },
  { value: "rejected", label: "Rejeitados" },
  { value: "draft", label: "Rascunhos" },
];

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticação",
};

export function TemplatesPage() {
  const store = useStore();
  const { templates } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<TemplateStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.displayName.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q)
      );
    });
  }, [templates, status, query]);

  const selectedTemplate = templates.find((t) => t.id === selected) ?? null;

  const totals = useMemo(() => {
    const sent = templates.reduce((a, t) => a + t.metrics.sent, 0);
    const delivered = templates.reduce((a, t) => a + t.metrics.delivered, 0);
    const read = templates.reduce((a, t) => a + t.metrics.read, 0);
    const clicked = templates.reduce((a, t) => a + t.metrics.clicked, 0);
    return { sent, delivered, read, clicked };
  }, [templates]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Templates Meta"
          left={
            <span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{filtered.length}</span>
          }
          right={
            <>
              <span className="hidden items-center gap-1.5 text-[12px] text-fg-3 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                WABA conectada
              </span>
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditorOpen(true)}>
                Novo template
              </Button>
            </>
          }
        />

        <PageBody>
          <PageHeader
            title="Mensagens aprovadas pela Meta"
            description="O vocabulário do seu canal: cada template é um contrato. Aqui você vê o status, a qualidade e como cada um performa de verdade."
          />

          <div className="flex flex-wrap gap-4">
            <StatCard label="Templates" value={templates.length} hint={`${templates.filter((t) => t.status === "approved").length} aprovados`} />
            <StatCard label="Envios acumulados" value={compact(totals.sent)} hint={`${compact(totals.delivered)} entregues`} />
            <StatCard label="Leitura média" value={pct(totals.delivered ? (totals.read / totals.delivered) * 100 : 0)} hint={`${compact(totals.read)} lidas`} />
            <StatCard label="Cliques" value={compact(totals.clicked)} hint="nos botões de URL" />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              icon={<Search size={16} />}
              placeholder="Buscar por nome ou conteúdo…"
              className="max-w-[320px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value as TemplateStatus | "all")} className="w-[170px]">
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <div className="flex-1" />
            <Note className="hidden lg:block">
              A aprovação é da Meta. A POC simula o ciclo — o status só muda aqui dentro.
            </Note>
          </div>

          <Table>
            <TableHead>
              <Th className="w-[300px] shrink-0">Template</Th>
              <Th className="w-[110px] shrink-0">Categoria</Th>
              <Th className="w-[130px] shrink-0">Status</Th>
              <Th className="w-[90px] shrink-0 text-right">Envios</Th>
              <Th className="w-[90px] shrink-0 text-right">Leitura</Th>
              <Th className="w-[90px] shrink-0 text-right">Cliques</Th>
              <Th className="w-[90px] shrink-0 text-right">Qualidade</Th>
              <Th className="w-[40px] shrink-0" />
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <EmptyState
                  title="Nenhum template com esse filtro"
                  hint="Ajuste a busca ou crie um novo template para submeter à Meta."
                  icon={<MessageCircle size={18} />}
                />
              ) : (
                filtered.map((t) => {
                  const readRate = t.metrics.delivered ? (t.metrics.read / t.metrics.delivered) * 100 : 0;
                  return (
                    <TableRow key={t.id} onClick={() => setSelected(t.id)} selected={selected === t.id}>
                      <Td className="flex w-[300px] shrink-0 items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs bg-elevated">
                          {t.header.kind === "image" ? (
                            <ImageIcon size={14} className="text-accent-light" />
                          ) : (
                            <MessageCircle size={14} className="text-accent-light" />
                          )}
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[14px] font-medium text-fg">{t.displayName}</span>
                          <span className="truncate font-mono text-[11px] text-fg-3">{t.name}</span>
                        </div>
                      </Td>
                      <Td className="w-[110px] shrink-0">
                        <Tag>{CATEGORY_LABEL[t.category]}</Tag>
                      </Td>
                      <Td className="w-[130px] shrink-0">
                        <TemplateStatusBadge status={t.status} />
                      </Td>
                      <Td className="w-[90px] shrink-0 text-right font-mono text-[12px] text-fg-2">
                        {t.metrics.sent ? compact(t.metrics.sent) : "—"}
                      </Td>
                      <Td className="w-[90px] shrink-0 text-right font-mono text-[12px] text-fg-2">
                        {t.metrics.delivered ? pct(readRate) : "—"}
                      </Td>
                      <Td className="w-[90px] shrink-0 text-right font-mono text-[12px] text-fg-2">
                        {t.metrics.clicked ? compact(t.metrics.clicked) : "—"}
                      </Td>
                      <Td className="w-[90px] shrink-0 text-right">
                        <QualityChip quality={t.quality} />
                      </Td>
                      <Td className="flex w-[40px] shrink-0 justify-end">
                        <ArrowUpRight size={15} className="text-fg-3" />
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
        open={selectedTemplate !== null}
        title={selectedTemplate?.displayName ?? "Template"}
        subtitle={selectedTemplate?.name}
        onClose={() => setSelected(null)}
        width={480}
        footer={
          selectedTemplate && (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setDuplicating(selectedTemplate.id);
                  setSelected(null);
                }}
                icon={<Sparkles size={14} />}
              >
                Duplicar
              </Button>
              <Button size="sm" className="flex-1" onClick={() => navigate("campanhas")}>
                Usar em campanha
              </Button>
            </>
          )
        }
      >
        {selectedTemplate && <TemplateDetail template={selectedTemplate} />}
      </Drawer>

      {editorOpen && <TemplateEditor onClose={() => setEditorOpen(false)} />}
      {duplicating && (
        <TemplateEditor
          initial={store.templates.find((t) => t.id === duplicating)}
          onClose={() => setDuplicating(null)}
        />
      )}
    </div>
  );
}

function QualityChip({ quality }: { quality: number }) {
  if (!quality) return <span className="font-mono text-[12px] text-fg-3">—</span>;
  const tone = quality >= 85 ? "text-success" : quality >= 65 ? "text-warn" : "text-danger";
  return <span className={cn("font-mono text-[12px]", tone)}>{quality}</span>;
}

function TemplateDetail({ template }: { template: Template }) {
  const readRate = template.metrics.delivered ? (template.metrics.read / template.metrics.delivered) * 100 : 0;
  const replyRate = template.metrics.read ? (template.metrics.replied / template.metrics.read) * 100 : 0;
  const clickRate = template.metrics.delivered ? (template.metrics.clicked / template.metrics.delivered) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <TemplateStatusBadge status={template.status} />
        <Tag>{CATEGORY_LABEL[template.category]}</Tag>
        <Tag>{template.language}</Tag>
        <Tag>{template.metaId}</Tag>
      </div>

      {template.rejectionReason && (
        <div className="flex gap-2.5 rounded-sm border border-danger/30 bg-danger-soft p-3">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[12px] leading-relaxed text-fg-2">{template.rejectionReason}</p>
        </div>
      )}

      <WhatsAppPreview template={template} />

      <div className="flex flex-col gap-2">
        <span className="caps">Conteúdo</span>
        <HighlightedBody body={template.body} />
        {template.footer && <p className="text-[12px] italic text-fg-3">{template.footer}</p>}
      </div>

      {template.variables.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="caps">Variáveis</span>
          <div className="flex flex-col divide-y divide-line rounded-sm bg-bg px-3.5">
            {template.variables.map((v) => (
              <div key={v.index} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent-light">
                  {`{{${v.index}}}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{v.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-3">{v.example}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="caps">Desempenho</span>
          <span className="font-mono text-[11px] text-fg-3">atualizado {ago(template.updatedAt)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <MiniStat label="Envios" value={compact(template.metrics.sent)} />
          <MiniStat label="Leitura" value={template.metrics.delivered ? pct(readRate) : "—"} />
          <MiniStat label="Resposta" value={template.metrics.read ? pct(replyRate) : "—"} />
          <MiniStat label="Cliques" value={template.metrics.delivered ? pct(clickRate) : "—"} />
          <MiniStat label="Falhas" value={compact(template.metrics.failed)} />
          <MiniStat label="Qualidade" value={template.quality ? String(template.quality) : "—"} />
        </div>
        {template.metrics.sent > 0 && (
          <div className="flex flex-col gap-2.5 rounded-sm bg-bg p-3.5">
            <FunnelRow label="Entregues" value={template.metrics.delivered} total={template.metrics.sent} />
            <FunnelRow label="Lidas" value={template.metrics.read} total={template.metrics.sent} color="#16A34A" />
            <FunnelRow label="Cliques" value={template.metrics.clicked} total={template.metrics.sent} color="#D97706" />
            <FunnelRow label="Respostas" value={template.metrics.replied} total={template.metrics.sent} color="#A78BFA" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Botões</span>
        {template.buttons.length === 0 ? (
          <p className="text-[12px] text-fg-3">Nenhum botão.</p>
        ) : (
          template.buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-sm bg-bg px-3.5 py-2.5">
              <span className="rounded-xs bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-3">
                {b.type === "url" ? "url" : b.type === "phone" ? "telefone" : "resposta"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{b.text}</span>
              {b.value && <span className="max-w-[140px] truncate font-mono text-[10px] text-fg-3">{b.value}</span>}
            </div>
          ))
        )}
      </div>

      <p className="border-t border-line pt-3 font-mono text-[10px] text-fg-3">
        criado {fmtDateTime(template.createdAt)} · atualizado {fmtDateTime(template.updatedAt)}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-bg px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>
      <span className="font-mono text-[14px] font-medium text-fg">{value}</span>
    </div>
  );
}
