/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da harness-api em produção (ex.: https://harness-api.giomartins.dev); vazio no local = relativo (proxy do Vite). */
  readonly VITE_HARNESS_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}