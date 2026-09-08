import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Dark-only (tela's take): one surface, one palette, nothing to
// persist -- so there's no pre-paint theme application either.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);