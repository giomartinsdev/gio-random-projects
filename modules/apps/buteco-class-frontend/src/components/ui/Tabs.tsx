import { cn } from "../../lib/cn.js";

export type TabDef<T extends string> = { id: T; label: string; count?: number };

// Page-level tablist (the profile page's Posts | Curtidas | Aulas).
// Arrow-key movement copied from room/PanelTabs; NOT that component --
// it's styled for the mobile aside's narrow strip, this one is page
// furniture with room for a count badge.
export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  className,
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(tabs[(idx + 1) % tabs.length].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    }
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex gap-1 glass-card p-1 w-fit", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-heading font-semibold text-sm cursor-pointer transition-colors",
            active === t.id ? "bg-buteco-amber/15 text-buteco-amber" : "text-buteco-cream/60 hover:text-buteco-cream",
          )}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span
              className={cn(
                "text-[0.68rem] font-mono px-1.5 rounded-md",
                active === t.id ? "bg-buteco-amber/20 text-buteco-amber" : "bg-white/5 text-buteco-cream/50",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}