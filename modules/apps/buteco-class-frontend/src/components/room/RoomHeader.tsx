import type { ReactNode } from "react";

// Title + status on the left, room-level actions (Encerrar) on the
// right. Long titles truncate instead of pushing the actions around;
// everything wraps on narrow screens.
export function RoomHeader({ title, status, actions }: { title: string; status: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-x-3 gap-y-2 shrink-0">
      <div className="min-w-0">
        <h1 className="font-heading font-bold text-2xl text-buteco-cream truncate">{title}</h1>
        <div className="mt-1.5">{status}</div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}