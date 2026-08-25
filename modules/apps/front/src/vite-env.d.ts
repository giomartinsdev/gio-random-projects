/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POST_API_URL: string;
  readonly VITE_BOOKCLUB_API_URL: string;
  readonly VITE_CLASSROOM_API_URL: string;
  // This app's own PUBLIC origin. Needed because inside a Discord
  // Activity window.location.origin is Discord's proxy origin
  // (https://<app_id>.discordsays.com), which only resolves within the
  // Activity iframe -- useless as a URL to hand to a real browser tab.
  // See lib/useWebRTCBroadcast.ts's startSharing.
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
