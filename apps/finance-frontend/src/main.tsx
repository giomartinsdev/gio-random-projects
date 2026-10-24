import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./telemetry.ts";
import "./index.css";
import App from "./App";
import { applyTheme, loadTheme } from "@/lib/theme";

// Tema antes de o React pintar: sem isto haveria um flash do tema errado para
// quem escolheu o oposto do SO.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
