// First import, deliberately: the fetch/page-load instrumentations
// must be in place before anything fires a request. No-op unless
// VITE_OTEL_EXPORTER_OTLP_ENDPOINT was baked in at build time.
import "./telemetry.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
