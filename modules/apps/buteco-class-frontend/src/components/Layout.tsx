import { Outlet } from "react-router";
import Sidebar from "./Sidebar.js";
import BinaryRain from "./BinaryRain.js";
import { SkipLink } from "./ui/index.js";
import { useRailState } from "../lib/useRailState.js";
import { isDiscordActivity } from "../lib/discordActivity.js";

// The page chrome: fixed background + rain, the sidebar rail, and a
// bare content slot. Widths/paddings belong to the pages (PageShell);
// the only layout-level rule is paying back the rail's 72px on
// desktop -- absent when the rail is hidden or inside a Discord
// Activity (forced compact there, see Sidebar).
export default function Layout() {
  const [railState, setRailState] = useRailState();
  const inActivity = isDiscordActivity();
  const reserveRail = !inActivity && railState !== "hidden";

  return (
    <div className="min-h-screen flex flex-col relative">
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

      <SkipLink />
      <Sidebar state={railState} onState={setRailState} />

      <main id="conteudo" tabIndex={-1} className={reserveRail ? "lg:pl-[72px] focus:outline-none" : "focus:outline-none"}>
        <Outlet />
      </main>

      <footer className={reserveRail ? "lg:pl-[72px]" : ""}>
        <div className="border-t border-white/5 py-8 text-center text-buteco-cream/40 text-sm font-mono">
          feito com <span className="text-buteco-amber">♥</span> pela Sala de aula do Buteco
        </div>
      </footer>
    </div>
  );
}