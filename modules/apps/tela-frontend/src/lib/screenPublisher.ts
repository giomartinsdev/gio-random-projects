import { waitIceComplete } from "./iceGathering";
import type { ScreenQualityPreset } from "./screenQuality";

// Cloudflare's edge answers STUN itself; MediaMTX media is reached
// directly. The server advertises its own reachable address, so a STUN
// fallback is all this needs -- on a network that blocks UDP outright
// the connection won't establish.
const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Opus cap carried on the audio sender; the path forwards RTP untouched.
export const SCREEN_AUDIO_MAX_BITRATE = 128_000;

export interface ScreenPublisherOptions {
  // The WHIP exchange, relayed by the server: raw offer in, MediaMTX's
  // answer out. The publisher never learns the MediaMTX path.
  exchange: (offer: string) => Promise<string>;
  iceServers?: RTCIceServer[];
  onEnded?: () => void;
  onBroken?: () => void;
}

// One send-only peer connection publishing the screen (video, and audio
// when the capture carried a track) to MediaMTX over WHIP.
//
// The offer is sent RAW -- never re-add x-google-start-/min-bitrate
// munges: they drive residential uplinks past what they can carry and
// MediaMTX drops frames. Sender caps go through setParameters instead.
export class ScreenPublisher {
  private pc: RTCPeerConnection | null = null;
  private readonly options: ScreenPublisherOptions;

  constructor(options: ScreenPublisherOptions) {
    this.options = options;
  }

  get connection(): RTCPeerConnection | null {
    return this.pc;
  }

  // Publish `stream`. Audio is published only when the capture actually
  // carries an audio track; the browser picker decided that, never a UI
  // switch.
  async start(stream: MediaStream, preset: ScreenQualityPreset): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? FALLBACK_ICE,
      bundlePolicy: "max-bundle",
    });
    this.pc = pc;
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    const audioTrack = stream.getAudioTracks()[0] ?? null;
    if (videoTrack) pc.addTransceiver(videoTrack, { direction: "sendonly", streams: [stream] });
    if (audioTrack) pc.addTransceiver(audioTrack, { direction: "sendonly", streams: [stream] });

    pc.addEventListener("connectionstatechange", () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "failed") this.options.onBroken?.();
    });
    videoTrack?.addEventListener("ended", () => this.options.onEnded?.());

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      const sdp = await this.options.exchange(pc.localDescription!.sdp);
      await pc.setRemoteDescription({ type: "answer", sdp });
      // Caps are applied after connect so Chrome doesn't briefly exceed them.
      await this.applyPreset(preset);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  // Re-aim a live publish at a new preset: video sender caps + audio
  // bitrate. No renegotiation -- shrinking is real (the encoder scales
  // frames down immediately); growing past what was captured can't happen
  // through setParameters, so the UI re-shares for that.
  async applyPreset(preset: ScreenQualityPreset): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.sender.track?.kind;
      if (kind === "video") {
        const params = transceiver.sender.getParameters();
        // A browser sender always carries one encoding by default; create
        // it if a fake/minimal stack returned none so the caps still land.
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = preset.maxBitrateKbps * 1000;
        params.encodings[0].maxFramerate = preset.maxFramerate;
        params.degradationPreference = "maintain-resolution";
        await transceiver.sender.setParameters(params).catch(() => undefined);
        if (transceiver.sender.track) transceiver.sender.track.contentHint = preset.contentHint;
      } else if (kind === "audio") {
        const params = transceiver.sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = SCREEN_AUDIO_MAX_BITRATE;
        await transceiver.sender.setParameters(params).catch(() => undefined);
        if (transceiver.sender.track) transceiver.sender.track.contentHint = "music";
      }
    }
  }

  // Outgoing mute: the path and roster never change, only the track's
  // enabled flag.
  setAudioEnabled(enabled: boolean): void {
    const track = this.pc?.getTransceivers().find((t) => t.sender.track?.kind === "audio")?.sender.track;
    if (track) track.enabled = enabled;
  }

  stop(): void {
    const pc = this.pc;
    this.pc = null;
    if (!pc) return;
    pc.onconnectionstatechange = null;
    pc.close();
  }
}
