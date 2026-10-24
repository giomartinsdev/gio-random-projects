import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// SPA do Uhumarketing. Todo o estado vem do uhumarketing-api, escopado pela
// conta da sessão.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
