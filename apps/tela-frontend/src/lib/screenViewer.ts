import { waitIceComplete } from "./iceGathering";
import { fetchIceConfig } from "./iceServers";

export interface ScreenViewerOptions {
  // The WHEP exchange, relayed by the server: raw offer in, MediaMTX's
  // answer out. The viewer never learns the publisher's path.
  exchange: (offer: string) => Promise<string>;
  // The path carries audio iff the roster said so -- avoids asking for an
  // absent m-line.
  hasAudio: boolean;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  onEnded?: () => void;
  onBroken?: () => void;
}

// One receive-only peer connection pulling a MediaMTX screen path over
// WHEP. Tracks are accumulated into ONE MediaStream handed to the room
// store, so the tile renders it unchanged.
export class ScreenViewer {
  private pc: RTCPeerConnection | null = null;
  private readonly options: ScreenViewerOptions;

  constructor(options: ScreenViewerOptions) {
    this.options = options;
  }

  get connection(): RTCPeerConnection | null {
    return this.pc;
  }

  // Subscribe on the room's path. Resolves once the first track arrives so
  // the caller can swap streams without a gap; a timeout means the path is
  // not publishing (or MediaMTX is down).
  async start(stream: MediaStream): Promise<void> {
    const config = this.options.iceServers
      ? { iceServers: this.options.iceServers, iceTransportPolicy: this.options.iceTransportPolicy }
      : await fetchIceConfig();
    const pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy,
      bundlePolicy: "max-bundle",
    });
    this.pc = pc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const firstTrack = new Promise<void>((resolve) => {
        pc.ontrack = (event) => {
          if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
          event.track.addEventListener("ended", () => this.options.onEnded?.());
          resolve();
        };
      });
      pc.addTransceiver("video", { direction: "recvonly" });
      if (this.options.hasAudio) pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addEventListener("connectionstatechange", () => {
        if (pc !== this.pc) return;
        if (pc.connectionState === "failed") this.options.onBroken?.();
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      const sdp = await this.options.exchange(pc.localDescription!.sdp);
      await pc.setRemoteDescription({ type: "answer", sdp });
      await Promise.race([
        firstTrack,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("SFU sem mídia")), 10_000);
        }),
      ]);
    } catch (err) {
      this.stop();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Download stats for the per-tile reader (one PC per publisher).
  getStats(): Promise<RTCStatsReport> {
    if (!this.pc) return Promise.reject(new Error("ScreenViewer parado"));
    return this.pc.getStats();
  }

  stop(): void {
    const pc = this.pc;
    this.pc = null;
    if (!pc) return;
    pc.ontrack = null;
    pc.close();
  }
}
