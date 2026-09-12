import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CartaoProps extends HTMLAttributes<HTMLDivElement> {
  titulo?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
}

// Sem sombra suave genérica de SaaS -- borda de 1px nítida (shadow-crisp)
// é a assinatura visual dos cartões, mais perto de um extrato impresso
// que de um "card" flutuante.
export function Cartao({ titulo, acao, children, className, ...rest }: CartaoProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-crisp",
        className,
      )}
      {...rest}
    >
      {(titulo || acao) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          {titulo && (
            <h3 className="text-sm font-medium text-muted-foreground">{titulo}</h3>
          )}
          {acao}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
