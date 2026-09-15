import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import Home from "@/pages/Home";
import Room from "@/pages/Room";

// Route transitions, SPA-style: the page crossfades (with a tiny lift)
// instead of snapping. Keyed per page -- every room shares one key, so
// moving between rooms wouldn't re-run the entrance.
function AnimatedRoutes() {
  const location = useLocation();
  const pageKey = location.pathname.startsWith("/r/") ? "room" : "home";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="contents"
      >
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/r/:id" element={<Room />} />
          {/* Anything else is a mistyped link -- send it back to the form
              rather than showing a dead end. */}
          <Route path="*" element={<Home />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}