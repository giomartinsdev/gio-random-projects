/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FINANCE_API_URL?: string;
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
