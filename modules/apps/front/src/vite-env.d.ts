/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POST_API_URL: string;
  readonly VITE_BOOKCLUB_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
