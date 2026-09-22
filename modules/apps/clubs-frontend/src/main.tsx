import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// O tema é aplicado antes do primeiro paint para não piscar branco.
const saved = localStorage.getItem("clubs.theme");
document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
