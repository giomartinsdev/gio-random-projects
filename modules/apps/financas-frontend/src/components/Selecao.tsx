import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SelecaoProps extends SelectHTMLAttributes<HTMLSelectElement> {
  rotulo?: string;
}

export const Selecao = forwardRef<HTMLSelectElement, SelecaoProps>(function Selecao(
  { rotulo, className, id, children, ...rest },
  ref,
) {
  const selectId = id ?? rest.name;
  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={selectId}>
      {rotulo && <span className="font-medium text-muted-foreground">{rotulo}</span>}
      <select
        ref={ref}
        id={selectId}
        className={cn(
          "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
});
