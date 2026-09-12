import { ValorMonetario } from "@/components/ValorMonetario";

export function Indicador({ dados }: { dados: unknown }) {
  const d = dados as { total: number; contas: number };
  return (
    <div className="flex h-full flex-col items-start justify-center gap-1">
      <ValorMonetario valor={d.total} tamanho="xl" tom="auto" />
      <span className="text-xs text-muted-foreground">
        somado de {d.contas} conta{d.contas === 1 ? "" : "s"} ativa{d.contas === 1 ? "" : "s"}
      </span>
    </div>
  );
}
