import { useCallback, useEffect, useMemo, useState } from "react";
import { MoveRight, RefreshCw } from "lucide-react";
import { api, formatBRL, type OFAccount, type OFConsent, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty } from "@/components/primitives";
import { AiDots } from "@/components/aidots";
import { hrefFor } from "@/lib/router";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { cn } from "@/lib/utils";

// Contas V3 (ui.pen §V3): rail com patrimônio consolidado, centro com cards de
// conta (status mono ONLINE/PENDENTE) + distribuição do saldo (stacked bar) +
// últimos movimentos, direita com conexões resumidas. Superfícies sólidas,
// hairlines, mono nos números.
export function AccountsPage() {
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [consents, setConsents] = useState<OFConsent[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, c] = await Promise.all([api.ofAccounts(), api.ofConsents()]);
      setAccounts(a.accounts ?? []);
      setConsents(c.consents ?? []);
      // últimos movimentos para os cards (leve: 8 transações)
      const t = await api.transactions("").catch(() => ({ transactions: [] }));
      setRecent((t.transactions ?? []).slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar as contas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 30);

  const total = useMemo(() => accounts.reduce((s, a) => s + Number(a.balance_amount), 0), [accounts]);
  const connected = consents.filter((c) => c.status === "AUTHORISED").length;

  // paleta fixa por conta (o .pen usa a série)
  const palette = ["bg-accent", "bg-up", "bg-warn"];
  const barColors = ["hsl(var(--accent))", "hsl(var(--up))", "hsl(var(--warn))"];

  const left = (
    <Card>
      <p className="kick mb-1">{accounts.length} conta(s) · {connected} conectada(s)</p>
      <p className="kick">Patrimônio</p>
      <p className="mono tnum text-[22px] font-semibold tracking-tight">{formatBRL(String(total))}</p>
      <p className="mt-1.5 text-[10.5px] dim">saldo de todas as contas conectadas</p>
      <div className="mt-4 border-t border-border pt-3">
        <p className="caps">webhook</p>
        <p className="mono mt-1 text-[12px] font-semibold text-accent">celcoin · ativo</p>
        <p className="text-[10.5px] dim">poll de segurança a cada 120s</p>
      </div>
    </Card>
  );

  const center = (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[13px] text-down">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a, idx) => (
          <Card key={a.id} className="space-y-1.5 transition-colors hover:border-accent/40">
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-fg">
                <span className={cn("size-2 shrink-0 rounded-[2px]", palette[idx % 3])} aria-hidden />
                {a.name || "Conta"}
              </p>
              <span
                className={cn(
                  "pill !py-0.5 font-mono !text-[9px]",
                  connected > 0 ? "!bg-up/15 text-up" : "!bg-warn/15 text-warn",
                )}
              >
                <span className={cn("dot", connected > 0 ? "bg-up" : "bg-warn")} />
                {connected > 0 ? "ONLINE" : "PENDENTE"}
              </span>
            </div>
            <p className="mono text-[9.5px] text-fg-dim">{a.account_type || "conta"}</p>
            <p className="mono text-[20px] font-semibold tracking-tight">{formatBRL(a.balance_amount)}</p>
            <a
              href={hrefFor({ name: "transactions" })}
              className="inline-flex items-center gap-1.5 text-[11px] text-fg-dim transition-colors hover:text-accent"
            >
              ver lançamentos <MoveRight className="size-3" />
            </a>
          </Card>
        ))}
        {!loading && accounts.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <Empty text="Nenhuma conta conectada ainda." />
            <div className="text-center">
              <a href={hrefFor({ name: "openfinance" })} className="text-[12.5px] text-accent hover:underline">
                Conectar um banco →
              </a>
            </div>
          </Card>
        )}
      </div>

      {/* Distribuição do saldo (stacked) */}
      {accounts.length > 0 && (
        <Card title="Distribuição do saldo">
          <div className="flex h-[24px] w-full overflow-hidden rounded-[8px]">
            {accounts.map((a, idx) => {
              const pct = total > 0 ? (Number(a.balance_amount) / total) * 100 : 0;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ width: `${Math.max(2, pct)}%`, background: barColors[idx % 3] }}
                  title={`${a.name}: ${pct.toFixed(0)}%`}
                >
                  {pct > 12 ? `${pct.toFixed(0)}%` : ""}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {accounts.map((a, idx) => (
              <span key={a.id} className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
                <span className={cn("h-[3px] w-2 rounded-full", palette[idx % 3])} aria-hidden />
                {a.name} {total > 0 && ((Number(a.balance_amount) / total) * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Últimos movimentos (por conta) */}
      {recent.length > 0 && (
        <Card title="Últimos movimentos" right={
          <button onClick={load} className="text-fg-dim hover:text-fg" title="Atualizar">
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        }>
          <div className="mono grid grid-cols-[56px_1fr_100px] items-center gap-3 border-b border-border bg-surface-2 px-2 py-1.5">
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">dia</span>
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">lançamento</span>
            <span className="font-mono text-right text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">valor</span>
          </div>
          <ul>
            {recent.map((t) => {
              const income = t.transaction_type === "INCOME";
              const own = !!t.inactive;
              return (
                <li key={t.id}>
                  <a href={hrefFor({ name: "transaction", id: t.id })} className={cn("grid grid-cols-[56px_1fr_100px] items-center gap-3 border-b border-border px-2 py-2 last:border-0 hover:bg-surface-2/60", own && "opacity-55")}>
                    <span className="font-mono text-[10px] text-fg-dim">
                      {new Date(t.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-[5px] shrink-0 rounded-full", own ? "bg-fg-dim" : income ? "bg-up" : "bg-down")} aria-hidden />
                      <span className={cn("truncate text-[11.5px]", own ? "text-fg-dim" : "text-fg font-medium")}>
                        {t.counterparty || t.description || t.category || "Lançamento"}
                      </span>
                    </span>
                    <span className={cn("mono text-right text-[11px] font-semibold", own ? "text-fg-dim" : income ? "text-up" : "text-fg")}>
                      {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(t.amount))))}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );

  const right = (
    <Card>
      <div className="hd">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <AiDots width={26} height={24} /> Conexões
        </p>
        <a href={hrefFor({ name: "openfinance" })} className="text-[11px] text-fg-dim hover:text-fg">gerir →</a>
      </div>
      {consents.length === 0 ? (
        <Empty text="Sem conexões ainda." />
      ) : (
        <ul className="divide-y divide-border">
          {consents.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 py-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-surface-2 font-mono text-[9.5px] font-semibold text-fg">
                {(c.institution_name || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{c.institution_name || c.institution_id}</span>
              <span
                className={cn(
                  "pill !py-0.5 !px-2 font-mono !text-[9px]",
                  c.status === "AUTHORISED" ? "!bg-up/15 text-up" : "!bg-warn/15 text-warn",
                )}
              >
                <span className={cn("dot", c.status === "AUTHORISED" ? "bg-up" : "bg-warn")} />
                {c.status === "AUTHORISED" ? "conectado" : "pendente"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return <Cockpit left={left} center={center} right={right} />;
}