import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variantClasses: Record<Variant, string> = {
  primary: "bg-buteco-amber text-buteco-navy hover:bg-buteco-amber-light shadow-lg shadow-buteco-amber/20",
  secondary:
    "bg-buteco-brown-light text-buteco-cream border-2 border-buteco-amber/40 hover:border-buteco-amber hover:bg-buteco-brown",
  ghost: "text-buteco-cream/70 hover:text-buteco-amber hover:bg-white/5",
};

export default function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-heading font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
