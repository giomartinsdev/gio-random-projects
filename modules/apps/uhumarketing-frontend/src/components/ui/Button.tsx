import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

// Button do design system do prospecta: raio 10, Inter 15/600. `sm` existe
// porque as barras de ação de tabela do uhumarketing são mais densas.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-[#1D4ED8] active:bg-[#1E40AF]",
  secondary: "bg-bg text-fg border border-line hover:bg-elevated",
  ghost: "text-fg-2 hover:bg-elevated hover:text-fg",
  danger: "bg-danger-soft text-danger border border-danger/40 hover:bg-danger/20",
};

const PADDING: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-[13px]",
  md: "px-5 py-3 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm font-semibold leading-none transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        PADDING[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/** Botão só de ícone, quadrado — usado nas barras de ferramenta. */
export function IconButton({
  label,
  children,
  className,
  ...props
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-2 transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
