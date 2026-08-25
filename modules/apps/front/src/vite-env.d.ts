/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POST_API_URL: string;
  readonly VITE_BOOKCLUB_API_URL: string;
  readonly VITE_CLASSROOM_API_URL: string;
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// See lib/useWebRTCBroadcast.ts / pages/SharePopup.tsx: a same-origin
// popup window hands a captured MediaStream back to its opener by
// calling these directly (a live object reference across the window
// boundary, not postMessage -- MediaStream isn't structured-clonable).
interface Window {
  __classroomReceiveStream?: (stream: MediaStream, kind: "screen" | "camera") => void;
  __classroomShareError?: (message: string) => void;
}
