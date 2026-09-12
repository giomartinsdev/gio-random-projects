// Selo dos 3 status da sessão (FR-004/US-5): cores sólidas da paleta —
// ativa em destaque (primary), entregue em success, arquivada apagada.
import type { StatusSessao } from "@/lib/api";

const ROTULO: Record<StatusSessao, string> = {
  em_andamento: "em andamento",
  entregue: "entregue",
  arquivada: "arquivada",
};

const CORES: Record<StatusSessao, string> = {
  em_andamento: "bg-primary text-primary-foreground",
  entregue: "bg-success text-success-foreground",
  arquivada: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: StatusSessao }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${CORES[status]}`}
    >
      {ROTULO[status]}
    </span>
  );
}