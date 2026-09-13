// Pré-visualizações ilustrativas das telas reais do produto -- não são
// screenshots, são recortes construídos com os mesmos tokens visuais
// (Cartao, Selo, ValorMonetario) para não mentir sobre como o app
// parece. Nenhum número aqui é estatística real de uso: são dados de
// exemplo, óbvios como tal pelo contexto ("Nubank", "XP").
import { Cartao } from "@/components/Cartao";
import { Selo } from "@/components/Selo";
import { ValorMonetario } from "@/components/ValorMonetario";

export function MockContas() {
  return (
    <Cartao className="w-full max-w-sm">
      <div className="space-y-3">
        {[
          { nome: "Nubank", tipo: "Conta corrente", valor: 3452.8 },
          { nome: "XP", tipo: "Investimentos", valor: 18230.4 },
        ].map((c) => (
          <div
            key={c.nome}
            className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3"
          >
            <div>
              <p className="font-medium">{c.nome}</p>
              <p className="text-xs text-muted-foreground">{c.tipo}</p>
            </div>
            <ValorMonetario valor={c.valor} tamanho="sm" />
          </div>
        ))}
        <button className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground">
          + Nova conta
        </button>
      </div>
    </Cartao>
  );
}

export function MockTransacional() {
  const linhas = [
    { desc: "Mercado", categoria: "Alimentação", valor: -184.3 },
    { desc: "Salário", categoria: "Renda", valor: 6200 },
    { desc: "Academia", categoria: "Saúde", valor: -139.9 },
  ];
  return (
    <Cartao className="w-full max-w-sm" titulo="Últimos lançamentos">
      <div className="space-y-2.5">
        {linhas.map((l) => (
          <div key={l.desc} className="flex items-center justify-between text-sm">
            <div>
              <p className="font-medium">{l.desc}</p>
              <p className="text-xs text-muted-foreground">{l.categoria}</p>
            </div>
            <ValorMonetario valor={l.valor} tamanho="sm" tom="auto" />
          </div>
        ))}
      </div>
    </Cartao>
  );
}

export function MockInvestimentos() {
  const ativos = [
    { ticker: "PETR4", valor: 12450.0, variacao: 4.8 },
    { ticker: "MXRF11", valor: 6320.0, variacao: 1.2 },
  ];
  return (
    <Cartao className="w-full max-w-sm" titulo="Carteira">
      <div className="space-y-3">
        {ativos.map((a) => (
          <div key={a.ticker} className="flex items-center justify-between">
            <span className="font-mono text-sm font-medium">{a.ticker}</span>
            <div className="text-right">
              <ValorMonetario valor={a.valor} tamanho="sm" />
              <Selo tom="positivo">+{a.variacao}%</Selo>
            </div>
          </div>
        ))}
      </div>
    </Cartao>
  );
}

export function MockDashboard() {
  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-3">
      <Cartao className="col-span-2" titulo="Saldo consolidado">
        <ValorMonetario valor={24012.4} tamanho="md" />
      </Cartao>
      <Cartao titulo="Gastos">
        <div className="flex h-16 items-end gap-1.5">
          {[40, 65, 30, 80, 55].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t bg-primary/70"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </Cartao>
      <Cartao titulo="Patrimônio">
        <svg viewBox="0 0 100 40" className="h-16 w-full text-positivo">
          <polyline
            points="0,32 20,28 40,22 60,18 80,10 100,4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </Cartao>
    </div>
  );
}
