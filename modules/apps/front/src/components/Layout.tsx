import type { ReactNode } from "react";
import NavBar from "./NavBar.js";
import BinaryRain from "./BinaryRain.js";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Background pattern + ambient glow, same visual language as
          website-butecodosdev's hero -- kept low-key here since this
          runs behind every page, not just a one-off landing section. */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-buteco-brown-dark/60 via-buteco-brown to-buteco-brown" />
        <BinaryRain />
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-buteco-amber/10 rounded-full blur-3xl animate-float" />
        <div
          className="absolute top-1/3 -right-40 w-96 h-96 bg-buteco-amber/5 rounded-full blur-3xl animate-float"
          style={{ animationDelay: "-3s" }}
        />
      </div>

      <NavBar />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">{children}</main>

      <footer className="border-t border-white/5 mt-10">
        <div className="max-w-4xl mx-auto px-6 py-8 text-center text-buteco-cream/40 text-sm font-mono">
          feito com <span className="text-buteco-amber">♥</span> pela Sala de aula do Buteco
        </div>
      </footer>
    </div>
  );
}
