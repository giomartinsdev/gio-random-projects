import { tokens } from "@/lib/theme";

interface Fatia {
  categoria: string;
  valor: number;
}

// SVG handrolled -- sem lib de gráfico, restyle nenhum a fazer: já nasce
// nos tokens de tema. Um donut simples via stroke-dasharray por fatia.
export function Pizza({ dados }: { dados: unknown }) {
  const fatias = (dados as Fatia[]).filter((f) => f.valor > 0);
  const total = fatias.reduce((acc, f) => acc + f.valor, 0);

  if (total === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Sem gastos no período.
      </p>
    );
  }

  const raio = 40;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;

  return (
    <div className="flex h-full items-center gap-6">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={raio} fill="none" stroke={tokens.chart.grade} strokeWidth="16" />
        {fatias.map((f, i) => {
          const fracao = f.valor / total;
          const comprimento = fracao * circunferencia;
          const dasharray = `${comprimento} ${circunferencia - comprimento}`;
          const dashoffset = -acumulado;
          acumulado += comprimento;
          return (
            <circle
              key={f.categoria}
              cx="50"
              cy="50"
              r={raio}
              fill="none"
              stroke={tokens.chart.categorias[i % tokens.chart.categorias.length]}
              strokeWidth="16"
              strokeDasharray={dasharray}
              strokeDashoffset={dashoffset}
            />
          );
        })}
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
        {fatias
          .sort((a, b) => b.valor - a.valor)
          .map((f, i) => (
            <li key={f.categoria} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: tokens.chart.categorias[i % tokens.chart.categorias.length] }}
              />
              <span className="truncate text-muted-foreground">{f.categoria}</span>
              <span className="ml-auto shrink-0 font-mono tabular">
                {((f.valor / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
