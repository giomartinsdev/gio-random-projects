import { tokens } from "@/lib/theme";

interface Item {
  categoria: string;
  valor: number;
}

export function Barra({ dados }: { dados: unknown }) {
  const itens = (dados as Item[]).slice(0, 8);
  const max = Math.max(...itens.map((i) => i.valor), 1);

  if (itens.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Sem dados para exibir.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {itens
        .sort((a, b) => b.valor - a.valor)
        .map((item) => (
          <div key={item.categoria} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 truncate text-muted-foreground">{item.categoria}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(item.valor / max) * 100}%`,
                  background: tokens.chart.linha,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono tabular">
              {item.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
            </span>
          </div>
        ))}
    </div>
  );
}
