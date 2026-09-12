import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CampoTextoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  erro?: string;
}

export const CampoTexto = forwardRef<HTMLInputElement, CampoTextoProps>(
  function CampoTexto({ rotulo, erro, className, id, ...rest }, ref) {
    const inputId = id ?? rest.name;
    return (
      <label className="flex flex-col gap-1.5 text-sm" htmlFor={inputId}>
        {rotulo && <span className="font-medium text-muted-foreground">{rotulo}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            erro && "border-destructive focus-visible:ring-destructive",
            className,
          )}
          {...rest}
        />
        {erro && <span className="text-xs text-destructive">{erro}</span>}
      </label>
    );
  },
);
