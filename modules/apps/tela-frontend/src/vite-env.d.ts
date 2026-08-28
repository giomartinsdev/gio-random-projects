/// <reference types="vite/client" />

interface ImportMetaEnv {
  // This app's API (tela-api) — REST base for rooms/knocks.
  readonly VITE_TELA_API_URL: string;
  // Public OTLP endpoint for the browser SDK (src/telemetry.ts) — baked
  // in at build time by ts-frontend-ci-cd.yml. Unset locally = no
  // browser telemetry at all.
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}