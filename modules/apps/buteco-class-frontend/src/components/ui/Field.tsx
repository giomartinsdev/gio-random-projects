import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Counter = {
  value: number;
  // No max = free-form input; the counter just numbers the content.
  max?: number;
  // Soft warning threshold (amber), distinct from a hard max.
  warnAt?: number;
};

type Props = {
  label?: string;
  labelFor?: string;
  hint?: string;
  counter?: Counter;
  error?: string;
  className?: string;
  children: ReactNode;
};

// Form row: mono uppercase label (when given), the control, then meta
// underneath -- errors first, otherwise the hint. Callers put
// labelFor on their control themselves (function composition over
// cloning arbitrary children).
export function Field({ label, labelFor, hint, counter, error, className, children }: Props) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={labelFor} className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/50">{label}</span>
          {counter && <FieldCounter {...counter} />}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-red-300">{error}</p> : hint ? <p className="text-xs text-buteco-cream/40">{hint}</p> : null}
    </div>
  );
}

function FieldCounter({ value, max, warnAt }: Counter) {
  const warn = warnAt !== undefined && value > warnAt;
  return (
    <span className={cn("font-mono text-[0.65rem] tabular-nums", warn ? "text-buteco-amber" : "text-buteco-cream/40")}>
      {max !== undefined ? `${value}/${max}` : value}
    </span>
  );
}

export default Field;