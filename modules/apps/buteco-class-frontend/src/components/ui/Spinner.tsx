import { cn } from "../../lib/cn.js";

const sizeClasses = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-[3px]", lg: "h-8 w-8 border-4" } as const;

// Border-based spinner -- no SVG churn, inherits color from `current`.
export function Spinner({ size = "md", className }: { size?: keyof typeof sizeClasses; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn("inline-block shrink-0 rounded-full border-buteco-cream/25 border-t-buteco-amber animate-spin", sizeClasses[size], className)}
    />
  );
}

export default Spinner;