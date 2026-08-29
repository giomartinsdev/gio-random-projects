import type { ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn.js";

type Tone = "info" | "error";

// Inline contextual message -- the app has no toaster on purpose:
// errors and saves render where the action happened.
export function Banner({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const Icon = tone === "error" ? TriangleAlert : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3.5 text-sm",
        tone === "error" ? "border-red-400/30 bg-red-500/10 text-red-100" : "border-buteco-amber/25 bg-buteco-amber/10 text-buteco-cream",
        className,
      )}
    >
      <Icon size={15} className="shrink-0 mt-0.5 opacity-80" />
      <div className="min-w-0">
        {title && <p className="font-heading font-semibold text-[0.8rem] mb-0.5">{title}</p>}
        {children && <div className="opacity-90 text-[0.8rem] leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export default Banner;