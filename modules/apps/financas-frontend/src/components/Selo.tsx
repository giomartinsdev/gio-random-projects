import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TomSelo = "neutro" | "positivo" | "negativo" | "alerta";

const tons: Record<TomSelo, string> = {
  neutro: "bg-secondary text-secondary-foreground",
  positivo: "bg-positivo/15 text-positivo",
  negativo: "bg-destructive/15 text-destructive",
  alerta: "bg-primary/15 text-primary",
};

// Selo pequeno para status (ativa/arquivada, desatualizada, etc.) --
// usado em vez de badges com ícone de estoque.
export function Selo({ tom = "neutro", children }: { tom?: TomSelo; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tons[tom],
      )}
    >
      {children}
    </span>
  );
}
