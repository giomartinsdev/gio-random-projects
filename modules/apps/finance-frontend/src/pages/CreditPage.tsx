import { useCallback, useEffect, useState } from "react";
import { CreditCard, Landmark, Repeat, TrendingDown } from "lucide-react";
import {
  api,
  formatBRL,
  type Bill,
  type CreditCard as Card,
  type Exchange,
  type Financing,
  type Loan,
} from "@/lib/api";
import { Card as Surface, Cockpit, Empty, Kpi } from "@/components/primitives";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

// Cartões e crédito: junta tudo que o Open Finance entrega além de conta e
// investimento — cartões (limite/utilizado), faturas, empréstimos,
// financiamentos e câmbio. Cada bloco some quando não há dado.
export function CreditPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [financings, setFinancings] = useState<Financing[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, b, l, f, x] = await Promise.all([
        api.creditCards(),
        api.bills(),
        api.loans(),
        api.financings(),
        api.exchanges(),
      ]);
      setCards(c.credit_cards ?? []);
      setBills(b.bills ?? []);
      setLoans(l.loans ?? []);
      setFinancings(f.financings ?? []);
      setExchanges(x.exchanges ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 30);

  const limit = cards.reduce((s, c) => s + Number(c.credit_limit), 0);
  const used = cards.reduce((s, c) => s + Number(c.balance), 0);
  const debt = loans.reduce((s, l) => s + Number(l.outstanding_balance), 0)
    + financings.reduce((s, f) => s + Number(f.outstanding_balance), 0);

  const left = (
    <>
      <Surface>
        <p className="kick mb-1">{cards.length} cartões · {loans.length + financings.length} contratos</p>
        <p className="kick">Limite de crédito total</p>
        <p className="mono tnum text-[22px] font-semibold tracking-tight">{formatBRL(String(limit))}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Kpi label="Utilizado" value={formatBRL(String(used))} tone="down" />
          <Kpi label="Saldo devedor" value={formatBRL(String(debt))} tone="down" />
        </div>
      </Surface>
      <Surface title="Como funciona" right={<Repeat className="size-3.5 text-fg-dim" />}>
        <p className="text-[11.5px] leading-[1.6] text-fg-dim">
          Cartões, faturas, empréstimos, financiamentos e câmbio vêm do mesmo consentimento
          Open Finance. Se algum bloco estiver vazio, a conta pode não expor esse produto —
          reconecte em <span className="mono text-fg">Open Finance</span> para incluir.
        </p>
      </Surface>
    </>
  );

  const center = (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}

      <Surface title="Cartões" right={<CreditCard className="size-3.5 text-fg-dim" />}>
        {cards.length === 0 && !loading ? (
          <Empty text="Nenhum cartão importado." />
        ) : (
          <ul>
            {cards.map((c) => (
              <li key={c.id} className="row px-1">
                <span className="flex size-6 items-center justify-center rounded-md bg-muted text-fg-dim">
                  <CreditCard className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg">{c.name || c.brand || "Cartão"}</span>
                  <span className="block truncate text-[11px] dim">
                    {c.brand}{c.last4 ? ` · •••• ${c.last4}` : ""}{c.due_day ? ` · vence dia ${c.due_day}` : ""}
                  </span>
                </span>
                <span className="min-w-0 text-right">
                  <span className="mono block text-[13px] font-semibold">{formatBRL(c.available_limit)}</span>
                  <span className="mono block text-[10.5px] dim">disponível · limite {formatBRL(c.credit_limit)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface title="Faturas">
        {bills.length === 0 ? (
          <Empty text="Nenhuma fatura importada." />
        ) : (
          <ul>
            {bills.map((b) => (
              <li key={b.id} className="row px-1">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-fg">
                    {b.due_date ? `Vence ${new Date(b.due_date + "T12:00").toLocaleDateString("pt-BR")}` : "Fatura"}
                  </span>
                  <span className="block text-[10.5px] dim">{b.status || "—"}</span>
                </span>
                <span className="mono text-right text-[13px] font-semibold">{formatBRL(b.total_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface title="Empréstimos e financiamentos" right={<Landmark className="size-3.5 text-fg-dim" />}>
        {loans.length + financings.length === 0 ? (
          <Empty text="Nenhum contrato de crédito importado." />
        ) : (
          <ul>
            {[...loans, ...financings].map((l) => (
              <li key={l.id} className="row px-1">
                <span className="flex size-6 items-center justify-center rounded-md bg-muted text-down">
                  <TrendingDown className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg">{l.name || l.type || "Contrato"}</span>
                  <span className="block truncate text-[11px] dim">
                    {l.installment_amount ? `parcela ${formatBRL(l.installment_amount)}` : ""}
                    {l.due_date ? ` · até ${new Date(l.due_date + "T12:00").toLocaleDateString("pt-BR")}` : ""}
                  </span>
                </span>
                <span className="min-w-0 text-right">
                  <span className="mono block text-[13px] font-semibold text-down">{formatBRL(l.outstanding_balance)}</span>
                  <span className="mono block text-[10.5px] dim">saldo devedor</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );

  const right = (
    <Surface title="Câmbio">
      {exchanges.length === 0 ? (
        <Empty text="Nenhuma operação de câmbio." />
      ) : (
        <ul>
          {exchanges.map((x) => (
            <li key={x.id} className="ev" style={{ gridTemplateColumns: "1fr auto" }}>
              <p className="min-w-0">
                <span className="block truncate text-[12px]">{x.type || "Operação"}</span>
                <span className="block text-[10.5px] dim">{x.target_currency || x.currency}</span>
              </p>
              <span className="tnum text-[12px]">{formatBRL(x.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );

  return <Cockpit left={left} center={center} right={right} />;
}
