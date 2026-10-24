import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Drawer lateral (Detalhe no prospecta): 400px, superfície + borda esquerda;
// embutido no layout no desktop, sobreposto com scrim em telas estreitas.
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <>
      <aside
        className="hidden shrink-0 flex-col border-l border-line bg-surface lg:flex"
        style={{ width }}
      >
        <DrawerHeader title={title} subtitle={subtitle} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
        {footer && <div className="flex gap-2.5 border-t border-line p-5">{footer}</div>}
      </aside>
      <div className="fixed inset-0 z-40 lg:hidden">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <aside
          className={cn(
            "absolute right-0 top-0 flex h-full max-w-[92vw] flex-col border-l border-line bg-surface shadow-drawer",
          )}
          style={{ width }}
        >
          <DrawerHeader title={title} subtitle={subtitle} onClose={onClose} />
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
          {footer && <div className="flex gap-2.5 border-t border-line p-5">{footer}</div>}
        </aside>
      </div>
    </>
  );
}

function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="truncate text-[15px] font-semibold text-fg">{title}</h3>
        {subtitle && <span className="truncate text-[12px] text-fg-3">{subtitle}</span>}
      </div>
      <button onClick={onClose} className="shrink-0 text-fg-3 transition-colors hover:text-fg" aria-label="Fechar">
        <X size={18} />
      </button>
    </div>
  );
}

/** Modal centralizado, para formulários curtos (novo segmento, nova campanha). */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-md border border-line bg-surface shadow-drawer"
        style={{ maxWidth: width }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-[16px] font-semibold text-fg">{title}</h3>
            {subtitle && <span className="text-[12px] text-fg-3">{subtitle}</span>}
          </div>
          <button onClick={onClose} className="shrink-0 text-fg-3 transition-colors hover:text-fg" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2.5 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
