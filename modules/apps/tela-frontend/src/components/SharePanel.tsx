import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { FPS_OPTIONS, QUALITY_OPTIONS, type DisplaySurface, type Fps, type Quality, type Source } from "@/lib/useRoom";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { loadingIcon } from "@/lib/lottie-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ShareChoice = { source: Source; quality: Quality; fps: Fps; surface: DisplaySurface };

// The picker's first row is one flat choice: three screen surfaces plus
// the camera. The labels for the screen surfaces come from useRoom's
// SURFACE_OPTIONS so the two stay in sync; "Câmera" is panel-only.
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

// The share panel: a drawer over the room's right edge, opened from the
// header's "Compartilhar" button before streaming and from it as
// "Qualidade" while a share is live. Deliberately not a modal -- the room
// stays visible and the header stays clickable, so this is a panel, not a
// dialog. It closes on its X, on Escape, on a click anywhere else in the
// room, and on its own the moment a share starts successfully.
export function SharePanel({
  open,
  canScreenShare,
  sharing,
  starting,
  error,
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
  // True from confirm until the capture settles -- the browser's own
  // picker may sit in front of this panel for seconds, during which
  // nothing here may be dismissable or clickable (a double confirm must
  // not queue two captures, and a stray Escape must not close the panel
  // out from under the picker).
  starting: boolean;
  // What the last attempt came back with, shown inline -- the panel is
  // where the capture was asked for, so it's where the refusal lands.
  error: string | null;
  initial: ShareChoice;
  onOpenChange: (open: boolean) => void;
  onConfirm: (choice: ShareChoice) => void;
}) {
  const [choice, setChoice] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);
  // Re-seed the draft only when the panel OPENS -- not on every render
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
      if (starting) return;
      if (e.key === "Escape") onOpenChange(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (starting) return;
      if (!(e.target instanceof Element)) return;
      // Clicks on the header belong to its toggle button -- closing here
      // too would fight it (close then reopen within one click).
      if (e.target.closest("header")) return;
      if (panelRef.current && !panelRef.current.contains(e.target)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange, starting]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={panelRef}
          role="dialog"
          aria-labelledby="share-panel-title"
          tabIndex={-1}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="absolute inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-card text-card-foreground shadow-xl outline-none sm:max-w-[22rem]"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="share-panel-title" className="text-base font-semibold">
              {sharing ? "Qualidade da transmissão" : "Compartilhar"}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={starting}
              onClick={() => onOpenChange(false)}
              aria-label="Fechar"
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {canScreenShare && (
              // Which source to capture. Shown live as well as up front:
              // changing the source of an existing share restarts the
              // transmission (a new capture, a new connection), and the
              // caption below says so.
              <SegmentRow label="O que compartilhar" ariaLabel="Fonte" options={SOURCE_OPTIONS} value={sourceKeyOf(choice)} onChange={(key) => setChoice(applySourceKey(choice, key))} />
            )}

            <div className="space-y-2">
              <SegmentRow ariaLabel="Qualidade" label="Qualidade" options={QUALITY_OPTIONS} value={choice.quality} onChange={(quality) => setChoice((c) => ({ ...c, quality }))} />
              <SegmentRow ariaLabel="Quadros por segundo" label="FPS" options={FPS_OPTIONS} value={choice.fps} onChange={(fps) => setChoice((c) => ({ ...c, fps }))} />
            </div>

            {canScreenShare && (
              // The one thing the browser can't do on its own -- excluding
              // one app from a full-screen system-audio capture -- spelled
              // out where the choice is made: per-app output routing for
              // the monitor case, and Chrome 141's per-window audio for
              // the window case.
              <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                Compartilhando uma <span className="font-medium text-foreground">janela</span>, só o áudio desse app vai
                (Chrome 141+). Na tela inteira, para deixar um app de fora — ex.: Discord — defina a saída dele para
                outro dispositivo nas configurações de som.
              </p>
            )}

            {sharing && (
              <p className="text-xs text-muted-foreground">
                Trocar a fonte reinicia a transmissão por alguns instantes. Reduções de qualidade/FPS aplicam na hora, sem
                recapturar ou cortar a transmissão. Aumentos (ou "Original") valem a partir do próximo compartilhamento.
              </p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex justify-end border-t px-4 py-3">
            <Button disabled={starting} onClick={() => onConfirm(choice)}>
              {starting && <AnimatedIcon animation={loadingIcon} autoplay loop />}
              {sharing ? "Aplicar" : "Compartilhar"}
            </Button>
          </div>
        </motion.aside>
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