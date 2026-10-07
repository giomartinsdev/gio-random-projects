import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-sm border border-line bg-bg px-3.5 py-2.5 text-[14px] text-fg placeholder:text-fg-3 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring";

// Input do poc.pen §V1: bg escuro, borda line, raio 10. Opcionalmente com ícone
// à esquerda (o "Search" da topbar).
export function Input({
  icon,
  className,
  wrapClassName,
  ...props
}: { icon?: ReactNode; wrapClassName?: string } & InputHTMLAttributes<HTMLInputElement>) {
  if (icon) {
    return (
      <div className={cn("relative flex items-center", wrapClassName)}>
        <span className="pointer-events-none absolute left-3.5 text-fg-3">{icon}</span>
        <input className={cn(FIELD, "pl-10", className)} {...props} />
      </div>
    );
  }
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, "min-h-[120px] resize-y leading-relaxed", className)} {...props} />;
}
