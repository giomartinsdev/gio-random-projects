import { useEffect, useRef } from "react";
import Button from "./Button.js";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// In-app replacement for window.confirm() -- the native dialog is
// unstyled (breaks the whole point of a themed app), can't be
// keyboard/focus-managed the way we want, and blocks the entire tab
// (including any other async work in flight) until dismissed.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Confirm is the action the read-then-decide flow points at.
    const focusTimer = window.setTimeout(() => confirmRef.current?.focus(), 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // Tab trap: cycle inside the panel instead of leaking focus to
      // the page behind the overlay.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in-up"
      style={{ animationDuration: "150ms" }}
      role="presentation"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="glass-card bg-buteco-brown-dark w-full max-w-sm p-6 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-heading font-bold text-lg text-buteco-cream mb-2">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="text-buteco-cream/70 text-sm mb-6">
          {description}
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} size="sm" className="px-4 py-2">
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy} size="sm" className="px-4 py-2">
            {busy ? "Aguarde…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}