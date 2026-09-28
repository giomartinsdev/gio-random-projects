import { useCallback, useEffect, useRef, useState } from "react";
import { readIdentity, rememberIdentity, wsUrl } from "./api";
import { ScreenPublisher } from "./screenPublisher";
import { ScreenViewer } from "./screenViewer";
import {
  DEFAULT_SCREEN_QUALITY,
  loadScreenQuality,
  rememberScreenQuality,
  screenQualityPreset,
  type ScreenQualityConfig,
  type ScreenQualityPreset,
} from "./screenQuality";

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

// A viewer often reaches WHEP before the publisher's MediaMTX path is
// online, or an ICE/DTLS handshake misses its window. Bounded linear
// retry, not unlimited: the publisher may simply have stopped.
const VIEWER_MAX_ATTEMPTS = 4;
const VIEWER_RETRY_MS = 800;

// What the display picker should start on. Purely a hint to Chrome's own
// getDisplayMedia picker (Firefox and Safari pick their own defaults) --
// it saves a click, it doesn't enforce anything.
export type DisplaySurface = "monitor" | "window" | "browser";

export const SURFACE_OPTIONS: { value: DisplaySurface; label: string }[] = [
  { value: "monitor", label: "Tela inteira" },
  { value: "window", label: "Janela" },
  { value: "browser", label: "Aba" },
];

export type Status = "connecting" | "connected" | "reconnecting" | "error" | "closed";
export type Source = "screen" | "camera";

// hasAudio is only meaningful while publishing -- it decides whether a
// viewer asks MediaMTX for an audio m-line. Absent means "assume none".
export type Peer = { peerId: string; name: string; publishing: boolean; hasAudio?: boolean };
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

// Re-exported so the UI imports its quality types from one place.
export type { ScreenQualityConfig, ScreenQualityPreset } from "./screenQuality";
export {
  DEFAULT_SCREEN_QUALITY,
  screenQualityPreset,
  SCREEN_MODE_LABELS,
  SCREEN_MODE_FPS,
  SCREEN_RESOLUTIONS,
  loadScreenQuality,
} from "./screenQuality";

// What startSharing resolves with: the capture either happened (the
// dialog closes, the tile lights up) or it didn't. A null error means
// "the person backed out" -- dismissing the picker is not a failure and
// must not be reported as one.
export type ShareStartResult = { started: boolean; error: string | null };

// A subscribe failure the client must not retry -- the publisher isn't
// live, or the server refused for a permanent reason. Anything else (a
// transient handshake miss) is retryable.
class TerminalSubscribeError extends Error {}

// A publish handshake the server flagged as a transient MediaMTX miss.
class RetryablePublishError extends Error {}

// The browser's capture constraints for a screen preset. Width/height are
// ideal, not exact: a window smaller than the target still shares what it
// has, and an ultrawide monitor keeps its full width rather than being
// letterboxed into the target aspect.
function screenCaptureConstraints(preset: ScreenQualityPreset): MediaTrackConstraints {
  return {
    width: { ideal: preset.capture.width },
    height: { ideal: preset.capture.height },
    frameRate: { ideal: preset.capture.frameRate, max: preset.capture.frameRate },
  };
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
    // cancellation, noise suppression, AGC), which reads sustained tones
    // as "stationary noise" and pumps the gain: the robotic, underwater
    // artifact people hear on shared music. The AEC can't work on
    // loopback audio anyway, so there's nothing to lose here.
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
    // friends out of the mix, audible to the sharer alone.
    windowAudio: surface === "window" ? "window" : undefined,
  } as DisplayMediaStreamOptions;
}

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
  // One remote MediaStream per publishing peer, keyed by peer id. A
  // publisher can start, stop and restart; each is its own WHEP pull.
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [sendingAudio, setSendingAudio] = useState(true);
  // The quality model (mode/resolution/fps), not a raw resolution+fps
  // pair -- see screenQuality.ts. The surface is only a capture hint.
  const [quality, setQuality] = useState<ScreenQualityConfig>(loadScreenQuality);
  const [surface, setSurface] = useState<DisplaySurface>("window");
  // A purely local hide: MediaMTX has no per-subscriber opt-out, so this
  // disables the remote tracks in THIS browser rather than asking the
  // server to stop forwarding them.
  const [videoOffPeers, setVideoOffPeers] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  // This browser's own share: one WHIP publisher for the room.
  const publisherRef = useRef<ScreenPublisher | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // One WHEP viewer per remote publishing peer, by peer id.
  const viewersRef = useRef<Map<string, ScreenViewer>>(new Map());
  const pendingLeaveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // The publish offer currently awaiting the server's answer, correlated
  // by seq: an answer for a superseded offer (a fast re-share swapped
  // the publisher) must not resolve the replacement.
  const pendingPublishRef = useRef<{
    seq: number;
    resolve: (sdp: string) => void;
    reject: (err: Error) => void;
  } | null>(null);
  // Subscribe offers awaiting answers, by publisher peer id.
  const pendingSubscribeRef = useRef<
    Map<string, { seq: number; resolve: (sdp: string) => void; reject: (err: Error) => void }>
  >(new Map());
  // Whether each publishing peer's feed carries audio, from publish:start
  // / welcome. A viewer only asks MediaMTX for an audio m-line when this
  // says so; absent means none.
  const peerAudioRef = useRef<Record<string, boolean>>({});
  const publishSeqRef = useRef(0);
  const subscribeSeqRef = useRef(0);
  // One capture → one recovery attempt. Unlimited auto-retry against a
  // genuinely dead uplink is a tempting way to loop publish:offer.
  const retriedRef = useRef(false);
  // Dismissed the moment sharing starts; guards double-clicks and the
  // welcome-republish race.
  const startingRef = useRef(false);
  // Set below -- the publisher's connection-state handler needs to reach
  // the recovery path, which is itself defined in terms of publishStream.
  const republishRef = useRef<(reason: string) => void>(() => {});
  // Read inside the WebSocket callbacks, which are created once and
  // would otherwise close over stale values.
  const sendingAudioRef = useRef(true);
  sendingAudioRef.current = sendingAudio;
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const qualityRef = useRef<ScreenQualityConfig>(DEFAULT_SCREEN_QUALITY);
  qualityRef.current = quality;
  const surfaceRef = useRef<DisplaySurface>("window");
  surfaceRef.current = surface;
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  remoteStreamsRef.current = remoteStreams;
  const videoOffPeersRef = useRef<Set<string>>(new Set());
  videoOffPeersRef.current = videoOffPeers;
  // Mirrored for the same reason remoteStreamsRef is: the WebSocket
  // callbacks were created once and would otherwise close over stale
  // state.
  const youRef = useRef<{ peerId: string; name: string } | null>(null);
  youRef.current = you;

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

  // Apply this browser's local hide to a remote stream's video tracks.
  const applyLocalVideoOff = useCallback((peerId: string, stream: MediaStream) => {
    const off = videoOffPeersRef.current.has(peerId);
    for (const track of stream.getVideoTracks()) track.enabled = !off;
  }, []);

  // --- publishing ---

  const stopPublishingTransport = useCallback(() => {
    publisherRef.current?.stop();
    publisherRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingPublishRef.current = null;
    send({ type: "publish:stop" });
  }, [send]);

  const stopSharing = useCallback(() => {
    setLocalStream(null);
    setSource(null);
    sourceRef.current = null;
    retriedRef.current = false;
    stopPublishingTransport();
  }, [stopPublishingTransport]);

  // Wire up and publish an already-captured stream over WHIP. Both the
  // capture path and the failed-uplink recovery land here; the source was
  // already committed to sourceRef by whoever captured.
  const publishStream = useCallback(
    async (stream: MediaStream) => {
      publisherRef.current?.stop();
      const preset = screenQualityPreset(qualityRef.current);

      const attemptPublish = () => {
        const seq = ++publishSeqRef.current;
        const exchange = (offer: string) =>
          new Promise<string>((resolve, reject) => {
            pendingPublishRef.current = { seq, resolve, reject };
            send({ type: "publish:offer", seq, sdp: offer });
          });
        const publisher = new ScreenPublisher({
          exchange,
          onEnded: () => stopSharing(),
          onBroken: () => republishRef.current("a transmissão caiu — tente compartilhar de novo"),
        });
        publisherRef.current = publisher;
        return publisher.start(stream, preset);
      };

      // A transient MediaMTX handshake miss (the server flags it
      // retryable) is worth a bounded retry; the publisher may simply
      // have raced the media server.
      for (let attempt = 1; ; attempt++) {
        try {
          await attemptPublish();
          return;
        } catch (err) {
          if (attempt >= VIEWER_MAX_ATTEMPTS || !(err instanceof RetryablePublishError)) throw err;
          await new Promise((r) => setTimeout(r, VIEWER_RETRY_MS));
        }
      }
    },
    [send, stopSharing],
  );

  const republish = useCallback(
    (reason: string) => {
      const stream = localStreamRef.current;
      if (!stream || retriedRef.current) {
        setErrorMessage(reason);
        return;
      }
      retriedRef.current = true;
      void publishStream(stream).catch(() => {});
    },
    [publishStream],
  );
  republishRef.current = republish;

  const startSharing = useCallback(
    async (
      from: Source,
      newQuality?: ScreenQualityConfig,
      newSurface?: DisplaySurface,
    ): Promise<ShareStartResult> => {
      if (startingRef.current) return { started: false, error: null };
      startingRef.current = true;
      try {
        // Committed to refs before anything async runs, so the capture
        // and the connection it feeds agree -- and so changing settings
        // here never recreates this callback and never touches the
        // WebSocket's effect.
        if (newQuality !== undefined) {
          setQuality(newQuality);
          qualityRef.current = newQuality;
          rememberScreenQuality(newQuality);
        }
        if (newSurface !== undefined) {
          setSurface(newSurface);
          surfaceRef.current = newSurface;
        }
        retriedRef.current = false;
        const s = surfaceRef.current;
        const preset = screenQualityPreset(qualityRef.current);

        setErrorMessage(null);
        let stream: MediaStream;
        try {
          stream =
            from === "screen"
              ? await navigator.mediaDevices.getDisplayMedia(gdmOptions(screenCaptureConstraints(preset), s))
              : await navigator.mediaDevices.getUserMedia({
                  video: { facingMode: { ideal: "environment" } },
                  audio: true,
                });
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
        // keeps text sharp at the cost of frame rate -- right for slides
        // and docs; "motion" keeps the frames flowing.
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.contentHint = preset.contentHint;
        // getDisplayMedia only yields audio if the person also ticked
        // "share audio", so there may be nothing here to touch.
        for (const track of stream.getAudioTracks()) {
          track.enabled = sendingAudioRef.current;
          // Display audio is content, not speech: the "music" hint
          // steers Chrome's Opus encoder away from the mono speech
          // budget that makes it sound robotic.
          if (from === "screen") track.contentHint = "music";
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        setSource(from);
        sourceRef.current = from;

        await publishStream(stream).catch((err) => {
          // The publisher's onBroken/recovery owns a dead uplink; a
          // failed first handshake is surfaced here instead.
          setErrorMessage(err instanceof Error ? err.message : "não foi possível transmitir");
        });
        return { started: true, error: null };
      } finally {
        startingRef.current = false;
      }
    },
    [publishStream],
  );

  // Mid-stream quality change: re-tunes the live publisher's encoder.
  // No recapture, no renegotiation, nothing touches the server. Shrinking
  // is real -- the encoder scales frames down immediately -- but growing
  // past what was captured can't happen through setParameters, so the UI
  // re-shares for that.
  const applyQuality = useCallback((config: ScreenQualityConfig) => {
    setQuality(config);
    qualityRef.current = config;
    rememberScreenQuality(config);
    const preset = screenQualityPreset(config);
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = preset.contentHint;
      void videoTrack.applyConstraints(screenCaptureConstraints(preset)).catch(() => undefined);
    }
    void publisherRef.current?.applyPreset(preset);
  }, []);

  const setAudio = useCallback((on: boolean) => {
    setSendingAudio(on);
    // Disabling the track sends silence, which needs no renegotiation.
    publisherRef.current?.setAudioEnabled(on);
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) track.enabled = on;
  }, []);

  // Stop (or restore) ONE publisher's video locally. MediaMTX forwards
  // whatever is published to every viewer, so there is no server-side
  // opt-out; disabling the remote tracks here is the honest equivalent.
  const setPublisherVideo = useCallback((publisherId: string, enabled: boolean) => {
    const next = new Set(videoOffPeersRef.current);
    if (enabled) next.delete(publisherId);
    else next.add(publisherId);
    videoOffPeersRef.current = next;
    setVideoOffPeers(next);
    const stream = remoteStreamsRef.current[publisherId];
    if (stream) for (const track of stream.getVideoTracks()) track.enabled = enabled;
  }, []);

  // --- subscribing ---

  const stopViewer = useCallback(
    (peerId: string) => {
      const viewer = viewersRef.current.get(peerId);
      if (viewer) {
        viewer.stop();
        viewersRef.current.delete(peerId);
      }
      const pending = pendingSubscribeRef.current.get(peerId);
      pendingSubscribeRef.current.delete(peerId);
      pending?.reject(new TerminalSubscribeError("transmissão encerrada"));
      if (peerId !== youRef.current?.peerId) dropRemote(peerId);
    },
    [dropRemote],
  );

  // Pull one publisher's share over WHEP, with bounded retry for the
  // window where the viewer reaches MediaMTX before the publisher.
  const startViewer = useCallback(
    async (peerId: string) => {
      if (viewersRef.current.has(peerId)) return;
      if (peerId === youRef.current?.peerId) return; // own share is local
      const stream = new MediaStream();
      let attempt = 0;

      const connect = async (): Promise<void> => {
        attempt += 1;
        const seq = ++subscribeSeqRef.current;
        const exchange = (offer: string) =>
          new Promise<string>((resolve, reject) => {
            pendingSubscribeRef.current.set(peerId, { seq, resolve, reject });
            send({ type: "subscribe:offer", seq, publisherId: peerId, sdp: offer });
          });
        const viewer = new ScreenViewer({
          exchange,
          // Only ask for an audio m-line when the publisher's own SDP
          // said the feed has one.
          hasAudio: peerAudioRef.current[peerId] === true,
          onEnded: () => stopViewer(peerId),
          onBroken: () => stopViewer(peerId),
        });
        viewersRef.current.set(peerId, viewer);
        try {
          await viewer.start(stream);
          applyLocalVideoOff(peerId, stream);
          setRemoteStreams((current) => ({ ...current, [peerId]: stream }));
        } catch (err) {
          viewer.stop();
          viewersRef.current.delete(peerId);
          pendingSubscribeRef.current.delete(peerId);
          const retryable = attempt < VIEWER_MAX_ATTEMPTS && !(err instanceof TerminalSubscribeError);
          if (retryable) {
            await new Promise((r) => setTimeout(r, VIEWER_RETRY_MS));
            return connect();
          }
        }
      };

      await connect().catch(() => undefined);
    },
    [applyLocalVideoOff, send, stopViewer],
  );

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
      // the server checks it unconditionally, resume only ever affects
      // which identity you get, never whether you get in at all.
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

            // The server forgot everything on the way back up: the
            // publisher this browser owns and every viewer it held are
            // gone. Rebuild both from the roster.
            for (const id of [...viewersRef.current.keys()]) stopViewer(id);
            for (const peer of list) {
              if (peer.publishing) {
                peerAudioRef.current[peer.peerId] = peer.hasAudio === true;
                if (peer.peerId !== myId) void startViewer(peer.peerId);
              }
            }

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
            stopViewer(peerId);
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
            // verifying the instant the rename landed.
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

          case "publish:start": {
            const peerId = msg.peerId as string;
            const hasAudio = msg.hasAudio === true;
            peerAudioRef.current[peerId] = hasAudio;
            setPeers((current) =>
              current.map((p) => (p.peerId === peerId ? { ...p, publishing: true, hasAudio } : p)),
            );
            if (peerId !== youRef.current?.peerId) void startViewer(peerId);
            break;
          }

          case "publish:stop": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, publishing: false } : p)));
            stopViewer(peerId);
            dropRemote(peerId);
            break;
          }

          case "publish:answer": {
            const pending = pendingPublishRef.current;
            if (!pending) break;
            // An answer for a superseded offer (a fast re-share swapped
            // the publisher) must not resolve the replacement.
            if (typeof msg.seq === "number" && msg.seq !== pending.seq) break;
            pendingPublishRef.current = null;
            pending.resolve((msg.sdp as string) ?? "");
            break;
          }

          case "publish:error": {
            const message = (msg.error as string) ?? "não foi possível transmitir";
            const err = msg.retryable === true ? new RetryablePublishError(message) : new Error(message);
            if (pendingPublishRef.current) {
              const pending = pendingPublishRef.current;
              pendingPublishRef.current = null;
              pending.reject(err);
            } else {
              setErrorMessage(message);
            }
            break;
          }

          case "subscribe:answer": {
            const peerId = msg.publisherId as string;
            const pending = pendingSubscribeRef.current.get(peerId);
            if (!pending) break;
            if (typeof msg.seq === "number" && msg.seq !== pending.seq) break;
            pendingSubscribeRef.current.delete(peerId);
            pending.resolve(msg.sdp as string);
            break;
          }

          case "subscribe:error": {
            const peerId = msg.publisherId as string;
            const pending = pendingSubscribeRef.current.get(peerId);
            pendingSubscribeRef.current.delete(peerId);
            // A permanent refusal (the publisher isn't live) is terminal;
            // a transient MediaMTX miss is retryable.
            const terminal = msg.retryable !== true;
            const message = (msg.error as string) ?? "falha ao receber a transmissão";
            pending?.reject(terminal ? new TerminalSubscribeError(message) : new Error(message));
            break;
          }

          case "knock:request": {
            const req: KnockRequest = { requestId: msg.requestId as string, name: msg.name as string };
            setKnockRequests((current) => [...current.filter((k) => k.requestId !== req.requestId), req]);
            break;
          }

          // Resolved by anyone, including someone other than whoever's
          // looking at this tab -- the banner has to disappear here too.
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
          // already saw was withdrawn.
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
          // whole implementation -- the reconnect below replays the
          // server-restart recovery: viewers are rebuilt, and the
          // still-running capture is re-offered as-is. Only the transport
          // dies, briefly.
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
      publisherRef.current?.stop();
      publisherRef.current = null;
      for (const viewer of viewersRef.current.values()) viewer.stop();
      viewersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [
    roomId,
    credentialPassword,
    credentialAdmitToken,
    displayName,
    cancelPendingLeave,
    dropRemote,
    send,
    startViewer,
    stopViewer,
    publishStream,
  ]);

  const approveKnock = useCallback((requestId: string) => send({ type: "knock:approve", requestId }), [send]);
  const denyKnock = useCallback((requestId: string) => send({ type: "knock:deny", requestId }), [send]);

  // The room-wide "reset" button: asks the server to tell everyone to
  // rebuild their media connections. This side does nothing itself --
  // the room:reset case above turns the echo into a reconnect.
  const resetRoom = useCallback(() => send({ type: "room:reset" }), [send]);

  // Pressing the button on the idle-closing popup: tells the reaper
  // this room is still wanted.
  const keepAlive = useCallback(() => send({ type: "room:keepalive" }), [send]);

  // Pinning (or unpinning, null) one publisher as the room's stage.
  // Server-side state -- everyone sees the same stage.
  const setSpotlightPeer = useCallback(
    (peerId: string | null) => send({ type: "spotlight:set", publisherId: peerId ?? "" }),
    [send],
  );

  // This browser's publish connection (replaced on every re-share) -- the
  // per-tile stats reader needs the current one at poll time.
  const getPublishPc = useCallback(() => publisherRef.current?.connection ?? null, []);
  // One WHEP connection per publisher, by peer id.
  const getViewerPc = useCallback((peerId: string) => viewersRef.current.get(peerId)?.connection ?? null, []);

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
    surface,
    setQuality,
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
    rename,
    getPublishPc,
    getViewerPc,
  };
}
