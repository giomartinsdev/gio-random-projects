import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppWindow, Camera, Info, Monitor, PanelTop, X } from "lucide-react";
import type { DisplaySurface, Source } from "@/lib/useRoom";
import {
  SCREEN_MODE_FPS,
  SCREEN_MODE_LABELS,
  SCREEN_RESOLUTIONS,
  sanitizeScreenQuality,
  type ScreenMode,
  type ScreenQualityConfig,
} from "@/lib/screenQuality";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { loadingIcon } from "@/lib/lottie-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ShareChoice = { source: Source; quality: ScreenQualityConfig; surface: DisplaySurface };

// The picker's first row is one flat choice: three screen surfaces plus
// the camera. The labels for the screen surfaces come from useRoom's
// SURFACE_OPTIONS so the two stay in sync; "Câmera" is panel-only.
type SurfaceOrCamera = DisplaySurface | "camera";

const SOURCE_OPTIONS: { value: SurfaceOrCamera; label: string; hint: string; icon: typeof Monitor }[] = [
  { value: "monitor", label: "Tela inteira", hint: "tudo o que você vê", icon: Monitor },
  { value: "window", label: "Janela", hint: "um app específico", icon: AppWindow },
  { value: "browser", label: "Aba", hint: "uma aba do navegador", icon: PanelTop },
  { value: "camera", label: "Câmera", hint: "sua webcam", icon: Camera },
];

function sourceKeyOf(c: ShareChoice): SurfaceOrCamera {
  return c.source === "camera" ? "camera" : c.surface;
}

function applySourceKey(c: ShareChoice, key: SurfaceOrCamera): ShareChoice {
  if (key === "camera") return { ...c, source: "camera" };
  return { ...c, source: "screen", surface: key };
}

// The share panel: a drawer over the room's right edge on the desktop,
// a bottom sheet on a phone (same thumb-reach idea as the room's bottom
// bar). Opened from the header's "Compartilhar" button before streaming
// and from it as "Qualidade" while a share is live. Deliberately not a
// modal -- the room stays visible and the header stays clickable, so
// this is a panel, not a dialog. It closes on its X, on Escape, on a
// click anywhere else in the room, and on its own the moment a share
// starts successfully.
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
  // One breakpoint read at mount picks the slide axis: right drawer on
  // the desktop, bottom sheet on a phone. A window resized across sm
  // while the panel is open keeps its axis -- cosmetic either way.
  const [wide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  );
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
          initial={wide ? { x: "100%" } : { y: "100%" }}
          animate={{ x: 0, y: 0 }}
          exit={wide ? { x: "100%" } : { y: "100%" }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="absolute inset-x-0 bottom-0 top-auto z-40 flex max-h-[85dvh] w-full flex-col rounded-t-2xl border-t bg-card text-card-foreground shadow-2xl outline-none sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:max-w-[25rem] sm:rounded-none sm:border-l sm:border-t-0"
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 id="share-panel-title" className="text-lg font-semibold tracking-tight">
                {sharing ? "Qualidade da transmissão" : "Compartilhar"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {sharing
                  ? "Ajuste o que está no ar sem encerrar nada."
                  : "Escolha o que vai no ar e com que qualidade."}
              </p>
            </div>
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

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {canScreenShare && (
              // Which source to capture, as cards rather than a flat
              // segmented row: four choices with room to explain each.
              // Shown live as well as up front -- changing the source of
              // an existing share restarts the transmission (a new
              // capture, a new connection), and the caption below says so.
              <section>
                <SectionLabel>O que compartilhar</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {SOURCE_OPTIONS.map(({ value, label, hint, icon: Icon }) => {
                    const selected = sourceKeyOf(choice) === value;
                    return (
                      <motion.button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setChoice(applySourceKey(choice, value))}
                        className={cn(
                          "group flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border bg-secondary/30 hover:border-primary/40 hover:bg-secondary/60",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-9 items-center justify-center rounded-lg transition-colors",
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{label}</span>
                          <span className="block text-xs text-muted-foreground">{hint}</span>
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <div>
                <SectionLabel>Tipo de conteúdo</SectionLabel>
                <Segments
                  ariaLabel="Tipo de conteúdo"
                  options={(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((mode) => ({
                    value: mode,
                    label: SCREEN_MODE_LABELS[mode].label,
                  }))}
                  value={choice.quality.mode}
                  onChange={(mode) => {
                    const fps = SCREEN_MODE_FPS[mode][0];
                    setChoice((c) => ({ ...c, quality: sanitizeScreenQuality({ ...c.quality, mode, fps }) }));
                  }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{SCREEN_MODE_LABELS[choice.quality.mode].hint}</p>
              </div>
              <div>
                <SectionLabel>Resolução</SectionLabel>
                <Segments
                  ariaLabel="Resolução"
                  options={SCREEN_RESOLUTIONS.map((resolution) => ({
                    value: resolution,
                    label: `${resolution}p`,
                  }))}
                  value={choice.quality.resolution}
                  onChange={(resolution) => setChoice((c) => ({ ...c, quality: { ...c.quality, resolution } }))}
                />
              </div>
              <div>
                <SectionLabel>Quadros por segundo</SectionLabel>
                <Segments
                  ariaLabel="Quadros por segundo"
                  options={SCREEN_MODE_FPS[choice.quality.mode].map((fps) => ({
                    value: fps,
                    label: String(fps),
                  }))}
                  value={choice.quality.fps}
                  onChange={(fps) =>
                    setChoice((c) => ({ ...c, quality: sanitizeScreenQuality({ ...c.quality, fps }) }))
                  }
                />
              </div>
            </section>

            {/* One line that restates the pick in plain words -- the
                instant feedback a settings panel owes: change anything
                and this sentence changes with it. */}
            <p className="text-sm text-muted-foreground">
              Vai no ar em{" "}
              <span className="font-medium text-foreground">
                {choice.quality.resolution}p a {choice.quality.fps} fps
              </span>
              {choice.source === "camera" ? ", da câmera" : ""}.
            </p>

            {canScreenShare && (
              // The one thing the browser can't do on its own -- excluding
              // one app from a full-screen system-audio capture -- spelled
              // out where the choice is made: per-app output routing for
              // the monitor case, and Chrome 141's per-window audio for
              // the window case.
              <p className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Compartilhando uma <span className="font-medium text-foreground">janela</span>, só o áudio desse app vai
                  (Chrome 141+). Na tela inteira, para deixar um app de fora — ex.: Discord — defina a saída dele para
                  outro dispositivo nas configurações de som.
                </span>
              </p>
            )}

            {sharing && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Trocar a fonte reinicia a transmissão por alguns instantes. Reduções de resolução/FPS aplicam na hora,
                sem recapturar ou cortar a transmissão. Aumentos valem a partir do próximo compartilhamento.
              </p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* The safe-area padding keeps the buttons clear of a phone's
              home indicator; the sheet reaches the floor of the screen. */}
          <div className="flex gap-2 border-t bg-card px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:pb-4">
            <Button
              variant="outline"
              disabled={starting}
              onClick={() => onOpenChange(false)}
              aria-label="Cancelar"
            >
              Cancelar
            </Button>
            <Button className="h-10 flex-1" disabled={starting} onClick={() => onConfirm(choice)}>
              {starting && <AnimatedIcon animation={loadingIcon} autoplay loop />}
              {sharing ? "Aplicar" : "Compartilhar"}
            </Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
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
    <div role="group" aria-label={ariaLabel} className="flex overflow-hidden rounded-lg border">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 px-1 py-2 text-xs font-medium transition-colors sm:text-sm",
            o.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-secondary/50 text-secondary-foreground hover:bg-secondary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}