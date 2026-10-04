import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CalendarClock, Landmark, Tag, TrendingDown, TrendingUp } from "lucide-react";
import { api, formatBRL, type OFAccount, type Transaction } from "@/lib/api";
import { Panel, Empty } from "@/components/primitives";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";

// O detalhe profundo de uma transação: cruza data, horário, tipo, categoria, a
// conta que saiu/entrou (ícone + nome), o lugar, a origem e o valor cru da
// taxonomia. Tudo clicável leva de volta às listas.
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

  if (loading) return <p className="text-[13px] text-muted-foreground">carregando…</p>;
  if (error || !tx) {
    return (
      <div>
        <BackLink />
        <Empty text={error || "Transação não encontrada."} />
      </div>
    );
  }

  const income = tx.transaction_type === "INCOME";
  const when = new Date(tx.occurred_at);
  const account = accounts.find((a) => a.account_id === tx.account_id || a.id === tx.account_id);
  const accountLabel = account?.name || tx.account_id || "—";

  return (
    <div>
      <BackLink />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{income ? "entrada" : "saída"}</p>
          <h1 className={cn("tnum text-3xl", income ? "text-success" : "text-foreground")}>
            {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(tx.amount))))}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{tx.counterparty || tx.description || "Lançamento"}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px]", income ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
          {income ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          {tx.transaction_type}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Quando">
          <dl className="space-y-2 text-[13px]">
            <Row icon={<CalendarClock />} label="Data">{when.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</Row>
            <Row icon={<CalendarClock />} label="Horário">{when.toLocaleTimeString("pt-BR")}</Row>
          </dl>
        </Panel>

        <Panel title="Conta">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Landmark className="size-5" />
            </span>
            <div>
              <p className="text-[13px]">{accountLabel}</p>
              {account && <p className="tnum text-[12px] text-muted-foreground">saldo {formatBRL(account.balance_amount)}</p>}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">id da conta: {tx.account_id || "—"}</p>
        </Panel>

        <Panel title="Classificação">
          <dl className="space-y-2 text-[13px]">
            <Row icon={<Tag />} label="Categoria">
              <a className="hover:text-primary" href={hrefFor({ name: "limits" })}>{tx.category || "Outros"}</a>
            </Row>
            <Row icon={<ArrowRightLeft />} label="Origem">{originLabel(tx.source)}</Row>
            {tx.external_category && <Row icon={<Tag />} label="Taxonomia do banco"><span className="font-mono text-[11px]">{tx.external_category}</span></Row>}
          </dl>
        </Panel>

        <Panel title="Detalhes do lançamento">
          <dl className="space-y-2 text-[13px]">
            {tx.description && <Row icon={null} label="Descrição">{tx.description}</Row>}
            {tx.counterparty && <Row icon={null} label="Estabelecimento / pessoa">{tx.counterparty}</Row>}
            <Row icon={null} label="Moeda">{tx.currency}</Row>
            <Row icon={null} label="Valor cru"><span className="tnum font-mono">{tx.amount}</span></Row>
            <Row icon={null} label="ID"><span className="font-mono text-[11px]">{tx.id}</span></Row>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <a href={hrefFor({ name: "transactions" })} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Transações
    </a>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {icon && <span className="[&_svg]:size-3.5">{icon}</span>}
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function originLabel(source: string): string {
  switch (source) {
    case "OPEN_FINANCE_SYNC":
      return "Open Finance (banco)";
    case "WHATSAPP_MANUAL":
      return "WhatsApp";
    case "WEB_MANUAL":
      return "Lançado na tela";
    default:
      return source || "—";
  }
}
