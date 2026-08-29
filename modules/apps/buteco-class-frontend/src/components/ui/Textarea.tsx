import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

const Textarea = forwardRef<HTMLTextAreaElement, Props>(({ invalid = false, className, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "bg-buteco-brown-light/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-buteco-cream",
      "placeholder:text-buteco-cream/35 transition-colors focus:outline-none focus:border-buteco-amber/70 focus:bg-buteco-brown-light/60",
      "disabled:opacity-50",
      invalid && "border-red-400/60 focus:border-red-400",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export default Textarea;