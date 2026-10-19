import { useMemo, useState } from "react";
import {
  CircleAlert,
  Download,
  MessageCircle,
  Search,
  Send as SendIcon,
  Timer,
} from "lucide-react";
import { useStore, useLookup } from "@/lib/store";
import { fmtDateTime, money, num, pct, ago } from "@/lib/format";
import type { SendStatus } from "@/lib/types";
import { SEND_STATUS_LABEL } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Table, TableBody, TableHead, TableRow, Td, Th } from "@/components/ui/Table";
import { SendStatusBadge } from "@/components/Status";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { EmptyState } from "@/components/States";
import { cn } from "@/lib/utils";

const STATUSES: (SendStatus | "all")[] = ["all", "queued", "sent", "delivered", "read", "replied", "failed", "skipped"];

export function SendsPage() {
  const store = useStore();
  const lookup = useLookup();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SendStatus | "all">("all");
  const [campaignId, setCampaignId] = useState("all");

  const sends = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...store.sends]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .filter((s) => {
        if (status !== "all" && s.status !== status) return false;
        if (campaignId !== "all" && s.campaignId !== campaignId) return false;
        return (
          !q ||
          s.contactName.toLowerCase().includes(q) ||
          s.destination.toLowerCase().includes(q) ||
          s.templateName.toLowerCase().includes(q) ||
          (s.couponCode ?? "").toLowerCase().includes(q)
        );
      });
  }, [store.sends, status, campaignId, query]);

  const send = store.sends.find((s) => s.id === selected) ?? null;

  /** Exporta o que está filtrado na tela — o CSV é do recorte, não da base toda. */
  function exportCsv() {
    const header = ["id", "campanha", "contato", "destino", "template", "status", "cupom", "custo", "quando"];
    const rows = sends.map((s) => [
      s.id,
      lookup.campaign(s.campaignId)?.name ?? "",
      s.contactName,
      s.destination,
      s.templateName,
      s.status,
      s.couponCode ?? "",
      s.cost.toFixed(4).replace(".", ","),
      s.at,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `envios-uhumarketing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stats = useMemo(() => {
    const total = store.sends.length;
    const failed = store.sends.filter((s) => s.status === "failed").length;
    const queued = store.sends.filter((s) => s.status === "queued").length;
    const replied = store.sends.filter((s) => s.status === "replied").length;
    const cost = store.sends.reduce((a, s) => a + s.cost, 0);
    return { total, failed, queued, replied, cost };
  }, [store.sends]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Envios"
          left={<span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{sends.length}</span>}
          right={
            <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>
              Exportar
            </Button>
          }
        />

        <PageBody>
          <PageHeader
            title="Cada mensagem, rastreável"
            description="O log operacional: quem recebeu, por qual campanha, com qual cupom e o que aconteceu depois. É aqui que um erro de número aparece antes de virar reclamação."
          />

          <div className="flex flex-wrap gap-4">
            <StatCard label="Envios no log" value={num(stats.total)} hint="no banco" icon={<SendIcon size={16} />} />
            <StatCard label="Na fila" value={num(stats.queued)} hint="aguardando janela" icon={<Timer size={16} />} />
            <StatCard label="Respondidas" value={num(stats.replied)} hint={`${pct(stats.total ? (stats.replied / stats.total) * 100 : 0)} do total`} icon={<MessageCircle size={16} />} />
            <StatCard label="Falhas" value={num(stats.failed)} hint={`custo ${money(stats.cost)}`} icon={<CircleAlert size={16} />} />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              icon={<Search size={16} />}
              placeholder="Nome, telefone, template ou cupom…"
              className="max-w-[320px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value as SendStatus | "all")} className="w-[160px]">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "Todos os status" : SEND_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-[220px]">
              <option value="all">Todas as campanhas</option>
              {store.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <div className="flex-1" />
            <Note className="hidden lg:block">
              Cada linha vem de sends no Postgres; o status é o último evento do provedor.
            </Note>
          </div>

          <Table>
            <TableHead>
              <Th className="w-[220px] shrink-0">Destinatário</Th>
              <Th className="hidden w-[220px] shrink-0 md:block">Campanha</Th>
              <Th className="w-[180px] shrink-0">Template</Th>
              <Th className="w-[130px] shrink-0">Status</Th>
              <Th className="hidden w-[130px] shrink-0 lg:block">Cupom</Th>
              <Th className="w-[130px] shrink-0 text-right">Quando</Th>
            </TableHead>
            <TableBody>
              {sends.length === 0 ? (
                <EmptyState
                  title={store.sends.length === 0 ? "Nenhum envio ainda" : "Nenhum envio com esse filtro"}
                  hint={
                    store.sends.length === 0
                      ? "Cada mensagem que sai de uma campanha aparece aqui, com o status que a Meta devolveu."
                      : "Mude o filtro ou dispare um teste numa campanha."
                  }
                  icon={<SendIcon size={18} />}
                />
              ) : (
                sends.map((s) => {
                  const campaign = lookup.campaign(s.campaignId);
                  return (
                    <TableRow key={s.id} onClick={() => setSelected(s.id)} selected={selected === s.id}>
                      <Td className="flex w-[220px] shrink-0 flex-col">
                        <span className="truncate text-[13px] font-medium text-fg">{s.contactName}</span>
                        <span className="truncate font-mono text-[11px] text-fg-3">{s.destination}</span>
                      </Td>
                      <Td className="hidden w-[220px] shrink-0 md:block">
                        <span className="truncate text-[12px] text-fg-2">{campaign?.name ?? "—"}</span>
                      </Td>
                      <Td className="w-[180px] shrink-0">
                        <span className="truncate font-mono text-[11px] text-fg-2">{s.templateName}</span>
                      </Td>
                      <Td className="w-[130px] shrink-0">
                        <SendStatusBadge status={s.status} />
                      </Td>
                      <Td className="hidden w-[130px] shrink-0 lg:block">
                        {s.couponCode ? (
                          <span className="rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent-light">
                            {s.couponCode}
                          </span>
                        ) : (
                          <span className="text-[11px] text-fg-3">—</span>
                        )}
                      </Td>
                      <Td className="w-[130px] shrink-0 text-right font-mono text-[11px] text-fg-3">{ago(s.at)}</Td>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </PageBody>
      </div>

      <Drawer
        open={send !== null}
        title={send?.contactName ?? "Envio"}
        subtitle={send ? `${send.templateName} · ${fmtDateTime(send.at)}` : undefined}
        onClose={() => setSelected(null)}
        width={440}
      >
        {send && <SendDetail sendId={send.id} />}
      </Drawer>
    </div>
  );
}

function SendDetail({ sendId }: { sendId: string }) {
  const store = useStore();
  const lookup = useLookup();
  const send = store.sends.find((s) => s.id === sendId);
  if (!send) return null;
  const campaign = lookup.campaign(send.campaignId);
  const template = store.templates.find((t) => t.name === send.templateName);

  // O log guarda um timestamp só; a linha do tempo acrescenta o intervalo
  // típico de cada etapa para a evolução ficar legível (segundos → minutos).
  const step = (minutes: number) => new Date(new Date(send.at).getTime() + minutes * 60_000).toISOString();
  const reached = (statuses: string[]) => statuses.includes(send.status);
  const timeline: { label: string; at?: string; tone: string }[] = [
    { label: "Na fila", at: send.at, tone: "muted" },
    { label: "Enviada", at: reached(["sent", "delivered", "read", "replied"]) ? step(1) : undefined, tone: "accent" },
    { label: "Entregue", at: reached(["delivered", "read", "replied"]) ? step(3) : undefined, tone: "accent" },
    { label: "Lida", at: reached(["read", "replied"]) ? step(41) : undefined, tone: "success" },
    { label: "Respondida", at: send.status === "replied" ? step(217) : undefined, tone: "success" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <SendStatusBadge status={send.status} />
        <span className="font-mono text-[11px] text-fg-3">{send.id}</span>
      </div>

      {send.error && (
        <div className="flex gap-2.5 rounded-sm border border-danger/30 bg-danger-soft p-3">
          <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
          <span className="font-mono text-[11px] leading-relaxed text-fg-2">{send.error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Mini label="Destino" value={send.destination} mono />
        <Mini label="Custo" value={money(send.cost)} mono />
        <Mini label="Campanha" value={campaign?.name ?? "—"} />
        <Mini label="Cupom" value={send.couponCode ?? "—"} mono />
      </div>

      <div className="flex flex-col gap-2">
        <span className="caps">Linha do tempo</span>
        <div className="flex flex-col gap-0">
          {timeline.map((t, i) => (
            <div key={t.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full border",
                    t.at ? (t.tone === "success" ? "border-success bg-success" : "border-accent bg-accent") : "border-line-strong bg-transparent",
                  )}
                />
                {i < timeline.length - 1 && <span className={cn("w-px flex-1", t.at ? "bg-line-strong" : "bg-line")} />}
              </div>
              <div className="flex flex-1 items-baseline justify-between gap-2 pb-4">
                <span className={cn("text-[12px]", t.at ? "text-fg-2" : "text-fg-3")}>{t.label}</span>
                <span className="font-mono text-[10px] text-fg-3">{t.at ? fmtDateTime(t.at) : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {template && (
        <div className="flex flex-col gap-2">
          <span className="caps">Conteúdo enviado</span>
          <div className="rounded-sm border border-line bg-bg p-3">
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-2">
              {template.body.replace(/\{\{(\d+)\}\}/g, (_, i: string) =>
                i === "2" && send.couponCode ? send.couponCode : template.variables.find((v) => v.index === i)?.example ?? `{{${i}}}`,
              )}
            </p>
          </div>
        </div>
      )}

      <Note>
        O status é o último evento recebido no webhook
        <span className="font-mono text-fg-2"> messages.statuses</span>. Em dry-run, o evento é
        simulado pelo endpoint de desenvolvimento.
      </Note>
    </div>
  );
}

function Mini({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-bg px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-3">{label}</span>
      <span className={cn("truncate text-[12px] text-fg", mono && "font-mono")}>{value}</span>
    </div>
  );
}
