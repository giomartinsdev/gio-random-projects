import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// SPA do Prospecta: implementa o design system e as 5 telas do poc.pen,
// consumindo a prospecta-api (X-API-Key) e o feed SSE de /agent/activity.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
