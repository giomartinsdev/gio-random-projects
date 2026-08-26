import { BrowserRouter, Route, Routes } from "react-router";
import Home from "@/pages/Home";
import Room from "@/pages/Room";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:id" element={<Room />} />
        {/* Anything else is a mistyped link -- send it back to the form
            rather than showing a dead end. */}
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
