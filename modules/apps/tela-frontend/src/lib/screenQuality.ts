// The screen-share quality model: a mode (document/text vs media/motion),
// a resolution and a frame rate, turned into the capture constraints and
// the encoder caps the WHIP publisher applies. Entirely client-side -- the
// MediaMTX transport relays whatever is published, so the room's camera is
// never involved.
//
// Bits-per-pixel-per-frame instead of a flat megabit table: bitrate scales
// with resolution and frame rate, so the budget has to as well. The table
// below is the tuned result, keyed by `${resolution}:${fps}`.

export type ScreenMode = "doc" | "media";
export type ScreenResolution = 480 | 720 | 1080;
export type ScreenFps = 5 | 30 | 60;

export type ScreenQualityConfig = {
  mode: ScreenMode;
  fps: ScreenFps;
  resolution: ScreenResolution;
};

// What a preset turns into: the capture constraints, the encoder cap, and
// the content hint the track carries.
export type ScreenQualityPreset = {
  label: string;
  contentHint: "detail" | "motion";
  capture: { width: number; height: number; frameRate: number };
  // The single-layer budget for the one path MediaMTX publishes.
  maxBitrateKbps: number;
  maxFramerate: number;
};

export const SCREEN_MODE_FPS: Record<ScreenMode, ScreenFps[]> = {
  doc: [5],
  media: [30, 60],
};

export const SCREEN_RESOLUTIONS: ScreenResolution[] = [1080, 720, 480];

export const SCREEN_MODE_LABELS: Record<ScreenMode, { label: string; hint: string }> = {
  doc: { label: "Documento", hint: "texto nítido, poucos quadros" },
  media: { label: "Mídia", hint: "movimento fluido" },
};

export const DEFAULT_SCREEN_QUALITY: ScreenQualityConfig = {
  mode: "media",
  fps: 30,
  resolution: 720,
};

interface ScreenLayerRow {
  highKbps: number;
}

const SCREEN_LAYER_TABLE: Record<ScreenMode, Partial<Record<`${ScreenResolution}:${ScreenFps}`, ScreenLayerRow>>> = {
  doc: {
    "1080:5": { highKbps: 900 },
    "720:5": { highKbps: 700 },
    "480:5": { highKbps: 450 },
  },
  media: {
    "1080:30": { highKbps: 3000 },
    "1080:60": { highKbps: 4500 },
    "720:30": { highKbps: 2000 },
    "720:60": { highKbps: 3000 },
    "480:30": { highKbps: 1000 },
    "480:60": { highKbps: 1500 },
  },
};

function isScreenMode(value: unknown): value is ScreenMode {
  return value === "doc" || value === "media";
}

function isScreenFps(value: unknown): value is ScreenFps {
  return value === 5 || value === 30 || value === 60;
}

function isScreenResolution(value: unknown): value is ScreenResolution {
  return value === 1080 || value === 720 || value === 480;
}

// A picker value a stale storage entry could have made invalid.
export function sanitizeScreenQuality(config: unknown): ScreenQualityConfig {
  if (typeof config !== "object" || config === null) return DEFAULT_SCREEN_QUALITY;
  const { mode, fps, resolution } = config as Partial<Record<keyof ScreenQualityConfig, unknown>>;
  if (!isScreenMode(mode) || !isScreenFps(fps) || !isScreenResolution(resolution)) return DEFAULT_SCREEN_QUALITY;
  if (!SCREEN_MODE_FPS[mode].includes(fps)) return DEFAULT_SCREEN_QUALITY;
  return { mode, fps, resolution };
}

// 4:2:0 encoders want even dimensions; 480p's exact 16:9 width is 853.33.
function evenSixteenNineWidth(height: number): number {
  return Math.round((height * 16) / 9 / 2) * 2;
}

// Turn a sharer's mode/resolution/fps pick into the capture constraints,
// the encoder cap and the content hint. The content hint is what tells
// the encoder what to sacrifice under pressure: "detail" protects
// sharpness for docs (a soft frame drop there reads worse than motion),
// "motion" protects the frame rate for everything that moves.
export function screenQualityPreset(config: ScreenQualityConfig): ScreenQualityPreset {
  const safe = sanitizeScreenQuality(config);
  const row = SCREEN_LAYER_TABLE[safe.mode][`${safe.resolution}:${safe.fps}`]!;
  return {
    label: `${SCREEN_MODE_LABELS[safe.mode].label} ${safe.resolution}p${safe.mode === "media" ? ` ${safe.fps}fps` : ""}`,
    contentHint: safe.mode === "doc" ? "detail" : "motion",
    capture: {
      width: evenSixteenNineWidth(safe.resolution),
      height: safe.resolution,
      frameRate: safe.fps,
    },
    maxBitrateKbps: row.highKbps,
    maxFramerate: safe.fps,
  };
}

// The picker's own state, held in localStorage so a re-share remembers the
// last choice. Kept here next to the model it belongs to.
const STORAGE_KEY = "tela.screenQuality";

export function rememberScreenQuality(config: ScreenQualityConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage disabled (private mode) -- the choice just won't persist.
  }
}

export function loadScreenQuality(): ScreenQualityConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeScreenQuality(JSON.parse(raw)) : DEFAULT_SCREEN_QUALITY;
  } catch {
    return DEFAULT_SCREEN_QUALITY;
  }
}
