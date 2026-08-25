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
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="glass-card glow-amber bg-buteco-brown-dark w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-heading font-bold text-lg text-buteco-cream mb-2">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="text-buteco-cream/70 text-sm mb-6">
          {description}
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={danger ? "primary" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            className={danger ? "!bg-red-500 hover:!bg-red-400 !shadow-red-500/20" : ""}
          >
            {busy ? "Aguarde…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
