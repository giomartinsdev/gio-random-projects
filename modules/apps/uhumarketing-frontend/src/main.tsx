import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// SPA do Uhumarketing (POC de UI): todo o estado é mock e vive no
// StoreProvider (lib/store.tsx), persistido em localStorage.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
