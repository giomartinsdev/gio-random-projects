import { useEffect, useRef, useState } from "react";

// One tile's connection numbers, read straight from the browser's
// getStats() -- no server involvement, this is the WebRTC engine's own
// accounting. Rates are deltas between two samples, so they're null
// (rendered as "coletando…") until the second tick lands.
export type PeerStats = {
  bitrateBps: number | null;
  audioBitrateBps: number | null;
  rttMs: number | null;
  lossPct: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
};

const POLL_MS = 2000;

// The baseline a rate is computed against, keyed to the peer connection
// it was taken on: a re-share replaces the PC, and deltas across
// replacement are noise (counters restart at zero), not rates.
type Sample = {
  pc: RTCPeerConnection;
  at: number;
  videoBytes?: number;
  videoFrames?: number;
  audioBytes?: number;
};

export function usePeerStats({
  getPc,
  stream,
  own,
  active,
}: {
  // An accessor, not a value: both peer connections are replaced over
  // the room's life (every re-share, every renegotiation with a new
  // transceiver set) and the poller needs the CURRENT one at tick time.
  getPc: () => RTCPeerConnection | null;
  // The stream whose tracks this tile plays -- on a remote tile its
  // video+audio track ids select this peer's inbound-rtp entries out of
  // the one shared subscribe connection's report.
  stream: MediaStream | null;
  own: boolean;
  active: boolean;
}): PeerStats | null {
  const [stats, setStats] = useState<PeerStats | null>(null);
  // Read on every render instead of closed over: the callers pass
  // inline arrows, which must stay fresh (the PC is replaced per
  // re-share) without restarting the effect below every render.
  const readRef = useRef({ getPc, stream, own });
  readRef.current = { getPc, stream, own };
  const prevRef = useRef<Sample | null>(null);

  useEffect(() => {
    if (!active) {
      setStats(null);
      prevRef.current = null;
      return;
    }
    let inFlight = false;
    let disposed = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const read = readRef.current;
        const pc = read.getPc();
        if (!pc || pc.connectionState === "closed") {
          prevRef.current = null;
          setStats(null);
          return;
        }
        const report = await pc.getStats();
        if (disposed) return;

        // By spec, an inbound-rtp's trackIdentifier is the id of the
        // MediaStreamTrack the browser created for it -- the very track
        // objects this tile's stream holds. One subscribe connection
        // carries everyone's tracks, so the ids are what pick THIS
        // tile's counters out of the report.
        const trackIds = new Set(read.stream?.getTracks().map((t) => t.id) ?? []);
        let video: any = null;
        let audio: any = null;
        let remoteVideo: any = null; // the SFU's side of MY send
        let rttSec: number | null = null;
        report.forEach((s: any) => {
          if (s.type === "inbound-rtp") {
            if (read.own) return;
            if (s.trackIdentifier !== undefined && !trackIds.has(s.trackIdentifier)) return;
            if (s.kind === "video") video = s;
            else if (s.kind === "audio") audio = s;
          } else if (s.type === "outbound-rtp" && read.own) {
            if (s.kind === "video") video = s;
            else if (s.kind === "audio") audio = s;
          } else if (s.type === "remote-inbound-rtp" && read.own && s.kind === "video") {
            remoteVideo = s;
          } else if (s.type === "candidate-pair" && rttSec === null) {
            if (
              typeof s.currentRoundTripTime === "number" &&
              (s.selected || s.nominated || s.state === "succeeded")
            ) {
              rttSec = s.currentRoundTripTime;
            }
          }
        });

        const now = typeof video?.timestamp === "number" ? video.timestamp : performance.now();
        const prev = prevRef.current;
        const samePc = prev !== null && prev.pc === pc;
        const dtMs = samePc ? now - prev.at : 0;
        prevRef.current = {
          pc,
          at: now,
          videoBytes: video?.bytesSent ?? video?.bytesReceived,
          videoFrames: video?.framesEncoded ?? video?.framesDecoded,
          audioBytes: audio?.bytesSent ?? audio?.bytesReceived,
        };

        // bits/s from a byte delta -- x8000/xms, not x8/s, so a skipped
        // interval still gets the right rate.
        const rate = (current: number | undefined, before: number | undefined): number | null => {
          if (current === undefined || !samePc || dtMs <= 0) return null;
          const beforeValue = before;
          if (beforeValue === undefined) return null;
          const delta = current - beforeValue;
          // A counter that went backwards means the connection was
          // rebuilt: not a negative bitrate, just a baseline again.
          if (delta < 0) return null;
          return (delta * 8000) / dtMs;
        };

        const loss = (s: any): number | null => {
          const got = s?.packetsReceived;
          const lost = s?.packetsLost;
          if (typeof got !== "number" || typeof lost !== "number" || got + lost <= 0) return null;
          return Math.max(0, (lost * 100) / (got + lost));
        };

        let fps: number | null = null;
        if (typeof video?.framesPerSecond === "number" && Number.isFinite(video.framesPerSecond) && video.framesPerSecond > 0) {
          fps = video.framesPerSecond;
        } else if (video && samePc && dtMs > 0) {
          const frames = typeof video.framesEncoded === "number" ? video.framesEncoded : video.framesDecoded;
          if (typeof frames === "number" && prev !== null && typeof prev.videoFrames === "number" && frames >= prev.videoFrames) {
            fps = ((frames - prev.videoFrames) * 1000) / dtMs;
          }
        }

        const settings = read.stream?.getVideoTracks()[0]?.getSettings();
        setStats({
          bitrateBps: rate(video?.bytesSent ?? video?.bytesReceived, prev?.videoBytes),
          audioBitrateBps: rate(audio?.bytesSent ?? audio?.bytesReceived, prev?.audioBytes),
          rttMs: rttSec === null ? null : rttSec * 1000,
          // A viewer's loss comes from their own receive counters; a
          // sharer's from what the SFU reports back (remote-inbound-rtp).
          lossPct: loss(video) ?? loss(audio) ?? loss(remoteVideo),
          fps,
          width: video?.frameWidth ?? settings?.width ?? null,
          height: video?.frameHeight ?? settings?.height ?? null,
        });
      } finally {
        inFlight = false;
      }
    };

    // One immediate sample sets the baseline (the panel shows
    // "coletando…" for the first 2s), then the interval takes over.
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active]);
  // readRef covers getPc/stream/own changes; only `active` gates the
  // loop -- and only one panel is open at a time, so at most one poller
  // runs per room.

  return stats;
}