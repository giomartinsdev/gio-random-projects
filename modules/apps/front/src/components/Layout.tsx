import type { ReactNode } from "react";
import NavBar from "./NavBar.js";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
