import { tokens } from "@/lib/theme";
import { formatarDataCalendario } from "@/lib/datas";

interface Ponto {
  data: string;
  valor: number;
}

export function Linha({ dados }: { dados: unknown }) {
  const pontos = dados as Ponto[];
  if (pontos.length < 2) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Dados insuficientes para o período.
      </p>
    );
  }

  const largura = 400;
  const altura = 140;
  const valores = pontos.map((p) => p.valor);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 0);
  const amplitude = max - min || 1;

  const coords = pontos.map((p, i) => {
    const x = (i / (pontos.length - 1)) * largura;
    const y = altura - ((p.valor - min) / amplitude) * altura;
    return [x, y] as const;
  });

  const linha = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${altura} ${linha} ${largura},${altura}`;
  const ultimo = pontos[pontos.length - 1].valor;
  const primeiro = pontos[0].valor;
  const cor = ultimo >= primeiro ? tokens.chart.positivo : tokens.chart.negativo;

  return (
    <div className="flex h-full flex-col gap-2">
      <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" className="h-full w-full">
        <polygon points={area} fill={cor} opacity="0.12" />
        <polyline points={linha} fill="none" stroke={cor} strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatarDataCalendario(pontos[0].data)}</span>
        <span>{formatarDataCalendario(pontos[pontos.length - 1].data)}</span>
      </div>
    </div>
  );
}
