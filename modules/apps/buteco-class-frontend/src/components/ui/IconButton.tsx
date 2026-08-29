import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  // Required -- an icon-only control is invisible to screen readers
  // otherwise. Rendered as the sr-only accessible name.
  label: string;
  size?: "sm" | "md";
  // Highlighted "this tool is on" state (room tool rails, editors).
  active?: boolean;
  tone?: "plain" | "danger";
  children: ReactNode;
};

const sizeClasses = { sm: "w-8 h-8", md: "w-9 h-9" } as const;

const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, size = "md", active = false, tone = "plain", className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        "inline-grid place-items-center rounded-lg text-buteco-cream/70 transition-colors cursor-pointer",
        "hover:text-buteco-cream hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none",
        tone === "danger" && "hover:text-red-300 hover:bg-red-500/10",
        active && "text-buteco-amber bg-buteco-amber/10 hover:text-buteco-amber",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export default IconButton;