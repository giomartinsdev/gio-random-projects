import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Primitivos da landing pública, direto do frame C465f7 do poc.pen (tema claro).
// O dot grid é o padrão de pontos de 22px; os "orbs" são círculos com gradiente
// radial (azul #2563EB / azul claro #7DA6FF / branco no CTA final).

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

export type LandingButtonVariant = "accent" | "dark" | "outline" | "outlineOnAccent";

const BTN: Record<LandingButtonVariant, string> = {
  accent: "bg-accent text-white hover:bg-[#1D4ED8] active:bg-[#1E40AF]",
  dark: "bg-lp-dark text-white hover:bg-[#2A2A2A]",
  outline: "bg-lp-bg text-lp-ink border border-lp-line hover:bg-lp-surface",
  outlineOnAccent: "text-white border border-white/70 hover:bg-white/10",
};

export function LandingButton({
  variant = "accent",
  href,
  children,
  className,
  size = "md",
  ...props
}: {
  variant?: LandingButtonVariant;
  href: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const pad = size === "sm" ? "px-[18px] py-[10px] text-[14px]" : size === "lg" ? "px-[26px] py-[16px] text-[16px]" : "px-[24px] py-[14px] text-[16px]";
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold leading-none transition-colors",
        pad,
        BTN[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[13px] font-semibold uppercase tracking-[0.14em] text-accent", className)}>{children}</span>;
}
