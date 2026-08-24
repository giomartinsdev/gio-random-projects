import type { ReactNode } from "react";
import NavBar from "./NavBar.js";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Ambient amber glow orbs, same visual language as the landing page's glow-amber */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-buteco-amber/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-buteco-amber/5 rounded-full blur-3xl" />
      </div>

      <NavBar />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">{children}</main>

      <footer className="border-t border-white/5 mt-10">
        <div className="max-w-4xl mx-auto px-6 py-8 text-center text-buteco-cream/40 text-sm font-mono">
          feito com <span className="text-buteco-amber">♥</span> pela comunidade Buteco dos Devs
        </div>
      </footer>
    </div>
  );
}
