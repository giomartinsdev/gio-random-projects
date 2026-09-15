import { useCallback, useEffect, useRef, useState } from "react";
import type { Peer } from "./useRoom";

// Where the on/off choice lives between visits. Absence means the
// default, which is ON: a room is easier to follow when you hear
// someone arrive while your attention is on the stream, and the button
// that silences it is one click away in the header.
const STORAGE_KEY = "tela:sounds";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    // Storage can be unavailable (private mode, blocked site data) --
    // the default stands either way.
    return true;
  }
}

function writeStored(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Same story: the choice just doesn't survive the tab.
  }
}

// One note of a chime: a sine with a fast attack and an exponential
// tail. Without the envelope a sine starting at full amplitude clicks
// like a light switch rather than ringing like a bell.
function tone(ctx: AudioContext, at: number, freq: number, dur: number, peak: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

// Two synthesized chimes, no audio assets: someone entering rings up
// (C5→G5), someone leaving rings down (E5→G#4) and a little quieter --
// departures are usually blips and shouldn't demand attention the way
// arrivals do. WebAudio was chosen over <audio> files for the same
// reason the icons are drawn in code: nothing extra to ship, and the
// volume/length stay tunable without a round trip through an editor.
//
// `peers` is the room's roster (everyone but you -- your own join is
// the page you're already looking at, not news). The hook diffs it
// between renders and rings on membership changes only; renames and
// publish toggles rewrite the list without touching this.
export function useRoomSounds(peers: Peer[]) {
  const [soundsOn, setSoundsOn] = useState<boolean>(readStored);
  const ctxRef = useRef<AudioContext | null>(null);
  // The roster as the previous pass saw it. A ref, not state: the diff
  // is a side effect of rendering, and mirroring it into state would
  // only schedule another render for no visible change.
  const knownRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    // The context outlives the component in some browsers if left open;
    // closing releases the audio thread for the next room this tab
    // opens.
    return () => {
      void ctxRef.current?.close().catch(() => {});
    };
  }, []);

  // Created lazily on first use. Browsers create AudioContexts
  // "suspended" until a user gesture -- and the roster diff fires from
  // a WebSocket message, which is no gesture at all -- so every play
  // path resumes first. The toggle click is the gesture that actually
  // unlocks it; until then scheduled notes simply queue unheard.
  const ensureCtx = useCallback((): AudioContext | null => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        // No WebAudio (ancient browser): the toggle still flips and
        // persists, there's just nothing to hear.
        return null;
      }
    }
    void ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (notes: [number, number][], peak: number) => {
      if (!soundsOn) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      // A hair of lead time so the first note's attack doesn't land at
      // exactly currentTime (which some browsers clip).
      const t0 = ctx.currentTime + 0.02;
      for (const [freq, at] of notes) tone(ctx, t0 + at, freq, 0.35, peak);
    },
    [soundsOn, ensureCtx],
  );

  const playJoin = useCallback(() => play([[523.25, 0], [783.99, 0.1]], 0.14), [play]);
  const playLeave = useCallback(() => play([[659.25, 0], [415.3, 0.1]], 0.1), [play]);

  const toggleSounds = useCallback(() => {
    const next = !soundsOn;
    setSoundsOn(next);
    writeStored(next);
    if (next) playJoin(); // feedback for the click, and the AudioContext unlock
  }, [soundsOn, playJoin]);

  useEffect(() => {
    const now = new Map(peers.map((p) => [p.peerId, p.name]));
    const prev = knownRef.current;
    knownRef.current = now;
    // The roster that arrives with `welcome` is context, not news: on
    // connect -- and on every reconnect, which re-issues the same ids
    // for everyone still there -- nobody "joined", they were already in
    // the room when you arrived.
    if (prev === null) return;
    for (const id of now.keys()) if (!prev.has(id)) playJoin();
    for (const id of prev.keys()) if (!now.has(id)) playLeave();
  }, [peers, playJoin, playLeave]);

  return { soundsOn, toggleSounds };
}