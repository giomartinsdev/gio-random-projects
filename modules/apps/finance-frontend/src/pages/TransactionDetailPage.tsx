import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CalendarClock, Landmark, Tag, TrendingDown, TrendingUp } from "lucide-react";
import { api, formatBRL, type OFAccount, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty } from "@/components/primitives";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";

// Detalhe profundo no formato cockpit: rail esquerdo com o valor/tipo, centro
// com o cruzamento (quando, conta, classificação, detalhes), direito com a
// conta de origem/destino e a navegação cruzada.
export function TransactionDetailPage({ id }: { id: string }) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, acc] = await Promise.all([api.transaction(id), api.ofAccounts().catch(() => ({ accounts: [] }))]);
      setTx(t);
      setAccounts(acc.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não encontrei essa transação");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <Cockpit center={<Card><Empty text="carregando…" /></Card>} />;
  }
  if (error || !tx) {
    return (
      <Cockpit
        center={
          <div>
            <BackLink />
            <Card><Empty text={error || "Transação não encontrada."} /></Card>
          </div>
        }
      />
    );
  }

  const income = tx.transaction_type === "INCOME";
  const when = new Date(tx.occurred_at);
  const account = accounts.find((a) => a.account_id === tx.account_id || a.id === tx.account_id);
  const accountLabel = account?.name || tx.account_id || "—";

  const left = (
    <Card>
      <div className="kick mb-3">{income ? "entrada" : "saída"}</div>
      <p className={cn("fig tnum", income ? "text-up" : "text-fg")}>
        {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(tx.amount))))}
      </p>
      <p className="mt-1 text-[13px]">{tx.counterparty || tx.description || "Lançamento"}</p>
      <span className={cn("pill mt-3", income ? "text-up" : "text-down")}>
        {income ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        {tx.transaction_type}
      </span>
    </Card>
  );

  const center = (
    <div className="space-y-3">
      <BackLink />
      <Card title="Quando">
        <Row icon={<CalendarClock />} label="Data">
          {when.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </Row>
        <Row icon={<CalendarClock />} label="Horário">{when.toLocaleTimeString("pt-BR")}</Row>
      </Card>
      <Card title="Classificação">
        <Row icon={<Tag />} label="Categoria">
          <a className="hover:text-primary" href={hrefFor({ name: "limits" })}>{tx.category || "Outros"}</a>
        </Row>
        <Row icon={<ArrowRightLeft />} label="Origem">{originLabel(tx.source)}</Row>
        {tx.external_category && (
          <Row icon={<Tag />} label="Taxonomia do banco"><span className="font-mono text-[11px]">{tx.external_category}</span></Row>
        )}
      </Card>
      <Card title="Detalhes do lançamento">
        {tx.description && <Row label="Descrição">{tx.description}</Row>}
        {tx.counterparty && <Row label="Estabelecimento / pessoa">{tx.counterparty}</Row>}
        <Row label="Moeda">{tx.currency}</Row>
        <Row label="Valor cru"><span className="tnum font-mono">{tx.amount}</span></Row>
        <Row label="ID"><span className="font-mono text-[11px]">{tx.id}</span></Row>
      </Card>
    </div>
  );

  const right = (
    <>
      <Card title="Conta">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Landmark className="size-4" />
          </span>
          <div>
            <p className="text-[13px]">{accountLabel}</p>
            {account && <p className="tnum text-[12px] dim">saldo {formatBRL(account.balance_amount)}</p>}
          </div>
        </div>
        <p className="mt-3 text-[11px] dim">id da conta: {tx.account_id || "—"}</p>
      </Card>
      <Card title="Navegar">
        <a href={hrefFor({ name: "transactions" })} className="row"><span /><span className="text-[13px]">Todas as transações</span><span className="dim">→</span></a>
        <a href={hrefFor({ name: "accounts" })} className="row"><span /><span className="text-[13px]">Contas</span><span className="dim">→</span></a>
        <a href={hrefFor({ name: "limits" })} className="row"><span /><span className="text-[13px]">Limites da categoria</span><span className="dim">→</span></a>
      </Card>
    </>
  );

  return <Cockpit left={left} center={center} right={right} />;
}

function BackLink() {
  return (
    <a href={hrefFor({ name: "transactions" })} className="inline-flex items-center gap-1.5 text-[12px] dim hover:text-fg">
      <ArrowLeft className="size-3.5" /> Transações
    </a>
  );
}

function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <dt className="flex items-center gap-1.5 text-[13px] dim">
        {icon && <span className="[&_svg]:size-3.5">{icon}</span>}
        {label}
      </dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  );
}

function originLabel(source: string): string {
  switch (source) {
    case "OPEN_FINANCE_SYNC": return "Open Finance (banco)";
    case "WHATSAPP_MANUAL": return "WhatsApp";
    case "WEB_MANUAL": return "Lançado na tela";
    default: return source || "—";
  }
}
