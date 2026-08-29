import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";
import { Spinner } from "./Spinner.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-buteco-amber text-buteco-navy hover:bg-buteco-amber-light shadow-lg shadow-buteco-amber/25",
  secondary:
    "border border-buteco-amber/30 bg-buteco-brown-light/40 text-buteco-cream hover:border-buteco-amber/60 hover:bg-buteco-stout/50",
  ghost: "text-buteco-cream/70 hover:text-buteco-cream hover:bg-white/5",
  danger: "bg-red-500/90 text-buteco-cream hover:bg-red-500 shadow-lg shadow-red-900/30",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5",
  lg: "text-[0.95rem] px-6 py-3",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-xl font-heading font-semibold transition-all duration-200 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none";

// For elements that merely LOOK like a button -- most importantly a
// react-router <Link>, where a real <button> nested inside it would be
// invalid (interactive-inside-interactive).
export function buttonClasses(options: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}) {
  return cn(baseClasses, variantClasses[options.variant ?? "primary"], sizeClasses[options.size ?? "md"], options.block && "w-full");
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Shows a spinner and blocks interaction; label stays in place so
  // width doesn't jump.
  loading?: boolean;
  block?: boolean;
};

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", size = "md", loading = false, block = false, className, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonClasses({ variant, size }), block && "w-full", className)}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export default Button;