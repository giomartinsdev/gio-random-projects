import { useCallback, useEffect, useRef, useState } from "react";
import { readIdentity, rememberIdentity, wsUrl } from "./api";

// Someone dropping off is usually a blip -- a reload, a moment of bad
// wifi, or this server being redeployed -- not someone leaving. Marking
// them disconnected the instant the WebSocket says so turns a
// two-second gap into a scoreboard flicker, so the room's own state
// (which already carries `connected`) is what the UI renders and this
// hook simply reconnects underneath it.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

export type Status = "connecting" | "connected" | "reconnecting" | "error" | "closed";

// Card mirrors the Go side's decks.Card on the wire.
export type Card = { id: string; text: string };

export type Player = {
  peerId: string;
  name: string;
  score: number;
  isCzar: boolean;
  connected: boolean;
  submitted: boolean;
};

// One anonymous submission as the czar sees it -- stable id, stable
// order for the whole judging phase (see the Go side's openJudging).
export type Submission = { id: string; lines: string[] };

export type Winner = { peerId: string; name: string; lines?: string[] };

export type Phase = "lobby" | "playing" | "judging" | "roundEnd" | "gameOver";

// The per-viewer snapshot: other players' hands and submission
// authorship while judging simply never arrive (see the Go side's
// Snapshot).
export type GameState = {
  phase: Phase;
  round: number;
  decks: string[];
  winningScore: number;
  players: Player[];
  blackCard: Card | null;
  blackBlanks: number;
  myLines?: string[];
  myTraded: boolean;
  submissions?: Submission[];
  winner?: Winner;
  gameWinner?: Winner;
};

export type KnockRequest = { requestId: string; name: string };

// Either credential admits on its own -- a password proves you were
// given one, an admit token proves someone already inside approved a
// knock instead. Never both at once: see useGame's connect().
export type Credential = { password: string } | { admitToken: string };

// displayName is only ever sent on a brand-new join (see connect()
// below) -- once the server has assigned an identity, a reconnect
// always resumes with the name it already gave out, chosen or not.
export function useGame(roomId: string, credential: Credential, displayName?: string) {
  // Pulled out as primitives rather than depending on `credential`
  // itself below -- a caller passing a fresh object literal every
  // render (the common case) would otherwise reconnect the WebSocket
  // on every render instead of only when the actual value changes.
  const credentialPassword = "password" in credential ? credential.password : undefined;
  const credentialAdmitToken = "admitToken" in credential ? credential.admitToken : undefined;

  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [you, setYou] = useState<{ peerId: string; name: string } | null>(null);
  const [peers, setPeers] = useState<{ peerId: string; name: string }[]>([]);
  // Requests to enter without the password -- broadcast to everyone
  // currently in the room, answered by whoever gets there first.
  const [knockRequests, setKnockRequests] = useState<KnockRequest[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [hand, setHand] = useState<Card[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
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

      ws.onmessage = (evt) => {
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

            const list = (msg.peers as { peerId: string; name: string }[]) ?? [];
            setPeers(list);
            setKnockRequests(
              (msg.pendingKnocks as { id: string; name: string }[] | undefined)?.map((k) => ({
                requestId: k.id,
                name: k.name,
              })) ?? [],
            );

            // The state snapshot rides along with the welcome, and the
            // hand follows as its own message -- no round trip needed
            // to render the room on arrival.
            if (msg.state) setState(msg.state as GameState);
            break;
          }

          case "state":
            setState(msg.state as GameState);
            break;

          case "hand":
            setHand((msg.cards as Card[]) ?? []);
            break;

          case "peer:join": {
            const peer = { peerId: msg.peerId as string, name: msg.name as string };
            setPeers((current) => [...current.filter((p) => p.peerId !== peer.peerId), peer]);
            break;
          }

          case "peer:leave": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.filter((p) => p.peerId !== peerId));
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

          // A rejected action: shown to this player only. The room's
          // state doesn't change, so nothing else is re-rendered.
          case "error":
            setErrorMessage((msg.message as string) ?? "algo deu errado");
            break;
        }
      };
    };

    connect();

    // Leaving the room for real.
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, credentialPassword, credentialAdmitToken, displayName]);

  // Errors are transient ("essa carta não está na sua mão") -- a
  // message that lingers past the next successful action reads as
  // stale, so anything sent afterwards clears it.
  const sendCleared = useCallback(
    (payload: unknown) => {
      setErrorMessage(null);
      send(payload);
    },
    [send],
  );

  const startGame = useCallback(
    (decks: string[], winningScore: number) => sendCleared({ type: "game:start", decks, winningScore }),
    [sendCleared],
  );
  const submitCards = useCallback(
    (plays: { cardId: string; text?: string }[]) => sendCleared({ type: "card:submit", plays }),
    [sendCleared],
  );
  const discardCard = useCallback((cardId: string) => sendCleared({ type: "card:discard", cardId }), [sendCleared]);
  const pickSubmission = useCallback(
    (submissionId: string) => sendCleared({ type: "card:pick", submissionId }),
    [sendCleared],
  );
  const nextRound = useCallback(() => sendCleared({ type: "round:next" }), [sendCleared]);
  const skipRound = useCallback(() => sendCleared({ type: "round:skip" }), [sendCleared]);
  const resetGame = useCallback(() => sendCleared({ type: "game:reset" }), [sendCleared]);
  const approveKnock = useCallback(
    (requestId: string) => sendCleared({ type: "knock:approve", requestId }),
    [sendCleared],
  );
  const denyKnock = useCallback(
    (requestId: string) => sendCleared({ type: "knock:deny", requestId }),
    [sendCleared],
  );

  return {
    status,
    errorMessage,
    clearError: () => setErrorMessage(null),
    you,
    peers,
    knockRequests,
    state,
    hand,
    startGame,
    submitCards,
    discardCard,
    pickSubmission,
    nextRound,
    skipRound,
    resetGame,
    approveKnock,
    denyKnock,
  };
}