import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, CheckCircle2, CircleAlert, KeyRound, Loader2, Send, Wallet } from "lucide-react";
import { api, ApiError, readApiKey, rememberApiKey, type RelayOutcome } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// The command presets the screen offers. Each action name comes from the
// shared contract (packages/finance-contracts/src/finance_contracts/
// envelope.py) -- the source of truth the ACL's router validates against,
// so a typo here is a 422 from the API rather than a silent drift. The
// payload shape is the domain's own, so these are editable examples.
const PRESETS = [
  {
    id: "register-expense",
    label: "Registrar despesa",
    action: "finance.transaction.register",
    payload: '{\n  "type": "EXPENSE",\n  "amount": "45.00",\n  "currency": "BRL",\n  "category": "Alimentação",\n  "occurred_at": "2026-10-04T12:00:00-03:00"\n}',
  },
  {
    id: "register-income",
    label: "Registrar receita",
    action: "finance.transaction.register",
    payload: '{\n  "type": "INCOME",\n  "amount": "3500.00",\n  "currency": "BRL",\n  "category": "Renda Extra",\n  "occurred_at": "2026-10-04T09:00:00-03:00"\n}',
  },
  {
    id: "set-budget",
    label: "Definir orçamento",
    action: "finance.budget.setCategory",
    payload: '{\n  "category": "Alimentação",\n  "limit": "600.00",\n  "currency": "BRL",\n  "month": "2026-10"\n}',
  },
] as const;

type Health = "checking" | "up" | "down";

export default function Home() {
  const [health, setHealth] = useState<Health>("checking");
  const [apiKey, setApiKey] = useState(readApiKey());
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS[0]);
  const [payload, setPayload] = useState<string>(PRESETS[0].payload);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<RelayOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(() => {
    setHealth("checking");
    api
      .health()
      .then(() => setHealth("up"))
      .catch(() => setHealth("down"));
  }, []);

  useEffect(probe, [probe]);

  const choosePreset = (next: (typeof PRESETS)[number]) => {
    setPreset(next);
    setPayload(next.payload);
    setOutcome(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOutcome(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      setError("O payload não é um JSON válido.");
      return;
    }
    rememberApiKey(apiKey.trim());
    setSending(true);
    try {
      setOutcome(await api.submit({ action: preset.action, payload: parsed }));
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? "Chave de API recusada (401). Confira a X-API-Key."
          : err instanceof Error
            ? err.message
            : "falha ao enviar o comando";
      setError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex items-center gap-3"
      >
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Wallet className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">finance</h1>
          <p className="text-sm text-muted-foreground">A gestão financeira conversacional.</p>
        </div>
      </motion.header>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              finance-api
            </CardTitle>
            <CardDescription>Liveness do backend (GET /healthz).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <HealthBadge state={health} />
            <Button onClick={probe} variant="outline" size="sm">
              Verificar
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            Chave de API
          </CardTitle>
          <CardDescription>
            A <code className="font-mono">X-API-Key</code> que identifica o chamador na auditoria. Fica só nesta
            sessão do navegador — nunca vai pro bundle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => rememberApiKey(apiKey.trim())}
            placeholder="cole a key aqui"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4 text-primary" />
            Enviar comando
          </CardTitle>
          <CardDescription>
            O envelope <code className="font-mono">{`{action, payload}`}</code> é relayado ao domain-api, que
            persiste. Só <strong>written</strong> é confirmação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={p.id === preset.id ? "default" : "outline"}
                  onClick={() => choosePreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="action">action</Label>
              <Input id="action" value={preset.action} readOnly className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payload">payload (JSON)</Label>
              <textarea
                id="payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={9}
                spellCheck={false}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <Button type="submit" disabled={sending || !apiKey.trim()} className="w-full sm:w-auto">
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? "Enviando…" : "Enviar"}
            </Button>
          </form>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {outcome && <Outcome outcome={outcome} />}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        A leitura (dashboards, extrato) chega na próxima fatia — {""}
        a superfície de escrita já é real.
      </p>
    </div>
  );
}

function HealthBadge({ state }: { state: Health }) {
  if (state === "checking") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> verificando
      </span>
    );
  }
  if (state === "up") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle2 className="size-3.5" /> no ar
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" /> fora do ar
    </span>
  );
}

// The three documented outcomes have three different meanings. "queued"
// (504) is deliberately NOT shown as an error: domain-api timed out
// waiting, but the command may still land (spec §4.1).
function Outcome({ outcome }: { outcome: RelayOutcome }) {
  const variant = outcome.status === "written" ? "success" : outcome.status === "failed" ? "destructive" : "warning";
  const icon = outcome.status === "written" ? <CheckCircle2 /> : outcome.status === "failed" ? <CircleAlert /> : <Activity />;
  const headline =
    outcome.status === "written"
      ? "Aplicado"
      : outcome.status === "failed"
        ? "Rejeitado"
        : "Na fila (timeout não é falha)";
  return (
    <Alert variant={variant} className="mt-4">
      {icon}
      <AlertDescription>
        <p className="font-medium">
          {headline} — <span className="font-mono">{outcome.status}</span> ({outcome.http})
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">command_id: {outcome.command_id}</p>
        {outcome.entity_id && <p className="mt-1 font-mono text-xs text-muted-foreground">entity_id: {outcome.entity_id}</p>}
        {outcome.error && <p className="mt-1 text-xs">{outcome.error}</p>}
      </AlertDescription>
    </Alert>
  );
}
