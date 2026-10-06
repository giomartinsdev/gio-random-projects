import { useCallback, useEffect, useState } from "react";
import { ChartLine, TrendingDown, TrendingUp } from "lucide-react";
import { api, formatBRL, type Investment } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi } from "@/components/primitives";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { cn } from "@/lib/utils";

// Investimentos no formato cockpit: rail esquerdo com o consolidado (total
// investido, bruto, rendimento e o insight da posição melhor), centro com as
// posições, rail direito com os rendimentos recentes por ativo. Os dados vêm
// do Open Finance (Celcoin via conector): posições + rendimentos, com o
// webhook puxando na hora. Refetch a cada 30s (rendimento é lento por natureza).
export function InvestmentsPage() {
  const [items, setItems] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.investments();
      setItems(r.investments ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar os investimentos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 30);

  // Rendimento só existe quando o custo (investido) é conhecido. Ações/fundos
  // não entregam preço de compra — investido vazio → rendimento vazio, a UI
  // mostra "—" em vez de um 0 mentiroso.
  const hasCost = (i: Investment) => i.invested_amount !== "" && Number(i.invested_amount) > 0;
  const withCost = items.filter(hasCost);
  const invested = withCost.reduce((s, i) => s + Number(i.invested_amount), 0);
  const grossAll = items.reduce((s, i) => s + Number(i.gross_amount), 0);
  const grossWithCost = withCost.reduce((s, i) => s + Number(i.gross_amount), 0);
  const yieldAmt = grossWithCost - invested;
  const yieldPct = invested > 0 ? (yieldAmt / invested) * 100 : 0;
  const best = withCost.filter((i) => Number(i.yield_amount) > 0).sort((a, b) => Number(b.yield_percent) - Number(a.yield_percent))[0];
  const winners = withCost.filter((i) => Number(i.yield_amount) > 0);

  const left = (
    <>
      <Card>
        <p className="kick mb-1">{items.length} ativos · {withCost.length} com custo conhecido</p>
        <p className="kick">Total investido</p>
        <p className="fig tnum text-fg">{formatBRL(String(invested))}</p>
        <p className="mt-1.5 text-[11px] dim">valor bruto {formatBRL(String(grossAll))}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Kpi label="Rendimento" value={formatBRL(String(yieldAmt), { signed: true })} tone={yieldAmt >= 0 ? "up" : "down"} />
          <Kpi label="% sob o custo" value={yieldPct.toFixed(2) + "%"} />
        </div>
        {withCost.length < items.length && (
          <p className="mt-3 text-[10.5px] dim">
            Ações/fundos não trazem preço de compra no Open Finance, então o rendimento deles
            fica fora do cálculo.
          </p>
        )}
      </Card>

      {best && (
        <Card title="Melhor posição" right={<span className="mono text-[9px] uppercase tracking-widest text-fg-dim">{best.ticker || best.type}</span>}>
          <p className="text-[13px] font-medium">{best.name}</p>
          <p className="mt-0.5 text-[11.5px] dim">
            {best.institution_name} · {best.type}
            {best.due_date ? ` · vence ${new Date(best.due_date + "T12:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}` : ""}
          </p>
          <p className="mono tnum mt-2 text-[20px] font-semibold text-up">{best.yield_percent}%</p>
          {best.yield_label && <p className="mono text-[10px] text-fg-dim">{best.yield_label}</p>}
          <p className="mt-1.5 text-[11px] dim">
            rendimento {formatBRL(best.yield_amount, { signed: true })} · líquido {formatBRL(String(Number(best.net_amount ?? best.gross_amount)))}
          </p>
          <p className="mt-2 text-[10.5px] dim">atualizado {new Date(best.updated_at).toLocaleString("pt-BR")}</p>
        </Card>
      )}
    </>
  );

  const center = (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card title="Posições" right={<span className="text-[11px] dim">{loading ? "carregando…" : `${items.length} ativos`}</span>}>
        {items.length === 0 && !loading ? (
          <Empty text="Nenhum investimento importado ainda. Conecte uma conta Open Finance." />
        ) : (
          <ul>
            {items.map((i) => {
              const known = hasCost(i);
              const y = Number(i.yield_amount);
              const positive = y >= 0;
              return (
                <li key={i.id} className="row px-1">
                  <span className={cn("flex size-6 items-center justify-center rounded-md bg-muted", !known ? "text-fg-dim" : positive ? "text-up" : "text-down")}>
                    {!known ? <ChartLine className="size-3.5" /> : positive ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {i.ticker ? <span className="mono mr-2 text-[10px] text-fg-dim">{i.ticker}</span> : null}
                      {i.name}
                    </span>
                    <span className="block truncate text-[11px] dim">
                      {i.institution_name} · {i.type}
                      {known ? ` · investido ${formatBRL(i.invested_amount)}` : ` · ${formatBRL(i.gross_amount)} em posição`}
                      {i.due_date ? ` · vence ${new Date(i.due_date + "T12:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}` : ""}
                    </span>
                  </span>
                  <span className="min-w-0 text-right">
                    <span className={cn("mono block text-[13px] font-semibold", known && positive ? "text-up" : known ? "text-down" : "text-fg-dim")}>
                      {known ? formatBRL(String(y), { signed: true }) : "—"}
                    </span>
                    <span className="mono block text-[10.5px] dim">
                      {known ? (i.yield_label ? i.yield_label : `${Number(i.yield_percent).toFixed(2)}% do custo`) : "custo não informado"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );

  const right = (
    <Card title="Rendimentos recentes" right={<ChartLine className="size-3.5 text-fg-dim" />}>
      {winners.length === 0 ? (
        <Empty text="Sem rendimentos positivos ainda." />
      ) : (
        <ul>
          {winners.slice(0, 7).map((i) => (
            <li key={"y-" + i.id} className="ev" style={{ gridTemplateColumns: "64px 1fr auto" }}>
              <time>{new Date(i.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</time>
              <p className="min-w-0">
                <span className="block truncate text-[12px]">{i.name}</span>
                <span className="block text-[10.5px] dim">{i.institution_name}</span>
              </p>
              <span className="tnum text-[12px] text-up">{formatBRL(i.yield_amount, { signed: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return <Cockpit left={left} center={center} right={right} />;
}
