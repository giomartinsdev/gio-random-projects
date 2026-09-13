import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variante = "primaria" | "secundaria" | "fantasma" | "perigo" | "pill";
type Tamanho = "sm" | "md" | "lg";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
}

const variantes: Record<Variante, string> = {
  primaria: "rounded-md bg-primary text-primary-foreground hover:bg-primary/90",
  secundaria: "rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80",
  fantasma: "rounded-md bg-transparent text-foreground hover:bg-secondary",
  perigo:
    "rounded-md bg-transparent text-destructive border border-destructive/40 hover:bg-destructive/10",
  // Pílula de marketing (hero, CTAs de landing) -- inspirada no botão
  // "Get Started" da orchid.ai, com o acento terracota como assinatura
  // própria em vez do navy deles.
  pill: "rounded-full bg-foreground text-background hover:bg-foreground/85 shadow-lift",
};

const tamanhos: Record<Tamanho, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = "primaria", tamanho = "md", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      {...rest}
    />
  );
});
