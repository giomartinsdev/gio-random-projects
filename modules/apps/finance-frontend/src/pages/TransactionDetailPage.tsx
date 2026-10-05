import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CalendarClock, Landmark, Pencil, Tag, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { api, formatBRL, type OFAccount, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty } from "@/components/primitives";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";

// Detalhe profundo no formato cockpit: rail esquerdo com o valor/tipo, centro
// com o cruzamento (quando, conta, classificação, detalhes), direito com a
// conta de origem/destino e a navegação cruzada. O dono pode EDITAR (categoria,
// descrição, estabelecimento, valor, tipo, data) ou REMOVER — o worker valida
// a posse e o evento do domínio avisa no WhatsApp.
export function TransactionDetailPage({ id }: { id: string }) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [gone, setGone] = useState(false);

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

  // depois de editar/remover: o evento do domínio chega ao WhatsApp; aqui
  // refetch para a UI mostrar o estado aplicado (async: pode levar um instante)
  const refreshAfter = useCallback(() => {
    window.setTimeout(load, 400);
  }, [load]);

  if (gone) {
    return (
      <Cockpit
        center={
          <div>
            <BackLink />
            <Card>
              <Empty text="Lançamento removido." />
              <div className="flex justify-center">
                <a href={hrefFor({ name: "transactions" })} className="inline-flex h-9 items-center rounded-full border border-border-strong bg-bg-soft px-4 text-[13px] hover:bg-fg/8">
                  voltar para as transações
                </a>
              </div>
            </Card>
          </div>
        }
      />
    );
  }

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

  async function onEditSave(patch: {
    category?: string;
    counterparty?: string;
    description?: string;
    amount?: string;
    transaction_type?: Transaction["transaction_type"];
    occurred_at?: string;
  } & Record<string, string | undefined>) {
    setBusy(true);
    setStatus("");
    try {
      await api.updateTransaction(tx!.id, patch);
      setEditing(false);
      setStatus("corrigido ✓");
      refreshAfter();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "não consegui salvar");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setStatus("");
    try {
      await api.removeTransaction(tx!.id);
      setGone(true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "não consegui remover");
      setConfirmingRemove(false);
    } finally {
      setBusy(false);
    }
  }

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
      {status && <p className="mt-3 text-[12px] dim">{status}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => { setEditing(true); setConfirmingRemove(false); }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong bg-bg-soft px-3.5 text-[13px] transition-colors hover:bg-fg/8"
        >
          <Pencil className="size-3.5" /> editar
        </button>
        {!confirmingRemove ? (
          <button
            onClick={() => { setConfirmingRemove(true); setEditing(false); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] text-fg-dim transition-colors hover:border-down hover:text-down"
          >
            <Trash2 className="size-3.5" /> remover
          </button>
        ) : (
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-down/60 bg-down/10 px-3 text-[12.5px] text-down">
            remover mesmo?
            <button onClick={onRemove} disabled={busy} className="rounded-full bg-down px-2.5 py-1 text-[12px] text-bg disabled:opacity-50">
              {busy ? "removendo…" : "sim"}
            </button>
            <button onClick={() => setConfirmingRemove(false)} className="px-1.5 text-[12px] dim hover:text-fg">
              não
            </button>
          </span>
        )}
      </div>
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

  return (
    <>
      {editing && (
        <EditDialog
          tx={tx}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={onEditSave}
        />
      )}
      <Cockpit left={left} center={center} right={right} />
    </>
  );
}

// ------------------------------------------------------------ diálogo de edição

function EditDialog({
  tx,
  busy,
  onSave,
  onCancel,
}: {
  tx: Transaction;
  busy: boolean;
  onSave: (patch: {
    category?: string;
    counterparty?: string;
    description?: string;
    amount?: string;
    transaction_type?: Transaction["transaction_type"];
    occurred_at?: string;
  }) => void;
  onCancel: () => void;
}) {
  const when = new Date(tx.occurred_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const localValue = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const [type, setType] = useState(tx.transaction_type);
  const [amount, setAmount] = useState(String(Math.abs(Number(tx.amount))));
  const [category, setCategory] = useState(tx.category || "");
  const [counterparty, setCounterparty] = useState(tx.counterparty || "");
  const [description, setDescription] = useState(tx.description || "");
  const [occurredAt, setOccurredAt] = useState(localValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <button aria-label="Fechar edição" className="absolute inset-0 bg-black/70 dark:bg-bg/70" onClick={onCancel} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
        const patch: Record<string, string> = {};
        if (type !== tx.transaction_type) patch.transaction_type = type as string;
          if (String(Math.abs(Number(tx.amount))) !== amount && amount.trim() !== "") patch.amount = amount.replace(",", ".");
          if ((tx.category || "") !== category && category.trim() !== "") patch.category = category;
          if ((tx.counterparty || "") !== counterparty) patch.counterparty = counterparty;
          if ((tx.description || "") !== description) patch.description = description;
          if (localValue !== occurredAt) patch.occurred_at = new Date(occurredAt).toISOString();
          onSave(patch);
        }}
        className="card relative w-full max-w-[520px] space-y-3"
      >
        <p className="hd !mb-0"><h3>Editar lançamento</h3><span className="text-[11px] dim">campo vazio mantém o atual</span></p>
        <label className="block">
          <span className="kick mb-1 block">Tipo</span>
          <select value={type} onChange={(e) => setType(e.target.value as Transaction["transaction_type"])} className="hairline w-full rounded-[10px] bg-bg-soft px-3 py-2 text-[13px]">
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
            <option value="TRANSFER">Transferência</option>
          </select>
        </label>
        <label className="block">
          <span className="kick mb-1 block">Valor (R$, absoluto)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="hairline tnum w-full rounded-[10px] bg-bg-soft px-3 py-2 font-mono text-[13px]" />
        </label>
        <label className="block">
          <span className="kick mb-1 block">Categoria</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} list="finance-cats" className="hairline w-full rounded-[10px] bg-bg-soft px-3 py-2 text-[13px]" />
          <datalist id="finance-cats">
            {["Alimentação", "Transporte", "Moradia", "Saúde", "Lazer", "Assinaturas", "Mercado", "Renda", "Renda Extra", "Outros"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="kick mb-1 block">Estabelecimento / pessoa</span>
          <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className="hairline w-full rounded-[10px] bg-bg-soft px-3 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="kick mb-1 block">Descrição</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="hairline w-full rounded-[10px] bg-bg-soft px-3 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="kick mb-1 block">Quando</span>
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="hairline tnum w-full rounded-[10px] bg-bg-soft px-3 py-2 font-mono text-[12.5px]" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="h-9 rounded-full px-3.5 text-[13px] text-fg-dim hover:bg-fg/8 hover:text-fg">
            cancelar
          </button>
          <button type="submit" disabled={busy} className="h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-[hsl(40_6%_5%)] disabled:opacity-50">
            {busy ? "salvando…" : "salvar correção"}
          </button>
        </div>
      </form>
    </div>
  );
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