import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

const sizeClasses = {
  sm: "px-2.5 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2.5 text-sm rounded-xl",
} as const;

// `size` is the HTML attribute's name -- redefining it as our scale
// collides, so drop it from the passthrough.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: keyof typeof sizeClasses;
  // Red border + aria-invalid for the field wrapper to wire up.
  invalid?: boolean;
};

const Input = forwardRef<HTMLInputElement, Props>(({ size = "md", invalid = false, className, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "bg-buteco-brown-light/40 border border-white/10 text-buteco-cream placeholder:text-buteco-cream/35",
      "transition-colors focus:outline-none focus:border-buteco-amber/70 focus:bg-buteco-brown-light/60 disabled:opacity-50",
      invalid && "border-red-400/60 focus:border-red-400",
      sizeClasses[size],
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export default Input;