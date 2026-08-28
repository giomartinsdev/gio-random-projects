import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FPS_OPTIONS, QUALITY_OPTIONS, type DisplaySurface, type Fps, type Quality, type Source } from "@/lib/useRoom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ShareChoice = { source: Source; quality: Quality; fps: Fps; surface: DisplaySurface };

// The picker's first row is one flat choice: three screen surfaces plus
// the camera. The labels for the screen surfaces come from useRoom's
// SURFACE_OPTIONS so the two stay in sync; "Câmera" is dialog-only.
type SurfaceOrCamera = DisplaySurface | "camera";

const SOURCE_OPTIONS: { value: SurfaceOrCamera; label: string }[] = [
  { value: "monitor", label: "Tela inteira" },
  { value: "window", label: "Janela" },
  { value: "browser", label: "Aba" },
  { value: "camera", label: "Câmera" },
];

function sourceKeyOf(c: ShareChoice): SurfaceOrCamera {
  return c.source === "camera" ? "camera" : c.surface;
}

function applySourceKey(c: ShareChoice, key: SurfaceOrCamera): ShareChoice {
  if (key === "camera") return { ...c, source: "camera" };
  return { ...c, source: "screen", surface: key };
}

// The share panel: one place to pick what to share and how, opened from
// the header's "Compartilhar" button before streaming and from it as
// "Qualidade" while a share is live. Hand-rolled modal -- the app has no
// dialog primitive, and this follows the same AnimatePresence pattern the
// knock banners use.
export function ShareDialog({
  open,
  canScreenShare,
  sharing,
  initial,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  // Whether getDisplayMedia exists in this browser -- smartphones can
  // only share a camera, so they never see the surface row.
  canScreenShare: boolean;
  // True while a share is live: then this retunes it (reductions apply
  // immediately; increases need the next share) instead of starting one.
  sharing: boolean;
  initial: ShareChoice;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice: ShareChoice) => void;
}) {
  const [choice, setChoice] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);
  // Re-seed the draft only when the dialog OPENS -- not on every render
  // (that would fight the person editing it), and only from the values
  // that were live at open time.
  const lastOpenRef = useRef(false);

  useEffect(() => {
    if (open && !lastOpenRef.current) setChoice(initial);
    lastOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is deliberately read only while `open` flips
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    // Body scroll behind the sheet gets in the way on a phone.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          // Between bottom sheet (phone) and centered card (desktop).
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-2xl border bg-card p-4 text-card-foreground shadow-lg outline-none sm:rounded-2xl"
          >
            <h2 id="share-dialog-title" className="text-base font-semibold">
              {sharing ? "Qualidade da transmissão" : "Compartilhar"}
            </h2>

            {!sharing && canScreenShare && (
              // Which source to capture. Phones without getDisplayMedia
              // only have the camera, so the row would be one option --
              // noise, and it stays hidden.
              <div className="mt-3">
                <SegmentRow label="O que compartilhar" ariaLabel="Fonte" options={SOURCE_OPTIONS} value={sourceKeyOf(choice)} onChange={(key) => setChoice(applySourceKey(choice, key))} />
              </div>
            )}

            <div className="mt-3 space-y-2">
              <SegmentRow ariaLabel="Qualidade" label="Qualidade" options={QUALITY_OPTIONS} value={choice.quality} onChange={(quality) => setChoice((c) => ({ ...c, quality }))} />
              <SegmentRow ariaLabel="Quadros por segundo" label="FPS" options={FPS_OPTIONS} value={choice.fps} onChange={(fps) => setChoice((c) => ({ ...c, fps }))} />
            </div>

            {sharing && (
              <p className="mt-3 text-xs text-muted-foreground">
                Reduções de qualidade/FPS aplicam na hora, sem recapturar ou cortar a transmissão. Aumentos (ou
                "Original") valem a partir do próximo compartilhamento.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={() => onConfirm(choice)}>
                {sharing ? "Aplicar" : "Compartilhar"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// One flat row of segmented options -- aria-pressed buttons rendered from
// useRoom's exported option tables. Raw buttons rather than the Button
// component: this is a picker, not an action.
export function Segments<T extends string | number>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex overflow-hidden rounded-md border">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 px-1 py-1.5 text-xs font-medium transition-colors sm:text-sm",
            o.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SegmentRow<T extends string | number>({
  ariaLabel,
  label,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Segments ariaLabel={ariaLabel} options={options} value={value} onChange={onChange} />
    </label>
  );
}