import { useCallback, useEffect, useRef, useState } from "react";
import { readIdentity, rememberIdentity, wsUrl } from "./api";

// STUN for this browser's side of the connection. The server advertises
// its own reachable address directly (see the Go side's SFU_PUBLIC_IP),
// so there's no TURN here: on a network that blocks UDP outright the
// connection won't establish.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Someone dropping off is usually a blip -- a reload, a moment of bad
// wifi, or this server being redeployed -- not someone leaving. Tearing
// their tile down the instant the WebSocket says they're gone turns a
// two-second gap into a visible interruption, so it waits.
const LEAVE_GRACE_MS = 12_000;

// Reconnect backoff. Starts fast because the common case is a deploy --
// a couple of seconds -- and backs off so a genuinely dead server isn't
// hammered.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

// The simulcast auto-switch heuristic's tuning (see the effect near
// setPublisherVideoLayer). 8% sustained over two 3s windows before
// downgrading -- a single bad sample is normal jitter, not a verdict;
// 5 clean windows (~15s) before trying "high" again -- recovering
// slower than falling protects against flapping right back down.
const LAYER_POLL_MS = 3_000;
const LAYER_DOWNGRADE_LOSS_PCT = 8;
const LAYER_DOWNGRADE_WINDOWS = 2;
const LAYER_UPGRADE_CLEAN_WINDOWS = 5;
// OFF for now. Measured against a real Chrome publisher: the "low"
// simulcast layer's encoder stays dormant -- zero bytes ever sent --
// until something makes the browser start it, for as long as 45s with
// a real subscriber connected the whole time (this is a known, open
// problem in other pion-based SFUs too, not specific to this one). The
// server-side fix already refuses to drop a viewer's working "high"
// layer for a "low" that doesn't exist yet (see SetPublisherVideoLayer,
// tela-api), so flipping this on can only ever mean "the auto-switch
// silently fails to downgrade," never "someone loses their video" --
// but it also means the floor this was supposed to add doesn't
// actually exist yet. Leave off until the SFU has a way to wake the
// layer up (a PLI targeted at it, once its SSRC is known some other
// way) and that's been verified the same way this was: a real Chrome
// publisher, a real viewer, real getStats() numbers.
const LAYER_AUTO_SWITCH_ENABLED = false;

// Whoever is sharing picks these before they start -- see
// AspectModeButton-style pickers in Room.tsx. "source" means "don't
// constrain this at all", i.e. whatever the display/camera natively
// gives getDisplayMedia/getUserMedia.
export type Quality = "360p" | "480p" | "720p" | "1080p" | "source";
export type Fps = 5 | 15 | 30 | 60 | "source";

export const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "360p", label: "360p" },
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "source", label: "Original" },
];

export const FPS_OPTIONS: { value: Fps; label: string }[] = [
  { value: 5, label: "5 fps" },
  { value: 15, label: "15 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
  { value: "source", label: "Original" },
];

// What the display picker should start on. Purely a hint to Chrome's own
// getDisplayMedia picker (Firefox and Safari pick their own defaults) --
// it saves a click, it doesn't enforce anything.
export type DisplaySurface = "monitor" | "window" | "browser";

export const SURFACE_OPTIONS: { value: DisplaySurface; label: string }[] = [
  { value: "monitor", label: "Tela inteira" },
  { value: "window", label: "Janela" },
  { value: "browser", label: "Aba" },
];

const QUALITY_DIMENSIONS: Record<Exclude<Quality, "source">, { width: number; height: number }> = {
  "360p": { width: 640, height: 360 },
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

// "source" quality has no fixed dimensions to reason about ahead of
// capture -- 1080p is the stand-in for sizing the bitrate ceiling
// below, not a real constraint (videoConstraintsFor below never sets
// width/height for it).
function dimensionsFor(quality: Quality) {
  return quality === "source" ? QUALITY_DIMENSIONS["1080p"] : QUALITY_DIMENSIONS[quality];
}

// One upload, not one per viewer: the server fans the stream out, so
// this is a flat cost however many people are watching. That's the
// whole reason the SFU exists, and why this was never divided by the
// size of the audience.
//
// Bits-per-pixel-per-frame instead of a table of 25 hand-picked
// numbers: bitrate scales with both resolution and frame rate, and
// this scales the same way real encoders do. 0.08 is tuned so
// 1080p+60fps lands close to the flat 10 Mbps ceiling screen sharing
// used before quality became selectable (Twitch/OBS's own guidance
// puts 1080p60 gaming at 6-9 Mbps) -- picking a smaller size or a
// lower rate now actually saves bandwidth instead of encoding
// low-detail content at a ceiling sized for 1080p60.
const BITS_PER_PIXEL_PER_FRAME = 0.08;
// A hard stop regardless of what the formula above works out to.
// Without it a 5K ultrawide "Original" capture prices itself at
// 60-70 Mbps -- a number no home uplink will ever sustain, and WebRTC's
// own congestion control (see applyEncodingLimits) will clamp the REAL
// send rate to what the network can carry anyway. 20 Mbps sits above
// Twitch's and YouTube's own 4K60 ingest guidance (15-35 Mbps), so nothing
// realistic hits this ceiling -- it exists to keep the number sane, not
// to be a target.
const MAX_BITRATE_BPS = 20_000_000;
// "source" fps has no fixed number to multiply by either -- 60 is the
// same stand-in dimensions above uses, but only when the ACTUAL capture
// (see `actual` below) isn't known yet.
const CAMERA_BITRATE_SHARE = 0.4; // a phone camera's own encoder needs less than a full desktop capture at the same resolution/fps

// `actual` is the captured track's real getSettings() once the capture
// exists -- using its real width/height/frameRate instead of the
// quality-implied stand-in is what makes "Original" actually mean "as
// much as THIS screen and THIS network can carry", not "pretend every
// screen is 1080p60". A 2560x1440 display asked for at "Original"
// prices its own real pixel count, not 1080p's -- this is the fix for
// the encoder-starves-and-drops-resolution regression: the ceiling used
// to assume 1080p60 while a forced 60fps hint made the real capture
// bigger than that, and the encoder had nowhere to put the extra
// pixels. Falls back to the stand-in before the capture exists (dialog
// preview) or when `actual` is camera/unavailable.
function bitrateFor(source: Source, quality: Quality, fps: Fps, actual?: MediaTrackSettings): number {
  const dims =
    quality === "source" && actual?.width && actual?.height
      ? { width: actual.width, height: actual.height }
      : dimensionsFor(quality);
  const rate = fps === "source" ? (actual?.frameRate ? Math.round(actual.frameRate) : 60) : fps;
  const bitrate = Math.min(MAX_BITRATE_BPS, dims.width * dims.height * rate * BITS_PER_PIXEL_PER_FRAME);
  return Math.round(source === "camera" ? bitrate * CAMERA_BITRATE_SHARE : bitrate);
}

// How much the encoder must shrink captured frames for the chosen
// quality to hold, from the track's ACTUAL capture size -- what was shared
// is whatever the browser granted, not the constraint asked for.
// Undefined when there's nothing to shrink (Original, or already at the
// target size). Scale can only ever be >= 1: an encoder cannot upscale
// what it never captured.
function scaleResolutionDownByFor(settings: MediaTrackSettings, quality: Quality): number | undefined {
  if (quality === "source" || !settings.width || !settings.height) return undefined;
  const { width, height } = QUALITY_DIMENSIONS[quality];
  const scale = Math.max(settings.width / width, settings.height / height);
  if (scale <= 1.05) return undefined;
  // Half-step rounding keeps the ratio from drift-flickering between
  // every setParameters call; 16 is the spec's cap.
  return Math.min(16, Math.round(scale * 2) / 2);
}

function videoConstraintsFor(
  source: Source,
  quality: Quality,
  fps: Fps,
  surface?: DisplaySurface,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints =
    source === "camera"
      ? // Rear camera by default -- sharing a phone's camera is usually
        // about showing something, not yourself. `ideal` rather than
        // `exact` so a laptop with one webcam still works instead of
        // throwing OverconstrainedError.
        { facingMode: { ideal: "environment" } }
      : {};

  if (quality !== "source") {
    const { width, height } = QUALITY_DIMENSIONS[quality];
    constraints.width = { ideal: width, max: width };
    constraints.height = { ideal: height, max: height };
  }
  if (fps !== "source") {
    constraints.frameRate = { ideal: fps, max: fps };
  } else if (source === "screen") {
    // "Original" fps means "whatever this screen can actually do" --
    // left unset, Chrome's capturer settles near 30fps, capping fast
    // content at half its natural rate for no reason. This DID backfire
    // once: the bitrate ceiling used to assume 1080p regardless of the
    // real capture size, so a real screen bigger than 1080p pushed to
    // 60fps blew straight through it, and the encoder's only way to
    // keep up was to gut resolution (measured: 2560x1440 source ->
    // 1080p or worse, ~25% of frames dropped). That's fixed now: the
    // ceiling in bitrateFor reads the ACTUAL captured width/height/fps
    // via getSettings(), so whatever this hint actually produces gets a
    // budget sized for it, not a budget sized for something else.
    constraints.frameRate = { ideal: 60 };
  }
  // Chrome biases its picker to the surface chosen ahead of time in the
  // share dialog. Strictly `{ideal}`, never `{exact}`: {exact} would make
  // browsers that don't support the hint fail the whole capture instead
  // of ignoring it.
  if (source === "screen" && surface && surface !== "monitor") {
    constraints.displaySurface = { ideal: surface };
  }
  return constraints;
}

// getDisplayMedia options lib.dom doesn't type yet: not offering this
// very tab (about to capture itself) and letting people Alt-Tab between
// windows mid-share without renegotiating. The two audio hints are
// Chromium-only biases and the picker still lets the person pick any
// surface, so each one only tightens the surface it names and degrades
// to the browser default everywhere else.
function gdmOptions(video: MediaTrackConstraints, surface?: DisplaySurface): DisplayMediaStreamOptions {
  return {
    video,
    // Screen audio is CONTENT -- music, apps, games -- not a phone call.
    // Plain `audio: true` runs it through the voice pipeline (echo
    // cancellation, noise suppression, AGC), which reads sustained
    // tones as "stationary noise" and pumps the gain: the robotic,
    // underwater artifact people hear on shared music. The AEC can't
    // work on loopback audio anyway, so there's nothing to lose here.
    // Browsers that ignore these constraints just behave as before.
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    // Monitor: system audio IS the point of a screen share, so pin the
    // picker's audio checkbox on. A window/tab capture never wants the
    // whole desktop mix.
    systemAudio: surface === "monitor" ? "include" : undefined,
    // Chrome 141+: a window share carries ONLY that app's audio (WASAPI
    // process loopback) -- streaming a game window keeps Discord and
    // friends out of the mix, audible to the sharer alone. Older
    // browsers ignore this and keep their window-audio default.
    windowAudio: surface === "window" ? "window" : undefined,
  } as DisplayMediaStreamOptions;
}

// Chrome negotiates WebRTC Opus shaped like a phone call: mono, a
// speech-sized bitrate. The audio a screen share carries is content --
// and the fmtp line is the one lever the browser hands us to say so.
// The SFU forwards RTP untouched, so whatever this offer's encoder is
// negotiated to produce is exactly what every viewer decodes: stereo,
// a real music budget, and in-band FEC for the lossy moments is the
// difference between "robozinho" and the sound the app actually made.
// Params already present (Chrome ships useinbandfec=1 by default) are
// kept, not duplicated -- a repeated param makes the SDP invalid.
function boostOpusSdp(sdp: string): string {
  const extra = ["stereo=1", "sprop-stereo=1", "maxaveragebitrate=256000", "useinbandfec=1"];
  const lines = sdp.split("\r\n");
  for (let i = 0; i < lines.length; i++) {
    const rtpmap = lines[i].match(/^a=rtpmap:(\d+) opus\/48000\/2/);
    if (!rtpmap) continue;
    const fmtp = `a=fmtp:${rtpmap[1]}`;
    const idx = lines.findIndex((line) => line.startsWith(fmtp));
    if (idx < 0) {
      lines.splice(i + 1, 0, `${fmtp} ${extra.join(";")}`);
    } else {
      const current = lines[idx];
      const has = (p: string) => current.split(";").some((part) => part.trim() === p);
      const additions = extra.filter((p) => !has(p));
      if (additions.length > 0) lines[idx] = [current, ...additions].join(";");
    }
    break; // one opus m-line per publish connection is all there is
  }
  return lines.join("\r\n");
}

// VP9 compresses noticeably better than VP8/H264 at the same visual
// quality -- the same lever YouTube, Twitch and Meet lean on for "good
// quality, less bandwidth". The SFU forwards RTP untouched (see
// publisher.go's OnTrack: it builds the relay track FROM whatever codec
// the offer negotiates), so it's already codec-agnostic -- nothing on
// the server needs to change for this. Safari has decoded VP9 since
// Safari 14 / iOS 14 (2020), and screen sharing only ever originates
// from a desktop browser (canShareScreen gates that), so the risk of a
// viewer stuck unable to decode this is low. Falls back to the
// browser's own default order (VP8/H264 first) wherever VP9 isn't
// offered at all -- a `setCodecPreferences` call only ever reorders,
// it can't force a codec neither side actually supports.
function preferVp9(pc: RTCPeerConnection) {
  if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) return;
  const caps = RTCRtpSender.getCapabilities("video");
  const vp9 = caps?.codecs.filter((c) => c.mimeType.toLowerCase() === "video/vp9") ?? [];
  if (vp9.length === 0) return; // no VP9 encoder in this browser -- default order stands
  const rest = caps!.codecs.filter((c) => c.mimeType.toLowerCase() !== "video/vp9");
  const transceiver = pc.getTransceivers().find((t) => t.sender.track?.kind === "video");
  try {
    transceiver?.setCodecPreferences([...vp9, ...rest]);
  } catch {
    // Wrong signaling state, or a combination the browser rejects --
    // the default negotiation order still works.
  }
}

export type Status = "connecting" | "connected" | "reconnecting" | "error" | "closed";
export type Source = "screen" | "camera";

export type Peer = { peerId: string; name: string; publishing: boolean };
export type KnockRequest = { requestId: string; name: string };

// Either credential admits on its own -- a password proves you were
// given one, an admit token proves someone already inside approved a
// knock instead. Never both at once: see useRoom's connect().
export type Credential = { password: string } | { admitToken: string };

// Mobile browsers -- iOS Safari and Chrome on Android alike -- don't
// implement getDisplayMedia: capturing a phone's screen from a web page
// isn't a thing. Checked once so the UI can offer the camera instead of
// a button that could only ever fail.
export const canShareScreen =
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

export const canShareCamera =
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

// Two peer connections with the server, and that's all, however many
// people are in the room:
//
//   publish   -- this browser's own stream going up. Created when you
//                start sharing; this side offers, because it's the one
//                that knows what it's about to send.
//   subscribe -- everyone else's streams coming down, multiplexed. The
//                SERVER offers on this one, since tracks appear and
//                vanish as people start and stop sharing.
//
// The mesh this replaced needed a connection per person and made the
// publisher encode separately for each of them, which is why a second
// viewer used to halve the framerate.
// displayName is only ever sent on a brand-new join (see connect()
// below) -- once the server has assigned an identity, a reconnect
// always resumes with the name it already gave out, chosen or not.
// What startSharing resolves with: the capture either happened (the
// dialog closes, the tile lights up) or it didn't. A null error means
// "the person backed out" -- dismissing the picker is not a failure and
// must not be reported as one.
export type ShareStartResult = { started: boolean; error: string | null };

export function useRoom(roomId: string, credential: Credential, displayName?: string) {
  // Pulled out as primitives rather than depending on `credential`
  // itself below -- a caller passing a fresh object literal every
  // render (the common case) would otherwise reconnect the WebSocket
  // on every render instead of only when the actual value changes.
  const credentialPassword = "password" in credential ? credential.password : undefined;
  const credentialAdmitToken = "admitToken" in credential ? credential.admitToken : undefined;

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [you, setYou] = useState<{ peerId: string; name: string } | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  // Requests to enter without the password -- broadcast to everyone
  // currently in the room, answered by whoever gets there first.
  const [knockRequests, setKnockRequests] = useState<KnockRequest[]>([]);
  // The idle reaper's countdown: unix ms when the room closes for
  // everyone, null when nothing is pending. 0 from the server means "a
  // previously announced closing was withdrawn".
  const [closingAt, setClosingAt] = useState<number | null>(null);
  // The room was closed for real (idle, or deleted): the page navigates
  // home when this flips.
  const [roomClosed, setRoomClosed] = useState(false);
  // The room's shared stage choice: whoever is pinned in the spotlight
  // ("" from the server = none). A newcomer's welcome carries it, so
  // they land watching what everyone else is watching.
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [sendingAudio, setSendingAudio] = useState(true);
  const [quality, setQuality] = useState<Quality>("source");
  const [fps, setFps] = useState<Fps>("source");
  const [surface, setSurface] = useState<DisplaySurface>("window");

  const wsRef = useRef<WebSocket | null>(null);
  const publishRef = useRef<RTCPeerConnection | null>(null);
  const subscribeRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingLeaveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Which offer the publish connection last sent. Answers carry the
  // number back; replies for a connection that a re-share already
  // replaced must not describe the replacement's SDP.
  const publishSeqRef = useRef(0);
  // One capture → one recovery attempt. Unlimited auto-retry against a
  // genuinely dead uplink is a tempting way to loop publish:offer at the
  // server.
  const retriedRef = useRef(false);
  // Dismissed the moment sharing starts; guards double-clicks and the
  // welcome-republish race, both of which used to open two pickers or
  // juggle two offers.
  const startingRef = useRef(false);
  // Signals travel over the WebSocket one at a time, but handlers run
  // concurrently: two subscribe:offers (someone joining as another person
  // starts sharing) used to drive setRemoteDescription on the same peer
  // connection in parallel. Answers are serialized through this chain.
  const subscribeChainRef = useRef<Promise<void>>(Promise.resolve());
  // Set below -- publishStream's connection-state handler needs to reach
  // the recovery path, which is itself defined in terms of publishStream.
  const republishRef = useRef<(reason: string) => void>(() => {});
  // Read inside the WebSocket callbacks, which are created once and
  // would otherwise close over stale values.
  const sendingAudioRef = useRef(true);
  sendingAudioRef.current = sendingAudio;
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const qualityRef = useRef<Quality>("source");
  qualityRef.current = quality;
  const fpsRef = useRef<Fps>("source");
  fpsRef.current = fps;
  const surfaceRef = useRef<DisplaySurface>("window");
  surfaceRef.current = surface;
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  remoteStreamsRef.current = remoteStreams;
  // Mirrored for the same reason remoteStreamsRef is: the WebSocket
  // callbacks were created once and would otherwise close over stale
  // state.
  const youRef = useRef<{ peerId: string; name: string } | null>(null);
  youRef.current = you;
  // Publishers whose video this viewer asked NOT to receive, keyed by
  // peer id. The server's per-viewer opt-outs live on its Subscriber,
  // which dies with every WebSocket -- so the ref is what re-asserts the
  // list after each reconnect (see the welcome handler). Not pruned on
  // peer:leave: a blip must not flip someone's video back on, and stale
  // ids are inert.
  const videoOffPeersRef = useRef<Set<string>>(new Set());
  const [videoOffPeers, setVideoOffPeers] = useState<Set<string>>(new Set());
  // Which simulcast layer ("high"/"low") this viewer wants of each
  // publisher's video, keyed by publisher peer id. Missing means "high"
  // -- same default the server assumes (see subscriber.go). Driven by
  // useLayerAutoSwitch below, reacting to this viewer's own connection;
  // re-asserted after a reconnect for the same reason videoOffPeersRef
  // is: the server's Subscriber (and its layer choice) dies with the
  // WebSocket, and a network blip shouldn't hand a struggling viewer
  // back the heavy layer just because the connection blipped.
  const videoLayerRef = useRef<Record<string, "high" | "low">>({});
  const [videoLayer, setVideoLayer] = useState<Record<string, "high" | "low">>({});

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const cancelPendingLeave = useCallback((peerId: string) => {
    const timer = pendingLeaveRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      pendingLeaveRef.current.delete(peerId);
    }
  }, []);

  const dropRemote = useCallback((peerId: string) => {
    setRemoteStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  // --- publishing ---

  // Caps what this browser sends and tells the encoder what to give up
  // when it can't keep up. The tradeoff follows the content, via the
  // contentHint startSharing already sets: "detail" (slides, docs --
  // the explicit low-fps picks) protects sharpness, because a soft
  // frame drop there is less noticeable than the text going mushy;
  // everything else ("motion" -- 30/60/Original, camera) protects the
  // frame rate, because a stutter is the loudest artifact on anything
  // that moves.
  const applyEncodingLimits = useCallback((pc: RTCPeerConnection | null) => {
    if (!pc) return;
    const src = sourceRef.current ?? "screen";
    const q = qualityRef.current;
    const f = fpsRef.current;
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const settings = sender.track.getSettings();
      const bitrate = bitrateFor(src, q, f, settings);
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      for (const encoding of params.encodings) {
        // The simulcast "low" layer is a fixed floor tier set once at
        // publishStream time (see its sendEncodings) -- it doesn't grow
        // or shrink with the chosen quality, that's the whole point of
        // having a floor. Only the "high" layer (or the lone encoding,
        // rid "" outside simulcast) follows the picked quality/fps.
        if (encoding.rid === "low") continue;
        encoding.maxBitrate = bitrate;
        // Two levers beyond bitrate make quality changes apply live
        // without recapturing: cap the encoder's own output rate, and
        // have it scale captured frames down to the chosen size.
        if (f !== "source") encoding.maxFramerate = f;
        else delete encoding.maxFramerate;
        const scale = scaleResolutionDownByFor(settings, q);
        if (scale) encoding.scaleResolutionDownBy = scale;
        else delete encoding.scaleResolutionDownBy;
      }
      params.degradationPreference =
        sender.track.contentHint === "detail" ? "maintain-resolution" : "maintain-framerate";
      // Best-effort: not every browser accepts every field, and a
      // rejected tuning shouldn't break the connection -- but a flat
      // swallow would hide a total failure to e.g. save bandwidth.
      sender.setParameters(params).catch(() => console.warn("o encoder ignorou um ajuste de qualidade"));
    }
  }, []);

  const stopSharing = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSource(null);
    sourceRef.current = null;
    publishRef.current?.close();
    publishRef.current = null;
    retriedRef.current = false;
    send({ type: "publish:stop" });
  }, [send]);

  // Wire up and offer one publish connection for an already-captured
  // stream. Both the capture path and the failed-uplink recovery land
  // here; the source was already committed to sourceRef by whoever
  // captured.
  const publishStream = useCallback(
    async (stream: MediaStream) => {
      // Replace rather than stack, so switching from screen to camera
      // doesn't leave the previous connection running.
      publishRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      publishRef.current = pc;
      const seq = ++publishSeqRef.current;

      for (const track of stream.getTracks()) {
        if (track.kind === "video" && sourceRef.current === "screen" && qualityRef.current === "source") {
          // Simulcast: two encodings of the SAME track under one m-line,
          // so the SFU can hand each viewer the layer THEIR connection
          // can carry (see subscriber.go's per-viewer layer selection)
          // instead of everyone fighting over one stream sized for the
          // best case. Chrome supports this for screen capture; Firefox
          // needs 134+ and Safari's simulcast support is limited --
          // both just collapse to a single layer silently, never an
          // error, so a viewer on an older browser loses nothing but the
          // adaptive floor. Only for Original quality: an explicit
          // resolution pick (360p...) is already its own low tier, a
          // second layer under it buys nothing.
          pc.addTransceiver(track, {
            direction: "sendonly",
            streams: [stream],
            sendEncodings: [
              { rid: "high" },
              // A fixed floor, not sized off the chosen quality --
              // applyEncodingLimits skips this rid entirely.
              { rid: "low", scaleResolutionDownBy: 4, maxBitrate: 350_000, maxFramerate: 15 },
            ],
          });
        } else {
          pc.addTrack(track, stream);
        }
      }
      preferVp9(pc);
      applyEncodingLimits(pc);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) send({ type: "publish:ice", candidate: ev.candidate.toJSON() });
      };
      // A fallen uplink used to be invisible -- the tile kept saying the
      // stream was live while nothing moved since the last answer.
      // `failed` is the browser's last word on ICE, so this is the one
      // moment recovery cannot happen without help.
      pc.onconnectionstatechange = () => {
        if (publishRef.current !== pc) return; // superseded by a newer share
        if (pc.connectionState === "failed") {
          republishRef.current("a transmissão caiu — tente compartilhar de novo");
        }
      };

      const offer = await pc.createOffer();
      // Munge before sealing: the answer negotiated against THIS offer
      // is what configures the encoder, so the boosted fmtp has to be
      // in the SDP we put local, not in one we merely inspected.
      await pc.setLocalDescription({ type: offer.type, sdp: boostOpusSdp(offer.sdp ?? "") });
      // The offer is numbered; the answer comes back with the same
      // number, and answers for superseded connections are dropped.
      send({ type: "publish:offer", seq, sdp: pc.localDescription });
    },
    [applyEncodingLimits, send],
  );

  const republish = useCallback(
    (reason: string) => {
      const stream = localStreamRef.current;
      if (!stream || retriedRef.current) {
        setErrorMessage(reason);
        return;
      }
      retriedRef.current = true;
      void publishStream(stream);
    },
    [publishStream],
  );
  republishRef.current = republish;

  const startSharing = useCallback(
    async (
      from: Source,
      newQuality?: Quality,
      newFps?: Fps,
      newSurface?: DisplaySurface,
    ): Promise<ShareStartResult> => {
      if (startingRef.current) return { started: false, error: null };
      startingRef.current = true;
      try {
        // Committed to refs before anything async runs, so the capture
        // and the connection it feeds agree -- and so changing settings
        // here never recreates this callback and never touches the
        // WebSocket's effect (quality and its friends are read through
        // refs, not closed over).
        if (newQuality !== undefined) {
          setQuality(newQuality);
          qualityRef.current = newQuality;
        }
        if (newFps !== undefined) {
          setFps(newFps);
          fpsRef.current = newFps;
        }
        if (newSurface !== undefined) {
          setSurface(newSurface);
          surfaceRef.current = newSurface;
        }
        retriedRef.current = false;
        const q = qualityRef.current;
        const f = fpsRef.current;
        const s = surfaceRef.current;

        setErrorMessage(null);
        let stream: MediaStream;
        try {
          const videoConstraints = videoConstraintsFor(from, q, f, s);
          stream =
            from === "screen"
              ? await navigator.mediaDevices.getDisplayMedia(gdmOptions(videoConstraints, s))
              : await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
        } catch (err) {
          const name = err instanceof Error ? err.name : "Error";
          // Capture failures are the caller's to display (they belong on
          // the panel that asked for the capture), so they are returned
          // rather than routed to the room-wide banner. Backing out of
          // the picker is a normal thing to do, not an error.
          if (name === "AbortError") return { started: false, error: null };
          if (name === "NotAllowedError") {
            return { started: false, error: "permissão negada — o compartilhamento não foi autorizado" };
          }
          return { started: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        }

        // Tells the encoder what this footage actually is. "detail"
        // keeps text sharp AT THE COST OF FRAMERATE -- right for slides
        // and docs (the explicit low-fps picks), wrong for anything
        // moving, where a stutter is the loudest artifact. 30/60/source
        // get "motion": keep the frames flowing.
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.contentHint = from === "screen" && (f === 5 || f === 15) ? "detail" : "motion";
        }
        // getDisplayMedia only yields audio if the person also ticked
        // "share audio", so there may be nothing here to touch.
        for (const track of stream.getAudioTracks()) {
          track.enabled = sendingAudioRef.current;
          // Display audio is content, not speech: the "music" hint
          // steers Chrome's Opus encoder away from the mono speech
          // budget (and its heavy voice FEC) that makes it sound
          // robotic. A camera's mic keeps its voice treatment.
          if (from === "screen") track.contentHint = "music";
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        setSource(from);
        sourceRef.current = from;
        // The browser's own "Stop sharing" bar ends the track.
        videoTrack?.addEventListener("ended", () => stopSharing());

        // Same swallow as the welcome republish: a publish connection
        // that dies right away is the failed-uplink recovery's problem,
        // not the dialog's.
        await publishStream(stream).catch(() => {});
        return { started: true, error: null };
      } finally {
        startingRef.current = false;
      }
    },
    [publishStream, send, stopSharing],
  );

  // Mid-stream quality change: re-tunes the live connection's encoders.
  // No recapture, no renegotiation, nothing touches the server. Shrinking
  // is real -- the encoder scales frames down immediately -- but growing
  // past what was captured can't happen through setParameters, so the UI
  // re-shares for that instead.
  const applyQuality = useCallback(
    (q: Quality, f: Fps) => {
      setQuality(q);
      setFps(f);
      qualityRef.current = q;
      fpsRef.current = f;
      applyEncodingLimits(publishRef.current);
    },
    [applyEncodingLimits],
  );

  const setAudio = useCallback((on: boolean) => {
    setSendingAudio(on);
    // Disabling the track sends silence, which needs no renegotiation;
    // removing it would mean rebuilding the publish connection.
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) track.enabled = on;
  }, []);

  // Stop (or restore) ONE publisher's video on the server, where the
  // saving is real: the SFU stops forwarding those frames to this
  // browser instead of this browser decoding and throwing them away.
  // Optimistic on purpose -- the local set flips immediately so the UI
  // never waits on a renegotiation round trip, and re-asserting an
  // already-held state is harmless server-side (a remove with nothing
  // to remove negotiates nothing).
  const setPublisherVideo = useCallback(
    (publisherId: string, enabled: boolean) => {
      const next = new Set(videoOffPeersRef.current);
      if (enabled) next.delete(publisherId);
      else next.add(publisherId);
      videoOffPeersRef.current = next;
      setVideoOffPeers(next);
      send({ type: "subscribe:video", publisherId, enabled });
    },
    [send],
  );

  // Which simulcast layer this viewer gets of one publisher's video.
  // Asking for "low" on a publisher who isn't simulcasting (a camera
  // share, or a screen share at an explicit quality) is a harmless
  // no-op server-side (see SetPublisherVideoLayer) -- callers never
  // need to know in advance whether a layer actually exists.
  const setPublisherVideoLayer = useCallback(
    (publisherId: string, rid: "high" | "low") => {
      if (videoLayerRef.current[publisherId] === rid) return;
      const next = { ...videoLayerRef.current, [publisherId]: rid };
      videoLayerRef.current = next;
      setVideoLayer(next);
      send({ type: "subscribe:layer", publisherId, rid });
    },
    [send],
  );

  // The client-driven half of simulcast: watches THIS viewer's own
  // receive connection for sustained packet loss on each publisher's
  // video and asks the server for the low layer instead -- reactive to
  // what's actually arriving, not a bandwidth estimate. Deliberately
  // simple (loss-rate + hysteresis, no GCC/REMB-style prediction): a
  // heuristic that's wrong occasionally and easy to reason about beats
  // one that's usually-right and opaque, especially right after the
  // last "smarter" quality change made things worse. Runs for every
  // publisher uniformly -- asking a publisher who isn't simulcasting
  // for "low" is a no-op server-side (see SetPublisherVideoLayer's Go
  // doc comment), so this never needs to know in advance who qualifies.
  useEffect(() => {
    if (!LAYER_AUTO_SWITCH_ENABLED) return;
    // Consecutive bad/clean windows per publisher -- local to this
    // effect instance, reset on every reconnect along with everything
    // else the subscribe connection carries.
    const badStreak = new Map<string, number>();
    const cleanStreak = new Map<string, number>();
    const prevCounts = new Map<string, { lost: number; received: number }>();

    const tick = async () => {
      const pc = subscribeRef.current;
      if (!pc || pc.connectionState !== "connected") return;
      let report: RTCStatsReport;
      try {
        report = await pc.getStats();
      } catch {
        return;
      }
      // inbound-rtp's trackIdentifier is the id of the MediaStreamTrack
      // the browser created for it -- the same technique usePeerStats
      // uses to pick one tile's counters out of the shared subscribe
      // connection's report.
      const trackToPublisher = new Map<string, string>();
      for (const [peerId, stream] of Object.entries(remoteStreamsRef.current)) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) trackToPublisher.set(videoTrack.id, peerId);
      }

      report.forEach((s: any) => {
        if (s.type !== "inbound-rtp" || s.kind !== "video") return;
        const publisherId = trackToPublisher.get(s.trackIdentifier);
        if (!publisherId) return;
        const lost = typeof s.packetsLost === "number" ? s.packetsLost : 0;
        const received = typeof s.packetsReceived === "number" ? s.packetsReceived : 0;
        const prev = prevCounts.get(publisherId);
        prevCounts.set(publisherId, { lost, received });
        if (!prev) return; // first sample is only a baseline
        const dLost = lost - prev.lost;
        const dReceived = received - prev.received;
        if (dLost < 0 || dReceived < 0) return; // counters reset -- a renegotiation landed; skip this window
        const total = dLost + dReceived;
        const lossPct = total > 0 ? (dLost * 100) / total : 0;

        const currentLayer = videoLayerRef.current[publisherId] ?? "high";
        if (lossPct > LAYER_DOWNGRADE_LOSS_PCT) {
          cleanStreak.delete(publisherId);
          const streak = (badStreak.get(publisherId) ?? 0) + 1;
          badStreak.set(publisherId, streak);
          if (currentLayer !== "low" && streak >= LAYER_DOWNGRADE_WINDOWS) {
            setPublisherVideoLayer(publisherId, "low");
          }
          return;
        }
        badStreak.delete(publisherId);
        if (currentLayer !== "low") return;
        const streak = (cleanStreak.get(publisherId) ?? 0) + 1;
        cleanStreak.set(publisherId, streak);
        if (streak >= LAYER_UPGRADE_CLEAN_WINDOWS) {
          cleanStreak.delete(publisherId);
          setPublisherVideoLayer(publisherId, "high");
        }
      });
    };

    const timer = setInterval(() => void tick(), LAYER_POLL_MS);
    return () => clearInterval(timer);
  }, [setPublisherVideoLayer]);

  // Changing your own label. The server answers with the broadcast the
  // room sees plus a fresh resume token (handled in the peer:rename
  // case below).
  const rename = useCallback((name: string) => send({ type: "peer:rename", name }), [send]);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;

      // Reclaims the identity the server issued, so a reconnect slots
      // back into the room rather than arriving as a stranger. The
      // credential itself is sent on every attempt, resume included --
      // the server checks it unconditionally (see the Go side's
      // handleWS), resume only ever affects which identity you get,
      // never whether you get in at all.
      const saved = readIdentity(roomId);
      const ws = new WebSocket(
        wsUrl({
          room: roomId,
          ...(credentialPassword ? { password: credentialPassword } : { admitToken: credentialAdmitToken ?? "" }),
          ...(saved
            ? { peerId: saved.peerId, name: saved.name, resume: saved.resume }
            : displayName
              ? { name: displayName }
              : {}),
        }),
      );
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("reconnecting");
        // Jittered so a room full of people doesn't reconnect in
        // lockstep and stampede a server that just came back up.
        const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
        attempt++;
        retryTimer = setTimeout(connect, backoff * (0.5 + Math.random()));
      };

      ws.onerror = () => setStatus((s) => (s === "connecting" ? "error" : s));

      ws.onmessage = async (evt) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "welcome": {
            const myId = msg.peerId as string;
            const myName = msg.name as string;
            setYou({ peerId: myId, name: myName });
            // Written here as well as during render: a peer:rename for
            // this very connection could land before React re-renders.
            youRef.current = { peerId: myId, name: myName };
            rememberIdentity(roomId, { peerId: myId, name: myName, resume: (msg.resume as string) ?? "" });

            const list = (msg.peers as Peer[]) ?? [];
            setPeers(list);
            setKnockRequests(
              (msg.pendingKnocks as { id: string; name: string }[] | undefined)?.map((k) => ({
                requestId: k.id,
                name: k.name,
              })) ?? [],
            );
            // A closing warning that was already standing -- reconnecting
            // mid-warning must not hide the countdown.
            setClosingAt(typeof msg.closingAt === "number" && msg.closingAt > 0 ? (msg.closingAt as number) : null);
            // The room's stage, as the room sees it right now.
            setSpotlight((msg.spotlight as string) || null);

            const present = new Set(list.map((p) => p.peerId));
            for (const id of [...pendingLeaveRef.current.keys()]) {
              if (present.has(id)) cancelPendingLeave(id);
            }
            for (const id of Object.keys(remoteStreamsRef.current)) {
              if (!present.has(id)) dropRemote(id);
            }

            // The old Subscriber's per-viewer video opt-outs died with
            // the WebSocket that carried them -- re-assert each one so a
            // network blip doesn't turn every hidden video back on. Ids
            // of people who left for good are inert server-side.
            for (const id of videoOffPeersRef.current) {
              send({ type: "subscribe:video", publisherId: id, enabled: false });
            }
            // Same reasoning for layer choices: a fresh Subscriber
            // defaults everyone back to "high", so a struggling viewer
            // whose blip just triggered this reconnect would otherwise
            // get handed the heavy layer again for a few seconds until
            // the auto-switch heuristic notices and downgrades it back.
            for (const [id, rid] of Object.entries(videoLayerRef.current)) {
              if (rid !== "high") send({ type: "subscribe:layer", publisherId: id, rid });
            }

            // The receive side starts over too, publisher or not: the
            // server built a brand-new Subscriber for this connection,
            // and its offers carry a fresh m-line layout. Answering from
            // the previous peer connection fails the moment history
            // diverges ("the order of m-lines in subsequent offer doesn't
            // match") -- a failed answer means the tracks attach in SDP
            // but no media ever flows. Closing the old PC makes the next
            // subscribe:offer build a symmetric fresh one.
            subscribeRef.current?.close();
            subscribeRef.current = null;

            // A restarted server has forgotten everything, this
            // browser's publish connection included -- so republish.
            // The capture itself survived the disconnect (nobody called
            // stopSharing), so re-offer the same tracks instead of
            // making the person re-pick the window.
            if (localStreamRef.current && sourceRef.current) {
              await publishStream(localStreamRef.current).catch(() => {});
            }
            break;
          }

          case "peer:join": {
            const peer: Peer = { peerId: msg.peerId as string, name: msg.name as string, publishing: false };
            setPeers((current) => [...current.filter((p) => p.peerId !== peer.peerId), peer]);
            cancelPendingLeave(peer.peerId);
            break;
          }

          case "peer:leave": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.filter((p) => p.peerId !== peerId));
            // Deferred rather than immediate -- see LEAVE_GRACE_MS.
            cancelPendingLeave(peerId);
            pendingLeaveRef.current.set(
              peerId,
              setTimeout(() => {
                pendingLeaveRef.current.delete(peerId);
                dropRemote(peerId);
              }, LEAVE_GRACE_MS),
            );
            break;
          }

          case "peer:rename": {
            const peerId = msg.peerId as string;
            const name = msg.name as string;
            // Our own copy carries a fresh resume token: the token signs
            // the NAME along with the id, so the one we held stopped
            // verifying the instant the rename landed -- the next
            // reconnect must not go out carrying it.
            if (youRef.current?.peerId === peerId) {
              setYou({ peerId, name });
              youRef.current = { peerId, name };
              if (msg.resume) {
                rememberIdentity(roomId, { peerId, name, resume: msg.resume as string });
              }
              break;
            }
            setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, name } : p)));
            break;
          }

          case "publish:start":
            setPeers((current) =>
              current.map((p) => (p.peerId === msg.peerId ? { ...p, publishing: true } : p)),
            );
            break;

          case "publish:stop": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, publishing: false } : p)));
            dropRemote(peerId);
            break;
          }

          case "publish:answer": {
            const pc = publishRef.current;
            if (!pc || !msg.sdp) break;
            // An answer for a superseded offer (a fast re-share swapped
            // the connection) must not be applied to the replacement's
            // description -- it used to fail here, the failure was
            // swallowed, and the replacement never connected. Servers
            // that predate the numbering don't echo a seq at all; take
            // those as current.
            if (typeof msg.seq === "number" && msg.seq !== publishSeqRef.current) break;
            try {
              await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
            } catch (err) {
              console.error("publish:answer rejected", err);
              setErrorMessage("o servidor recusou a transmissão");
            }
            break;
          }

          case "publish:ice": {
            const pc = publishRef.current;
            if (pc && msg.candidate) {
              await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
            }
            break;
          }

          case "publish:error":
            setErrorMessage((msg.error as string) ?? "não foi possível transmitir");
            break;

          // The server offers on the receive side, and re-offers every
          // time someone starts or stops sharing.
          case "subscribe:offer": {
            const answerOffer = async () => {
              let pc = subscribeRef.current;
              if (!pc) {
                const fresh = new RTCPeerConnection({ iceServers: ICE_SERVERS });
                subscribeRef.current = fresh;
                fresh.onicecandidate = (ev) => {
                  if (ev.candidate) send({ type: "subscribe:ice", candidate: ev.candidate.toJSON() });
                };
                fresh.ontrack = (ev) => {
                  // The SFU tags every outgoing track with the publisher's
                  // peer id as its stream id, which is how a track is
                  // matched back to the person it came from.
                  const stream = ev.streams[0];
                  if (!stream) return;
                  setRemoteStreams((current) => ({ ...current, [stream.id]: stream }));
                };
                // There is no "resubscribe" message in the protocol: a
                // receive connection that gave up (ICE failed for good)
                // is only repairable by starting the session over. The
                // WebSocket's own reconnection does that, and the server
                // re-attaches every live track to the new subscriber.
                fresh.onconnectionstatechange = () => {
                  if (fresh.connectionState !== "failed") return;
                  fresh.close();
                  if (subscribeRef.current === fresh) subscribeRef.current = null;
                  wsRef.current?.close();
                };
                pc = fresh;
              }
              await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              send({ type: "subscribe:answer", sdp: pc.localDescription });
            };
            // ws.onmessage runs handlers concurrently -- an await in one
            // message's processing cannot stop the next message's. Two
            // offers in that window must still be applied in order, so
            // the whole sequence rides one chain.
            subscribeChainRef.current = subscribeChainRef.current
              .then(answerOffer, answerOffer)
              .catch((err) => console.error("subscribe negotiation failed", err));
            break;
          }

          // The server could not negotiate this viewer's receive side --
          // surface it on the room's error banner rather than leaving a
          // tile stuck on "connecting".
          case "subscribe:error":
            setErrorMessage((msg.error as string) ?? "falha ao negociar o vídeo recebido");
            break;

          case "subscribe:ice": {
            const pc = subscribeRef.current;
            if (pc && msg.candidate) {
              await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
            }
            break;
          }

          case "knock:request": {
            const req: KnockRequest = { requestId: msg.requestId as string, name: msg.name as string };
            setKnockRequests((current) => [...current.filter((k) => k.requestId !== req.requestId), req]);
            break;
          }

          // Resolved by anyone, including someone other than whoever's
          // looking at this tab -- the banner has to disappear here too,
          // not just for whoever clicked.
          case "knock:resolved": {
            const requestId = msg.requestId as string;
            setKnockRequests((current) => current.filter((k) => k.requestId !== requestId));
            break;
          }

          // The room's stage choice changed (set or cleared, "" = none).
          case "spotlight:set":
            setSpotlight((msg.peerId as string) || null);
            break;

          // The idle reaper's warning: a countdown until this room
          // closes for everyone. closingAt 0 means a warning someone
          // already saw was withdrawn -- hide it everywhere.
          case "room:closing":
            setClosingAt(typeof msg.closingAt === "number" && msg.closingAt > 0 ? (msg.closingAt as number) : null);
            break;

          // The room is gone server-side. Reconnecting would only 404,
          // so the page reads roomClosed and navigates home.
          case "room:closed":
            setClosingAt(null);
            setRoomClosed(true);
            break;

          // The room's reset button: something is wedged and every media
          // connection should be rebuilt. Closing the WebSocket IS the
          // whole implementation -- the reconnect below already replays
          // the server-restart recovery: the server closes this session's
          // publisher and subscriber, re-offers a fresh subscriber after
          // the resume, and the still-running capture is re-offered
          // as-is, so nobody is asked to re-pick their window. Only the
          // transport dies, briefly.
          case "room:reset":
            wsRef.current?.close();
            break;
        }
      };
    };

    connect();

    // Leaving the room for real.
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      for (const timer of pendingLeaveRef.current.values()) clearTimeout(timer);
      pendingLeaveRef.current.clear();
      wsRef.current?.close();
      publishRef.current?.close();
      subscribeRef.current?.close();
      publishRef.current = null;
      subscribeRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [roomId, credentialPassword, credentialAdmitToken, displayName, cancelPendingLeave, dropRemote, send, startSharing]);

  const approveKnock = useCallback((requestId: string) => send({ type: "knock:approve", requestId }), [send]);
  const denyKnock = useCallback((requestId: string) => send({ type: "knock:deny", requestId }), [send]);

  // The room-wide "reset" button: asks the server to tell everyone to
  // rebuild their media connections. This side does nothing itself --
  // the room:reset case above turns the echo into a reconnect, which is
  // the one path that genuinely rebuilds everything (including server
  // state) without anyone re-picking their capture.
  const resetRoom = useCallback(() => send({ type: "room:reset" }), [send]);

  // Pressing the button on the idle-closing popup: tells the reaper
  // this room is still wanted, which withdraws the countdown for
  // everyone.
  const keepAlive = useCallback(() => send({ type: "room:keepalive" }), [send]);

  // Pinning (or unpinning, null) one publisher as the room's stage.
  // Server-side state -- everyone sees the same stage. The UI updates
  // from the server's echo, so a client that disagrees is corrected
  // rather than fought.
  const setSpotlightPeer = useCallback(
    (peerId: string | null) => send({ type: "spotlight:set", publisherId: peerId ?? "" }),
    [send],
  );

  return {
    status,
    errorMessage,
    you,
    peers,
    remoteStreams,
    localStream,
    source,
    isSharing: localStream !== null,
    sendingAudio,
    setAudio,
    hasAudioTrack: (localStream?.getAudioTracks().length ?? 0) > 0,
    quality,
    fps,
    surface,
    setQuality,
    setFps,
    setSurface,
    applyQuality,
    startSharing,
    stopSharing,
    resetRoom,
    knockRequests,
    approveKnock,
    denyKnock,
    closingAt,
    roomClosed,
    keepAlive,
    spotlight,
    setSpotlightPeer,
    videoOffPeers,
    setPublisherVideo,
    // The simulcast layer each publisher's video is on for this viewer
    // (missing = "high"). Read-only from the UI's perspective today --
    // the auto-switch heuristic above drives it -- exposed mainly so a
    // manual override can be added later without touching the hook.
    videoLayer,
    setPublisherVideoLayer,
    rename,
    // The two peer connections, by ref (they're replaced on every
    // re-share/re-negotiation) -- the per-tile stats reader needs the
    // current one at poll time, not at render time.
    publishPcRef: publishRef,
    subscribePcRef: subscribeRef,
  };
}
