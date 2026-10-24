import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, loadTheme } from "@/lib/theme";
import "./index.css";
import App from "./App";

// The saved theme goes on <html data-theme> before the first paint --
// doing this in a component would flash the default palette first.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);