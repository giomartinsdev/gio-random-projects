import { Check, MessageCircle, PenLine, Send, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";

// Status → rótulo/tom, num lugar só: telas de template, campanha e envio
// compartilham vocabulário mas não os mesmos estados.
import type { CampaignStatus, SendStatus, TemplateStatus } from "@/lib/types";
import { StatusBadge, type BadgeTone } from "./ui/Badge";

const TEMPLATE: Record<TemplateStatus, { label: string; tone: BadgeTone }> = {
  approved: { label: "Aprovado", tone: "success" },
  pending: { label: "Em análise", tone: "warn" },
  rejected: { label: "Rejeitado", tone: "danger" },
  paused: { label: "Pausado", tone: "muted" },
  draft: { label: "Rascunho", tone: "muted" },
};

const CAMPAIGN: Record<CampaignStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Rascunho", tone: "muted" },
  scheduled: { label: "Agendada", tone: "accent" },
  running: { label: "Em execução", tone: "success" },
  paused: { label: "Pausada", tone: "warn" },
  finished: { label: "Concluída", tone: "muted" },
};

const SEND: Record<SendStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Na fila", tone: "muted" },
  sent: { label: "Enviada", tone: "accent" },
  delivered: { label: "Entregue", tone: "accent" },
  read: { label: "Lida", tone: "success" },
  replied: { label: "Respondida", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  skipped: { label: "Ignorada", tone: "muted" },
};

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const m = TEMPLATE[status];
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const m = CAMPAIGN[status];
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>;
}

export function SendStatusBadge({ status }: { status: SendStatus }) {
  const m = SEND[status];
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>;
}

/** Canal com ícone — WhatsApp/E-mail/SMS aparecem em quase toda linha. */
export function ChannelLabel({
  channel,
  className,
  withIcon = true,
}: {
  channel: "whatsapp" | "email" | "sms";
  className?: string;
  withIcon?: boolean;
}) {
  const label = channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "E-mail" : "SMS";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-fg-2", className)}>
      {withIcon && (channel === "whatsapp" ? <MessageCircle size={14} /> : channel === "email" ? <PenLine size={14} /> : <Send size={14} />)}
      {label}
    </span>
  );
}

/** Bloco "o que este motor faz" usado no editor de fluxo e no dashboard. */
export function PipelineHint({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {steps.map((s) => (
        <div key={s} className="flex gap-2.5">
          <Check size={16} className="mt-0.5 shrink-0 text-fg-3" />
          <span className="text-[13px] leading-snug text-fg-2">{s}</span>
        </div>
      ))}
    </div>
  );
}

export const PIPELINE_ICONS = { Sparkles, Target, Send };
