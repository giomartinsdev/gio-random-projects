import { Banner } from "../ui/index.js";

// WebRTC failures surface right under the controls, in mono, because
// these strings come straight from the browser and are debug-grade
// (getDisplayMedia denial, permission errors, ICE oddities).
export function RtcErrorBanner({ error }: { error: string }) {
  return (
    <Banner tone="error" title="Não deu pra compartilhar">
      <p className="font-mono text-[0.7rem] break-all">{error}</p>
    </Banner>
  );
}