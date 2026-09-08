import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { listBets, type Bet } from "@/lib/api";
import { formatBRL, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// The history tab: last 50 bets, polling every 3s while anything is
// still queued/running (the receipt arrives when the runner reports).
export function HistoryPage() {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchBets() {
      try {
        const body = await listBets();
        if (cancelled) return;
        setBets(body.bets);
        setError(null);
        // Nothing pending anymore: stop the interval, one fetch per
        // tab visit is enough.
        const pending = body.bets.some((bet) => bet.status === "queued" || bet.status === "running");
        if (!pending && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        if (!cancelled) setError("não deu pra carregar o histórico");
      }
    }

    void fetchBets();
    timer = setInterval(() => void fetchBets(), 3000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-bold">histórico</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {bets === null ? (
        <p className="text-sm text-muted-foreground">carregando…</p>
      ) : bets.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            nenhuma aposta ainda — cole um link na aba apostar.
          </CardContent>
        </Card>
      ) : (
        bets.map((bet) => <BetRow key={bet.id} bet={bet} />)
      )}
    </div>
  );
}

const STATUS_LABEL: Record<Bet["status"], string> = {
  queued: "na fila",
  running: "executando",
  succeeded: "confirmada",
  failed: "falhou",
};

function BetRow({ bet }: { bet: Bet }) {
  const [open, setOpen] = useState(false);
  const hostname = (() => {
    try {
      return new URL(bet.url).hostname;
    } catch {
      return bet.url;
    }
  })();

  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={bet.status} />
          <span className="font-display text-lg font-bold">{formatBRL(bet.stakeCents)}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {bet.vendor} · {bet.units} {bet.units === 1 ? "unidade" : "unidades"} · {hostname}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(bet.createdAt)}</p>

        {bet.receipt?.dryRun && (
          <p className="text-xs font-semibold text-success">ensaio — nada foi apostado de verdade</p>
        )}
        {bet.error && <p className="text-sm text-destructive">{bet.error}</p>}
        {bet.receipt?.steps && bet.receipt.steps.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" className="px-2" onClick={() => setOpen(!open)}>
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
              {open ? "esconder passos" : "ver passos"}
            </Button>
            {open && (
              <ol className="mt-1 space-y-1 rounded-2xl border-2 bg-secondary/50 p-4 text-xs text-muted-foreground">
                {bet.receipt.steps.map((step, index) => (
                  <li key={index} className="list-inside list-decimal">
                    {step}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: Bet["status"] }) {
  const className =
    status === "succeeded"
      ? "bg-success/20 text-success"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : status === "running"
          ? "bg-primary/20 text-primary"
          : "bg-secondary text-muted-foreground";
  return (
    <span className={cn("rounded-full px-3 py-1 text-xs font-bold", className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}