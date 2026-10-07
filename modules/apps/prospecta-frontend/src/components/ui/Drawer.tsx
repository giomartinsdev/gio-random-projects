import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Drawer lateral (Detalhe do lead no poc.pen §V1): coluna de 400px, superfície
// + borda à esquerda. No layout desktop fica embutido no Main; em telas
// estreitas sobrepõe com scrim.
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <aside className="hidden w-[400px] shrink-0 flex-col border-l border-line bg-surface lg:flex">
        <DrawerHeader title={title} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
        {footer && <div className="flex gap-2.5 border-t border-line p-5">{footer}</div>}
      </aside>
      <div className="fixed inset-0 z-40 lg:hidden">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <aside className={cn("absolute right-0 top-0 flex h-full w-[400px] max-w-[90vw] flex-col border-l border-line bg-surface shadow-drawer")}>
          <DrawerHeader title={title} onClose={onClose} />
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
          {footer && <div className="flex gap-2.5 border-t border-line p-5">{footer}</div>}
        </aside>
      </div>
    </>
  );
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <button onClick={onClose} className="text-fg-3 transition-colors hover:text-fg" aria-label="Fechar">
        <X size={18} />
      </button>
    </div>
  );
}
