import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { listBets, type Bet } from "@/lib/api";
import { formatBRL, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { checkmarkIcon, errorIcon, loadingIcon, radioButtonIcon } from "@/lib/lottie-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Histórico</CardTitle>
        <CardDescription>Últimas 50 apostas — a lista se atualiza sozinha enquanto tem coisa na fila.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {bets === null ? (
          <p className="text-sm text-muted-foreground">carregando…</p>
        ) : bets.length === 0 ? (
          <p className="text-sm text-muted-foreground">nenhuma aposta ainda — cole um link na aba apostar.</p>
        ) : (
          bets.map((bet) => <BetRow key={bet.id} bet={bet} />)
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<Bet["status"], string> = {
  queued: "na fila",
  running: "executando",
  succeeded: "confirmada",
  failed: "falhou",
};

// One animated status glyph per state -- pulsing dots while waiting,
// the real spinner while running, a check or an X once it's done. The
// color rides on the same span as the label.
function StatusGlyph({ status }: { status: Bet["status"] }) {
  const animation =
    status === "running" ? loadingIcon : status === "succeeded" ? checkmarkIcon : status === "failed" ? errorIcon : radioButtonIcon;
  const color =
    status === "running"
      ? "text-primary"
      : status === "succeeded"
        ? "text-green-500"
        : status === "failed"
          ? "text-destructive"
          : "text-muted-foreground";
  const pending = status === "queued" || status === "running";
  return (
    <AnimatedIcon animation={animation} size={16} autoplay loop={pending} className={color} />
  );
}

function BetRow({ bet }: { bet: Bet }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState(false);
  const hostname = (() => {
    try {
      return new URL(bet.url).hostname;
    } catch {
      return bet.url;
    }
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-1 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <StatusGlyph status={bet.status} />
          {STATUS_LABEL[bet.status]}
        </span>
        <span className="font-mono text-sm font-semibold">{formatBRL(bet.stakeCents)}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {bet.vendor} · {bet.units} {bet.units === 1 ? "unidade" : "unidades"} · {hostname}
      </p>
      <p className="text-xs text-muted-foreground">{formatDateTime(bet.createdAt)}</p>

      {bet.receipt?.dryRun && (
        <p className="text-xs font-medium text-green-500">ensaio — nada foi apostado de verdade</p>
      )}
      {bet.error && <p className="text-xs text-destructive">{bet.error}</p>}
      {bet.receipt?.screenshotJpeg && (
        <div>
          <button
            type="button"
            onClick={() => setShot(!shot)}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", shot && "rotate-180")} />
            {shot ? "esconder screenshot" : "ver screenshot"}
          </button>
          {shot && (
            <img
              src={`data:image/jpeg;base64,${bet.receipt.screenshotJpeg}`}
              alt={`screenshot do recibo da aposta ${bet.id}`}
              loading="lazy"
              className="mt-1 w-full rounded-md border"
            />
          )}
        </div>
      )}
      {bet.receipt?.steps && bet.receipt.steps.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "esconder passos" : "ver passos"}
          </button>
          {open && (
            <ol className="mt-1 space-y-1 rounded-md border bg-secondary/50 p-3 text-xs text-muted-foreground">
              {bet.receipt.steps.map((step, index) => (
                <li key={index} className="list-inside list-decimal">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </motion.div>
  );
}