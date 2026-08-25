import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.js";
import { isDiscordActivity, initDiscordActivity } from "./lib/discordActivity.js";

// Fire-and-forget, and only when actually launched as a Discord
// Activity (frame_id present) -- a normal browser visit never even
// imports the SDK's init path meaningfully beyond this no-op check.
// Rendering doesn't wait on it: the app should look and work exactly
// the same whether or not the Discord handshake succeeds, per this
// feature's "full site embedded, unchanged" scope.
if (isDiscordActivity()) {
  initDiscordActivity().catch((err) => console.error("[discord-activity] init failed:", err));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
