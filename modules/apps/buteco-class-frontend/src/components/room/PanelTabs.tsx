import { cn } from "../../lib/cn.js";

type Tab<T extends string> = { id: T; label: string };

// Segmented tablist for the mobile aside (Chat | Bloco) -- arrow keys
// move selection per the tabs pattern. Desktop rooms render their
// panels side by side and never mount this.
export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  className,
}: {
  tabs: Tab<T>[];
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
            "px-3.5 py-1.5 rounded-lg font-heading font-semibold text-xs cursor-pointer transition-colors",
            active === t.id ? "bg-buteco-amber/15 text-buteco-amber" : "text-buteco-cream/60 hover:text-buteco-cream",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}