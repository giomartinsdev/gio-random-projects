import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variantClasses: Record<Variant, string> = {
  primary: "bg-buteco-amber text-buteco-navy hover:bg-buteco-amber-light shadow-lg shadow-buteco-amber/20",
  secondary:
    "bg-buteco-brown-light text-buteco-cream border-2 border-buteco-amber/40 hover:border-buteco-amber hover:bg-buteco-brown",
  ghost: "text-buteco-cream/70 hover:text-buteco-amber hover:bg-white/5",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-heading font-semibold transition-all cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100";

const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button ref={ref} className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props} />
  ),
);
Button.displayName = "Button";

export default Button;
