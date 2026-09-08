import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import Home from "@/pages/Home";
import Room from "@/pages/Room";
import Forja from "@/pages/Forja";
import { initHubThemeSync } from "@/lib/hubTheme";

export default function App() {
  // While embedded in the hub's renderer, follow the hub's theme --
  // and our own toggle reports back to it (lib/hubTheme.ts).
  useEffect(() => initHubThemeSync(), []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/forja" element={<Forja />} />
        <Route path="/r/:id" element={<Room />} />
        {/* Anything else is a mistyped link -- send it back to the form
            rather than showing a dead end. */}
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}