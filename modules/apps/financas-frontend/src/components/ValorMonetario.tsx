import { cn } from "@/lib/utils";

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export type TomValor = "neutro" | "auto" | "positivo" | "negativo";

interface ValorMonetarioProps {
  valor: number;
  tamanho?: "sm" | "md" | "lg" | "xl";
  tom?: TomValor;
  className?: string;
  /** Esconde o sinal (usado quando o próprio rótulo já diz "gasto"/"ganho"). */
  semSinal?: boolean;
}

const tamanhos: Record<NonNullable<ValorMonetarioProps["tamanho"]>, string> = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-6xl",
};

// O número é sempre o elemento mais forte da tela -- fonte display
// (Fraunces), peso alto, tabular para colunas alinharem. Texto de apoio
// (rótulo, período) nunca usa esse componente.
export function ValorMonetario({
  valor,
  tamanho = "md",
  tom = "neutro",
  className,
  semSinal = false,
}: ValorMonetarioProps) {
  const efetivo = tom === "auto" ? (valor >= 0 ? "positivo" : "negativo") : tom;
  const cor =
    efetivo === "positivo"
      ? "text-positivo"
      : efetivo === "negativo"
        ? "text-destructive"
        : "text-foreground";

  const exibido = semSinal ? Math.abs(valor) : valor;

  // Última linha de defesa contra NaN atravessar a tela: qualquer
  // valor não-finite (um dado fora do contrato, um campo faltando)
  // rende um traço em vez de "R$ NaN". O traço honesto vale mais que
  // um zero mentiroso -- se apareceu, tem bug de fonte atrás.
  if (!Number.isFinite(exibido)) {
    return (
      <span
        className={cn(
          "font-display font-semibold tabular tracking-tight",
          tamanhos[tamanho],
          "text-muted-foreground",
          className,
        )}
      >
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        "font-display font-semibold tabular tracking-tight",
        tamanhos[tamanho],
        cor,
        className,
      )}
    >
      {formatador.format(exibido)}
    </span>
  );
}
