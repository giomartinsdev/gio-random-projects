import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost";

// Button/Primary · Secondary · Ghost do poc.pen §V1: raio 10, label Inter 15/600,
// padding [12,20] (ghost [12,16]). Primary = acento sólido (ação).
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-[#1D4ED8] active:bg-[#1E40AF]",
  secondary: "bg-bg text-fg border border-line hover:bg-elevated",
  ghost: "text-fg-2 hover:bg-elevated hover:text-fg",
};

const PADDING: Record<ButtonVariant, string> = {
  primary: "px-5 py-3",
  secondary: "px-5 py-3",
  ghost: "px-4 py-3",
};

export function Button({
  variant = "primary",
  icon,
  children,
  className,
  ...props
}: {
  variant?: ButtonVariant;
  icon?: ReactNode;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm text-[15px] font-semibold leading-none transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        PADDING[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
