import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

// "Nothing here yet" block -- icon, headline, supporting line and an
// optional call to action. Tint with tone="error" for failure states
// (or use ErrorState, which wraps this).
export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-6", className)}>
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-buteco-amber/80 grid place-items-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="font-heading font-semibold text-lg text-buteco-cream">{title}</h3>
      {description && <p className="text-sm text-buteco-cream/50 max-w-sm mt-1.5">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;