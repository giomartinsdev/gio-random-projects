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
