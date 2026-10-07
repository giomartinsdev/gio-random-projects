import { useState } from "react";
import { ChevronDown, Download, Mail, MessageCircle, MoreVertical, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useConfigured } from "@/lib/useConfig";
import { cn } from "@/lib/utils";
import type { Lead, LeadDetail, Paged } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type BadgeTone } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Drawer } from "@/components/ui/Drawer";
import { Avatar, Table, TableBody, TableHead, TableRow, Td, Th } from "@/components/ui/Table";
import { Orb } from "@/components/ui/Orb";
import { ConfigureApiState, EmptyState, ErrorState, LoadingState } from "@/components/ApiState";
import { Topbar } from "@/components/Topbar";

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  qualified: { label: "Qualificado", tone: "accent" },
  replied: { label: "Respondeu", tone: "success" },
  contacted: { label: "Abordado", tone: "muted" },
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function fitTone(fit: number): string {
  if (fit >= 88) return "text-success";
  if (fit >= 80) return "text-accent-light";
  return "text-fg-2";
}

export function LeadsPage() {
  const cfg = useConfigured();
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const leads = useAsync<Paged<Lead>>(
    () => api.leads(statusFilter ? { status: statusFilter } : {}),
    [statusFilter],
    cfg !== null,
  );
  const detail = useAsync<LeadDetail>(() => api.lead(selected!), [selected], cfg !== null && selected !== null);

  if (!cfg) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar title="Leads" />
        <ConfigureApiState />
      </div>
    );
  }

  const items = leads.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Leads"
          left={<span className="rounded-full bg-elevated px-2.5 py-1 font-mono text-[12px] text-fg-2">{items.length}</span>}
          right={
            <>
              <Button variant="secondary" icon={<Download size={16} />} className="py-2.5" disabled title="Exportação ainda não disponível na API">
                Exportar
              </Button>
              <Button icon={<Plus size={16} />} className="py-2.5" disabled title="A API ainda não expõe criação de lead">
                Novo lead
              </Button>
            </>
          }
        />

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 pb-6 pt-5">
          <div className="flex items-center gap-2.5">
            <Input icon={<Search size={16} />} placeholder="Buscar leads…" className="max-w-[320px]" disabled />
            <div className="relative">
              <button
                onClick={() => setStatusFilter(statusFilter === "qualified" ? "" : "qualified")}
                className="flex items-center gap-2 rounded-sm bg-surface px-3.5 py-2.5 text-[13px] text-fg-2 transition-colors hover:text-fg"
              >
                {statusFilter ? "Qualificados" : "Todos os status"}
                <ChevronDown size={14} className="text-fg-3" />
              </button>
            </div>
          </div>

          <Table>
            <TableHead>
              <Th className="w-[260px] shrink-0">Empresa</Th>
              <Th className="w-[140px] shrink-0">Canal</Th>
              <Th className="w-[160px] shrink-0">Status</Th>
              <Th className="w-[90px] shrink-0">Fit</Th>
              <Th className="flex-1" />
            </TableHead>
            <TableBody>
              {leads.loading ? (
                <LoadingState label="Carregando leads…" />
              ) : leads.error ? (
                <ErrorState error={leads.error} onRetry={leads.reload} compact />
              ) : items.length === 0 ? (
                <EmptyState title="Nenhum lead ainda" hint="Comece uma campanha para o agente prospectar." />
              ) : (
                items.map((lead) => {
                  const meta = STATUS_META[lead.status] ?? STATUS_META.contacted;
                  return (
                    <TableRow
                      key={lead.id}
                      onClick={() => setSelected(lead.id)}
                      className={cn("border-b border-line gap-0", selected === lead.id && "bg-elevated")}
                    >
                      <Td className="flex w-[260px] shrink-0 items-center gap-3">
                        <Avatar initials={initials(lead.company_name)} size={32} />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[14px] font-medium text-fg">{lead.company_name}</span>
                          <span className="truncate text-[12px] text-fg-3">{lead.segment}</span>
                        </div>
                      </Td>
                      <Td className="flex w-[140px] shrink-0 items-center gap-2 text-[13px] text-fg-2">
                        {lead.channel === "whatsapp" ? <MessageCircle size={14} /> : <Mail size={14} />}
                        {lead.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
                      </Td>
                      <Td className="w-[160px] shrink-0">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </Td>
                      <Td className={cn("w-[90px] shrink-0 font-mono text-[13px]", fitTone(lead.fit))}>{lead.fit}</Td>
                      <Td className="flex w-[60px] shrink-0 justify-end">
                        <MoreVertical size={16} className="text-fg-3" />
                      </Td>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Drawer open={selected !== null} title="Detalhe do lead" onClose={() => setSelected(null)}>
        {detail.loading ? (
          <LoadingState label="Carregando detalhe…" />
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={detail.reload} compact />
        ) : detail.data ? (
          <LeadDetailBody lead={detail.data} />
        ) : (
          <EmptyState title="Selecione um lead" hint="Os detalhes reais aparecem aqui." />
        )}
      </Drawer>
    </div>
  );
}

function LeadDetailBody({ lead }: { lead: LeadDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Avatar initials={initials(lead.company_name)} size={52} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[19px] font-semibold text-fg">{lead.company_name}</span>
          <span className="truncate text-[13px] text-fg-2">
            {lead.segment}
            {lead.source_url ? ` · ${lead.source_url}` : ""}
          </span>
        </div>
        <div className="flex flex-col items-center rounded-sm bg-accent-soft px-3.5 py-2">
          <span className="text-[18px] font-semibold text-accent-light">{lead.fit}</span>
          <span className="text-[10px] font-medium tracking-widest text-accent">FIT</span>
        </div>
      </div>

      {lead.enriched && Object.keys(lead.enriched).length > 0 ? (
        <div className="flex flex-col divide-y divide-line rounded-md bg-bg px-4">
          {Object.entries(lead.enriched).map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-3">
              <span className="shrink-0 text-[13px] text-fg-3">{k}</span>
              <span className="text-right text-[13px] text-fg">{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-fg-3">Sem dados de enriquecimento.</p>
      )}

      {lead.agent_summary && (
        <div className="flex flex-col gap-3 rounded-md bg-elevated p-4">
          <div className="flex items-center gap-2">
            <Orb state="researching" size={16} glow={false} />
            <span className="text-[13px] font-medium text-fg">Resumo do agente</span>
          </div>
          <p className="text-[13px] leading-relaxed text-fg-2">{lead.agent_summary}</p>
        </div>
      )}

      {lead.timeline && lead.timeline.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <span className="caps">Linha do tempo</span>
          {lead.timeline.map((ev) => (
            <div key={ev.label} className="flex gap-3">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                  ev.tone === "current" ? "bg-accent" : ev.tone === "pending" ? "bg-line-strong" : "bg-success",
                )}
              />
              <div className="flex min-w-0 flex-col">
                <span className="text-[14px] font-medium text-fg">{ev.label}</span>
                {ev.detail && <span className="text-[12px] text-fg-2">{ev.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {lead.last_message && (
        <div className="flex flex-col gap-2.5">
          <span className="caps">Conversa</span>
          <div className="flex flex-col gap-1.5 rounded-md bg-accent-soft p-4">
            <span className="text-[13px] leading-relaxed text-accent-light">{lead.last_message.content}</span>
          </div>
        </div>
      )}
    </div>
  );
}
