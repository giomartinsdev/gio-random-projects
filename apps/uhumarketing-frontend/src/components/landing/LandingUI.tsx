import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Primitivos da landing pública — os mesmos do prospecta (dot grid, orbs,
// botões da paleta clara), reaplicados ao produto de marketing.

export function DotGrid({ className, size = 22, opacity = 1 }: { className?: string; size?: number; opacity?: number }) {
  return (
    <span
      aria-hidden
      className={cn("dot-grid pointer-events-none absolute inset-0", className)}
      style={{ backgroundSize: `${size}px ${size}px`, opacity }}
    />
  );
}

export function OrbGlow({
  className,
  color = "#2563EB",
  opacity = 0.4,
}: {
  className?: string;
  color?: string;
  opacity?: number;
}) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute rounded-full", className)}
      style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)`, opacity }}
    />
  );
}

export type LandingButtonVariant = "accent" | "dark" | "outline";

const BTN: Record<LandingButtonVariant, string> = {
  accent: "bg-accent text-white hover:bg-[#1D4ED8]",
  dark: "bg-lp-dark text-white hover:bg-lp-dark-2",
  outline: "border border-lp-line bg-white text-lp-ink hover:bg-lp-surface",
};

export function LandingButton({
  variant = "accent",
  className,
  children,
  ...props
}: { variant?: LandingButtonVariant; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm px-5 py-3 text-[15px] font-semibold leading-none transition-colors",
        BTN[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

/** Etiqueta miúda em mono sobre fundo claro. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-lp-line bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-lp-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
