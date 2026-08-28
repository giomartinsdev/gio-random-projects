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
// "source" fps has no fixed number to multiply by either -- 60 is the
// same stand-in dimensions above uses.
const CAMERA_BITRATE_SHARE = 0.4; // a phone camera's own encoder needs less than a full desktop capture at the same resolution/fps

function bitrateFor(source: Source, quality: Quality, fps: Fps): number {
  const { width, height } = dimensionsFor(quality);
  const rate = fps === "source" ? 60 : fps;
  const bitrate = width * height * rate * BITS_PER_PIXEL_PER_FRAME;
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
// windows mid-share without renegotiating.
function gdmOptions(video: MediaTrackConstraints): DisplayMediaStreamOptions {
  return {
    video,
    audio: true,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  } as DisplayMediaStreamOptions;
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
  // when it can't keep up. Both sources now prefer smooth motion over
  // sharpness: a screen share used to mean mostly static text/docs
  // (where a soft frame drop is worse than a slightly blurrier
  // picture), but 120fps game footage is the opposite -- a stutter is
  // far more noticeable than the encoder shaving resolution to keep up.
  const applyEncodingLimits = useCallback((pc: RTCPeerConnection | null) => {
    if (!pc) return;
    const src = sourceRef.current ?? "screen";
    const q = qualityRef.current;
    const f = fpsRef.current;
    const bitrate = bitrateFor(src, q, f);
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const encoding = params.encodings[0];
      encoding.maxBitrate = bitrate;
      // Two levers beyond bitrate make quality changes apply live
      // without recapturing: cap the encoder's own output rate, and have
      // it scale captured frames down to the chosen size.
      if (f !== "source") encoding.maxFramerate = f;
      else delete encoding.maxFramerate;
      const scale = scaleResolutionDownByFor(sender.track?.getSettings() ?? {}, q);
      if (scale) encoding.scaleResolutionDownBy = scale;
      else delete encoding.scaleResolutionDownBy;
      params.degradationPreference = "maintain-framerate";
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

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
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
      await pc.setLocalDescription(offer);
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
    async (from: Source, newQuality?: Quality, newFps?: Fps, newSurface?: DisplaySurface) => {
      if (startingRef.current) return;
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
              ? await navigator.mediaDevices.getDisplayMedia(gdmOptions(videoConstraints))
              : await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
        } catch (err) {
          const name = err instanceof Error ? err.name : "Error";
          // Dismissing the picker is a normal thing to do, not an error.
          if (name !== "NotAllowedError" && name !== "AbortError") {
            setErrorMessage(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
          }
          return;
        }

        // Tells the encoder what this footage actually is: "detail" keeps
        // text sharp on a shared screen at the cost of framerate, "motion"
        // does the opposite for a camera.
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.contentHint = from === "screen" ? "detail" : "motion";
        // getDisplayMedia only yields audio if the person also ticked
        // "share audio", so there may be nothing here to disable.
        for (const track of stream.getAudioTracks()) track.enabled = sendingAudioRef.current;

        localStreamRef.current = stream;
        setLocalStream(stream);
        setSource(from);
        sourceRef.current = from;
        // The browser's own "Stop sharing" bar ends the track.
        videoTrack?.addEventListener("ended", () => stopSharing());

        await publishStream(stream);
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
            rememberIdentity(roomId, { peerId: myId, name: myName, resume: (msg.resume as string) ?? "" });

            const list = (msg.peers as Peer[]) ?? [];
            setPeers(list);
            setKnockRequests(
              (msg.pendingKnocks as { id: string; name: string }[] | undefined)?.map((k) => ({
                requestId: k.id,
                name: k.name,
              })) ?? [],
            );

            const present = new Set(list.map((p) => p.peerId));
            for (const id of [...pendingLeaveRef.current.keys()]) {
              if (present.has(id)) cancelPendingLeave(id);
            }
            for (const id of Object.keys(remoteStreamsRef.current)) {
              if (!present.has(id)) dropRemote(id);
            }

            // A restarted server has forgotten everything, this
            // browser's publish connection included -- so republish.
            // The capture itself survived the disconnect (nobody called
            // stopSharing), so re-offer the same tracks instead of
            // making the person re-pick the window; the receive side is
            // re-offered by the server.
            if (localStreamRef.current && sourceRef.current) {
              subscribeRef.current?.close();
              subscribeRef.current = null;
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
    knockRequests,
    approveKnock,
    denyKnock,
  };
}
