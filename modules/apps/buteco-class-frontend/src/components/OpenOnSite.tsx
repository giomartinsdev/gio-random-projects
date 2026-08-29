import { useLocation } from "react-router";
import { buttonClasses } from "./ui/index.js";

// What the Aulas section renders INSIDE a Discord Activity: a link out
// to the same route on the real site, and nothing else.
//
// Live classes can't work inside Discord's Activity iframe. Two hard
// blockers, both confirmed against the real client:
//
//   1. getDisplayMedia rejects instantly with "not granted" -- Discord
//      doesn't delegate the display-capture Permissions-Policy feature
//      to the iframe.
//   2. `new RTCPeerConnection()` throws "RTCPeerConnection is not a
//      constructor" -- WebRTC is removed outright, so peer-to-peer
//      video is impossible in BOTH directions, viewers included.
//
// Everything that tried to work around this (capture in a popup,
// frames over the WebSocket) traded away quality, audio and
// simplicity to end up somewhere still fragile. On the plain site all
// of it just works, so the Activity's job is only to get you there.
//
// A real <a target="_blank"> and not window.open(): Discord intercepts
// programmatic popups from an Activity through its own proxy-ticket
// flow, which was observed failing with a 403 and leaving a window
// that never navigates.
export default function OpenOnSite() {
  const { pathname } = useLocation();
  // NOT window.location.origin: inside an Activity that's Discord's
  // proxy origin (https://<app_id>.discordsays.com), which only
  // resolves within the iframe -- useless in a real browser tab.
  const origin = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || window.location.origin;

  return (
    <div className="flex flex-col items-center justify-center text-center py-20 animate-fade-in-up">
      <h1 className="font-heading font-bold text-2xl text-buteco-cream mb-3">Aulas ao vivo</h1>
      <p className="text-buteco-cream/60 max-w-md mb-8">
        As aulas abrem no navegador, onde o compartilhamento de tela roda com qualidade total e som. O áudio da conversa
        continua aqui no canal de voz do Discord.
      </p>
      <a href={`${origin}${pathname}`} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "lg" })}>
        Abrir a aula
      </a>
    </div>
  );
}
