import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ArrowLeft, Check, Crop, Film, Link2, MonitorUp, Pencil, PictureInPicture2, RotateCcw, SlidersHorizontal, Trash2, Users, Video, VideoOff, Volume2, VolumeX, X } from "lucide-react";
import { api } from "@/lib/api";
import { canShareScreen, useRoom, type Credential, QUALITY_OPTIONS } from "@/lib/useRoom";
import { usePeerStats } from "@/lib/usePeerStats";
import { useWakeLock } from "@/lib/useWakeLock";
import { useLiveFavicon } from "@/lib/useLiveFavicon";
import { useRoomSounds } from "@/lib/useRoomSounds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { SharePanel, type ShareChoice } from "@/components/SharePanel";
import { useDismissable } from "@/lib/useDismissable";
import { enterFullscreen, exitFullscreen, fullscreenChangeEventName, isFullscreen } from "@/lib/fullscreen";
import {
  airplayIcon,
  arrowRightCircleIcon,
  checkmarkIcon,
  copyIcon,
  errorIcon,
  loadingIcon,
  microphoneIcon,
  notificationIcon,
  playPauseCircleIcon,
  plusToXIcon,
  videoIcon,
  volumeIcon,
} from "@/lib/lottie-icons";

// A viewer's own preference for how the fullscreen tile fits its
// space -- purely local rendering, never touches the publisher's
// actual stream/encoding (see useRoom.ts for that). "auto" shows the
// stream at its real ratio; the fixed ratios letterbox inside a box of
// that shape -- nothing is ever cut away, the bars just absorb the
// difference (useful for a game recorded 4:3, say, watched on a 16:9
// screen); "fill" is the deliberate-crop option, covering the tile
// edge-to-edge and yes, losing the edges.
type AspectMode = "auto" | "16:9" | "4:3" | "1:1" | "fill";
const ASPECT_MODES: { mode: AspectMode; label: string; ratio?: string }[] = [
  { mode: "auto", label: "Original" },
  { mode: "16:9", label: "16:9", ratio: "16 / 9" },
  { mode: "4:3", label: "4:3", ratio: "4 / 3" },
  { mode: "1:1", label: "1:1", ratio: "1 / 1" },
  { mode: "fill", label: "Preencher" },
];

export default function Room() {
  const { id } = useParams<{ id: string }>();
  // Codes are lowercase words now ("abacate98suco"), not the old
  // uppercase "DRFG2478" -- lowercased here too so a link typed/pasted
  // in any case still resolves the same room.
  const roomId = (id ?? "").toLowerCase();
  const location = useLocation();

  // Password can arrive through:
  // 1. Navigation state (joining / creating from home)
  // 2. Query param ?pwd=... / ?password=... / ?p=... (direct link shared with password)
  // 3. Hash #pwd=... / #password=... / #p=...
  const [credential, setCredential] = useState<Credential | null>(() => {
    const statePassword = (location.state as { password?: string } | null)?.password;
    if (statePassword) return { password: statePassword };

    const searchParams = new URLSearchParams(location.search);
    const queryPwd = searchParams.get("pwd") || searchParams.get("password") || searchParams.get("p");
    if (queryPwd) return { password: queryPwd };

    if (location.hash) {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
      const hashPwd = hashParams.get("pwd") || hashParams.get("password") || hashParams.get("p");
      if (hashPwd) return { password: hashPwd };
    }

    return null;
  });

  // Set once, from whatever the home page's forms collected -- someone
  // arriving via a bare link (no navigation state) never had the
  // chance to type one, and EntryGate below is where they get it
  // instead.
  const [name, setName] = useState<string>(() => (location.state as { name?: string } | null)?.name ?? "");

  if (!credential) {
    return (
      <EntryGate
        roomId={roomId}
        name={name}
        onUnlocked={(c, n) => {
          setName(n);
          setCredential(c);
        }}
      />
    );
  }
  return <LiveRoom roomId={roomId} credential={credential} name={name} onResetPassword={() => setCredential(null)} />;
}

// Two ways in, picked with a tab-like toggle: the password (instant),
// or "pedir para entrar" -- a knock that notifies everyone already in
// the room and waits for one of them to answer. See KnockLobby for the
// waiting side of that.
function EntryGate({
  roomId,
  name: initialName,
  onUnlocked,
}: {
  roomId: string;
  name: string;
  onUnlocked: (credential: Credential, name: string) => void;
}) {
  const [mode, setMode] = useState<"password" | "knock">("password");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [knockRequestId, setKnockRequestId] = useState<string | null>(null);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      await api.checkPassword(roomId, password);
      onUnlocked({ password }, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
      setChecking(false);
    }
  }

  async function requestToJoin() {
    setError(null);
    setChecking(true);
    try {
      const { requestId } = await api.knock(roomId, name.trim());
      setKnockRequestId(requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível pedir para entrar");
    } finally {
      setChecking(false);
    }
  }

  if (knockRequestId) {
    return (
      <KnockLobby
        roomId={roomId}
        requestId={knockRequestId}
        name={name.trim()}
        onApproved={(admitToken) => onUnlocked({ admitToken }, name.trim())}
        onCancel={() => setKnockRequestId(null)}
      />
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sala {roomId}</CardTitle>
            <CardDescription>
              {mode === "password" ? "Digite a senha para entrar." : "Peça para alguém já na sala te deixar entrar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="display-name">Seu nome (opcional)</Label>
              <Input
                id="display-name"
                placeholder="deixe em branco para um nome aleatório"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
              />
            </div>

            {mode === "password" ? (
              <form onSubmit={submitPassword} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={checking}>
                  {checking && <AnimatedIcon animation={loadingIcon} autoplay loop />}
                  Entrar
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("knock");
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Não sei a senha -- pedir para entrar
                </button>
              </form>
            ) : (
              <div className="mt-4 space-y-4">
                <Button type="button" className="w-full" onClick={requestToJoin} disabled={checking}>
                  <AnimatedIcon
                    animation={checking ? loadingIcon : arrowRightCircleIcon}
                    autoplay={checking}
                    loop={checking}
                  />
                  Pedir para entrar
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("password");
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Tenho a senha
                </button>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// The waiting side of a knock -- polled rather than a held-open
// request, so a slow or unattended room never freezes this tab. See
// tela-api's knock.go for why this is safe to poll: the request itself
// is cheap, stateless-per-call, and rate limited the same way a
// password guess would be.
const KNOCK_POLL_MS = 1_500;

function KnockLobby({
  roomId,
  requestId,
  name,
  onApproved,
  onCancel,
}: {
  roomId: string;
  requestId: string;
  name: string;
  onApproved: (admitToken: string) => void;
  onCancel: () => void;
}) {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.knockStatus(roomId, requestId);
        if (cancelled) return;
        if (status.status === "approved" && status.admitToken) {
          onApproved(status.admitToken);
        } else if (status.status === "denied") {
          setDenied(true);
        }
      } catch {
        // A 404 here means the request expired -- treated the same as
        // a denial rather than surfacing a network error for it.
        if (!cancelled) setDenied(true);
      }
    };
    poll();
    const interval = setInterval(poll, KNOCK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, requestId, onApproved]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-xl">Sala {roomId}</CardTitle>
          <CardDescription>
            {denied
              ? "Ninguém te deixou entrar dessa vez."
              : `Esperando alguém aprovar${name ? `, ${name}` : ""}…`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <motion.div
            key={denied ? "denied" : "waiting"}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex justify-center text-muted-foreground"
          >
            <AnimatedIcon animation={denied ? errorIcon : loadingIcon} size={40} autoplay loop={!denied} />
          </motion.div>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            {denied ? "Voltar" : "Cancelar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type Tile = { peerId: string; name: string; stream: MediaStream | null; isYou: boolean };

// Whether a stream carries audio at all. A mute button on a silent
// stream is just a control that does nothing, so tiles without audio
// don't get one.
function hasAudio(stream: MediaStream | null): boolean {
  return (stream?.getAudioTracks().length ?? 0) > 0;
}

function LiveRoom({
  roomId,
  credential,
  name,
  onResetPassword,
}: {
  roomId: string;
  credential: Credential;
  name?: string;
  onResetPassword?: () => void;
}) {
  const room = useRoom(roomId, credential, name);
  const navigate = useNavigate();
  // Only someone who actually typed the password has one to share --
  // someone let in through a knock never learns it, so there's nothing
  // for CopyLinkWithPassword to put in the link.
  const password = "password" in credential ? credential.password : undefined;
  const isAdm = room.you?.name === "adm";
  const [selected, setSelected] = useState<string | null>(null);
  // Which people I've muted, decided per stream and only on my side --
  // muting someone here doesn't stop them sending audio to anyone else.
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  // One choice for the whole session, not per-tile: switching who
  // you're watching in fullscreen keeps whatever fit you picked
  // instead of resetting to "Original" every time.
  const [aspectMode, setAspectMode] = useState<AspectMode>("auto");
  // Theater mode: one big stage tile instead of the grid, everyone
  // else shrunk to a thumbnail strip along the bottom. Session-local
  // like aspectMode -- a view preference, not a room fact.
  const [theater, setTheater] = useState(false);
  // Who's on stage. Null means "the automatic choice" (first remote
  // stream, else the first tile); picking a thumbnail pins it until it
  // leaves the room.
  const [theaterStage, setTheaterStage] = useState<string | null>(null);

  // The share panel: opened by the header's "Compartilhar" button, or by
  // its "Qualidade" variant once a share is already live. A drawer over
  // the room's right edge, not a modal.
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  // True from confirm until the capture settles -- while the browser's
  // own picker is up the button stays inert, so a double click can't
  // queue two getDisplayMedia calls (the hook also guards this, this
  // just keeps the button honest).
  const [starting, setStarting] = useState(false);
  // What the last capture attempt came back with -- shown on the panel
  // itself, which stays open so the refusal is read where the choice
  // was made. The room-wide banner below keeps protocol-level errors.
  const [shareError, setShareError] = useState<string | null>(null);

  const toggleSharePanel = useCallback(() => {
    setShareError(null);
    setSharePanelOpen((open) => !open);
  }, []);

  const toggleMuted = (peerId: string) =>
    setMutedPeers((current) => {
      const next = new Set(current);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });

  // Stop or restore one publisher's video, on the server. Kept as a
  // plain set-flip here; the state itself lives in the room hook so it
  // survives reconnects (the off-list is re-asserted after every one).
  const toggleVideo = (peerId: string) => {
    room.setPublisherVideo(peerId, room.videoOffPeers.has(peerId));
  };

  // Stable accessors for the per-tile stats reader: the refs are stable,
  // the peer connections inside them are replaced on every re-share, and
  // only reading at poll time gets the current one.
  const publishPcRef = room.publishPcRef;
  const subscribePcRef = room.subscribePcRef;
  const getPublishPc = useCallback(() => publishPcRef.current, [publishPcRef]);
  const getSubscribePc = useCallback(() => subscribePcRef.current, [subscribePcRef]);

  // Everyone currently publishing, me included. A tile can exist before
  // its stream arrives (the peer announced publishing but WebRTC is
  // still negotiating), which is why stream is nullable.
  const tiles = useMemo<Tile[]>(() => {
    const list: Tile[] = [];
    if (room.localStream && room.you) {
      list.push({ peerId: room.you.peerId, name: "Você", stream: room.localStream, isYou: true });
    }
    for (const peer of room.peers) {
      if (!peer.publishing) continue;
      list.push({
        peerId: peer.peerId,
        name: peer.name,
        stream: room.remoteStreams[peer.peerId] ?? null,
        isYou: false,
      });
    }
    return list;
  }, [room.localStream, room.you, room.peers, room.remoteStreams]);

  // A pinned stage that stopped publishing can't stay pinned -- the
  // TheaterView's automatic fallback takes over instead.
  useEffect(() => {
    if (theaterStage && !tiles.some((t) => t.peerId === theaterStage)) setTheaterStage(null);
  }, [theaterStage, tiles]);

  useWakeLock(tiles.length > 0);
  // Same trigger, different surface: a red badge on the tab's favicon
  // for whoever parked this room in a background tab.
  useLiveFavicon(tiles.length > 0);
  // A chime when someone arrives or leaves -- the hook diffs the roster
  // itself; here only the header's on/off switch is wired.
  const { soundsOn, toggleSounds } = useRoomSounds(room.peers);

  // A pill announcing whoever just started sharing. Fires only on a
  // false->true transition for a peer id this session had already seen
  // idle: the roster that arrives with welcome -- and every fresh peer
  // id after a reconnect -- counts as "was already sharing", not news.
  const [shareToast, setShareToast] = useState<string | null>(null);
  const prevPublishingRef = useRef<Map<string, boolean>>(new Map());
  const toastTimerRef = useRef(0);
  useEffect(() => {
    const prev = prevPublishingRef.current;
    const next = new Map<string, boolean>();
    let announced: string | null = null;
    for (const peer of room.peers) {
      next.set(peer.peerId, peer.publishing);
      if (peer.publishing && prev.get(peer.peerId) === false) announced = peer.name;
    }
    prevPublishingRef.current = next;
    if (announced) {
      setShareToast(announced);
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setShareToast(null), 5000);
    }
  }, [room.peers]);
  // A timer must never outlive the component that set it.
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  // A selected tile that stops publishing would otherwise leave a
  // fullscreen view of nothing.
  useEffect(() => {
    if (selected && !tiles.some((t) => t.peerId === selected)) setSelected(null);
  }, [selected, tiles]);

  // True fullscreen: picking a tile sends the room's <main> (which the
  // overlay already covers corner to corner) into the Fullscreen API, so
  // the browser's own bars go away with the page's. Opening has to be in
  // the click handler itself -- browsers tie the request to the gesture.
  const mainRef = useRef<HTMLElement>(null);
  const openFullscreenTile = useCallback((peerId: string) => {
    setSelected(peerId);
    if (mainRef.current) void enterFullscreen(mainRef.current);
  }, []);

  // The one close path for every exit: Voltar, Escape, or the browser's
  // own Esc falling out of native fullscreen (fullscreenchange below).
  const closeFullscreenTile = useCallback(() => {
    setSelected(null);
    void exitFullscreen();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFullscreenTile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, closeFullscreenTile]);

  useEffect(() => {
    if (!selected) return;
    const onFsChange = () => {
      if (!isFullscreen()) closeFullscreenTile();
    };
    document.addEventListener(fullscreenChangeEventName(), onFsChange);
    return () => document.removeEventListener(fullscreenChangeEventName(), onFsChange);
  }, [selected, closeFullscreenTile]);

  // Closed from another direction -- the sharer stopped, say -- while
  // the browser is still fullscreen: let go of the screen too.
  useEffect(() => {
    if (!selected && isFullscreen()) void exitFullscreen();
  }, [selected]);

  const selectedTile = tiles.find((t) => t.peerId === selected) ?? null;
  const peopleCount = room.peers.length + 1;

  // Everyone in the room, publishing or not -- unlike tiles above,
  // which only lists who currently has something on screen. This is
  // "who's here", not "what's showing".
  const participants = useMemo(() => {
    const list: { peerId: string; name: string; isYou: boolean; publishing: boolean }[] = [];
    if (room.you) list.push({ peerId: room.you.peerId, name: "Você", isYou: true, publishing: !!room.localStream });
    for (const peer of room.peers) {
      list.push({ peerId: peer.peerId, name: peer.name, isYou: false, publishing: peer.publishing });
    }
    return list;
  }, [room.you, room.localStream, room.peers]);

  // The tile the single-key shortcuts act on: the fullscreen one when
  // one is open, else the first remote stream on screen (falling back
  // to any tile -- your own -- when that's all there is).
  const activeTile = selectedTile ?? tiles.find((t) => !t.isYou && t.stream) ?? tiles[0] ?? null;

  // One-key shortcuts: F fullscreen of the active tile, M mute it,
  // V stop/restore its video, S the share panel. Guarded against
  // typing contexts (the rename editor lives on this page) and against
  // modifier combos -- Ctrl+F and friends stay the browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
      }
      switch (e.key.toLowerCase()) {
        case "f":
          if (activeTile) {
            if (selected === activeTile.peerId) closeFullscreenTile();
            else openFullscreenTile(activeTile.peerId);
          }
          return;
        case "m":
          if (activeTile && !activeTile.isYou && hasAudio(activeTile.stream)) toggleMuted(activeTile.peerId);
          return;
        case "v":
          if (activeTile && !activeTile.isYou) toggleVideo(activeTile.peerId);
          return;
        case "s":
          // Mid-capture the panel must stay put: the picker is in front
          // and an error would land where nobody can read it.
          if (!starting) toggleSharePanel();
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTile, selected, starting, openFullscreenTile, closeFullscreenTile, toggleMuted, toggleVideo, toggleSharePanel]);

  // Whatever the dialog confirms. A same-source change is a pure
  // encoder retune (applyQuality) -- live, no recapture. A different
  // source needs the previous capture GONE first: startSharing alone
  // would swap the stream over while the old capture's tracks kept
  // running, leaving a hot camera or screen grab with nothing holding
  // it. Either way the panel stays open until the outcome is known --
  // closing before the picker resolves was the old bug: an error (or a
  // plain dismiss) closed into nothing.
  const confirmShare = async (choice: ShareChoice) => {
    if (starting) return;
    const surface = choice.source === "screen" ? choice.surface : undefined;

    const start = async () => {
      setStarting(true);
      setShareError(null);
      try {
        const res = await room.startSharing(choice.source, choice.quality, choice.fps, surface);
        if (res.error) setShareError(res.error);
        else setSharePanelOpen(false);
      } finally {
        setStarting(false);
      }
    };

    if (room.isSharing) {
      const liveKey = room.source === "camera" ? "camera" : room.surface;
      const wantedKey = choice.source === "camera" ? "camera" : choice.surface;
      if (liveKey !== wantedKey) {
        room.stopSharing();
        await start();
        return;
      }
      room.applyQuality(choice.quality, choice.fps);
      setSharePanelOpen(false);
      return;
    }
    await start();
  };

  // Label for the live "Qualidade" button, showing what's actually
  // being sent right now.
  const qualityLabel = QUALITY_OPTIONS.find((o) => o.value === room.quality)?.label ?? String(room.quality);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        {/* A back affordance you can actually see -- the wordmark alone
            asked people to know it was a link. The wordmark stays a link
            too; this is the one that reads as a button. */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label="Voltar para a página inicial"
          title="Voltar para a página inicial"
        >
          <Link to="/">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Voltar</span>
          </Link>
        </Button>
        <Link to="/" className="text-lg font-bold tracking-tight">
          tela
        </Link>
        <CopyableCode code={roomId} />
        {password && <CopyLinkWithPassword roomId={roomId} password={password} />}
        <PeopleList
          count={peopleCount}
          participants={participants}
          videoOffPeers={room.videoOffPeers}
          yourName={room.you?.name ?? null}
          onRenameSelf={(n) => room.rename(n)}
        />
        {/* Ambient, like the people count next to it: entry/exit chimes
            off by default stay off, and the state rides localStorage. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSounds}
          aria-label={soundsOn ? "Desativar sons de entrada e saída" : "Ativar sons de entrada e saída"}
          title={soundsOn ? "Sons de entrada e saída: ligados" : "Sons de entrada e saída: desligados"}
          className="text-muted-foreground"
        >
          {soundsOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </Button>
        {room.status !== "connected" && (
          <span className="text-sm text-muted-foreground">
            {room.status === "reconnecting"
              ? "reconectando…"
              : room.status === "closed"
                ? "desconectado"
                : room.status === "error"
                  ? "erro na conexão"
                  : "conectando…"}
          </span>
        )}

        {isAdm && password && (
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm("Tem certeza que quer apagar esta sala?")) return;
              await api.deleteRoom(roomId, password);
              navigate("/");
            }}
            className="flex-1 sm:flex-none"
          >
            <Trash2 className="size-4" />
            Apagar sala
          </Button>
        )}

        {/* Full width on a phone (the buttons split the row), pushed to
            the right once everything fits on one line. Source, quality
            and FPS all live behind the share button now -- pre-stream in
            the side panel, mid-stream via its live variant. */}
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {room.isSharing ? (
            <>
              <Button
                variant="secondary"
                onClick={toggleSharePanel}
                className="flex-1 sm:flex-none"
                title="Mudar qualidade e FPS sem recomeçar a transmissão"
              >
                <SlidersHorizontal className="size-4" />
                <span className="sm:hidden">Qualidade</span>
                <span className="hidden sm:inline">Qualidade: {qualityLabel}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => room.setAudio(!room.sendingAudio)}
                disabled={!room.hasAudioTrack}
                className="flex-1 sm:flex-none"
                title={
                  room.hasAudioTrack
                    ? room.sendingAudio
                      ? "Parar de enviar áudio"
                      : "Voltar a enviar áudio"
                    : "Esta transmissão não tem áudio"
                }
              >
                <AnimatedIcon animation={microphoneIcon} reverse={!(room.sendingAudio && room.hasAudioTrack)} />
                <span className="sm:hidden">{room.sendingAudio && room.hasAudioTrack ? "Áudio" : "Sem áudio"}</span>
                <span className="hidden sm:inline">
                  {!room.hasAudioTrack ? "Sem áudio" : room.sendingAudio ? "Enviando áudio" : "Áudio desligado"}
                </span>
              </Button>
              <Button variant="destructive" onClick={room.stopSharing} className="flex-1 sm:flex-none">
                <AnimatedIcon animation={errorIcon} />
                Parar
              </Button>
            </>
          ) : (
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="flex-1 sm:flex-none">
              <Button onClick={toggleSharePanel} disabled={starting} className="w-full">
                <AnimatedIcon animation={canShareScreen ? airplayIcon : videoIcon} />
                {canShareScreen ? "Compartilhar" : "Compartilhar câmera"}
              </Button>
            </motion.div>
          )}
          {/* Theater: one stage tile plus a thumbnail strip, for
              watching instead of browsing. Only meaningful when there
              is something to watch. */}
          {tiles.length > 0 && (
            <Button
              variant={theater ? "default" : "secondary"}
              size="sm"
              onClick={() => setTheater((v) => !v)}
              className="flex-1 sm:flex-none"
              aria-pressed={theater}
              title={theater ? "Voltar para a grade" : "Modo teatro: um palco grande e uma faixa com o resto"}
            >
              <Film className="size-4" />
              <span className="sm:hidden">Teatro</span>
              <span className="hidden sm:inline">{theater ? "Sair do teatro" : "Teatro"}</span>
            </Button>
          )}
          {/* The "algo esquisito" escape hatch: one click tells the whole
              room to drop and rebuild every media connection. Captures
              keep running -- nobody re-picks their window -- so the cost
              of a stray click is a couple of seconds of rebuilding, not
              a lost share. */}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              // One guard before dropping everyone's connections: the
              // button lives next to the primary actions and a stray
              // click costs the whole room a couple of seconds of
              // rebuilding. Same native dialog as Apagar sala.
              if (!confirm("Resetar a conexão de todo mundo? As transmissões continuam — ninguém precisa compartilhar de novo."))
                return;
              room.resetRoom();
            }}
            className="flex-1 sm:flex-none"
            title="Reconstrói as conexões de todo mundo quando algo engasga — as transmissões continuam, ninguém precisa compartilhar de novo"
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </div>
      </header>

      <main ref={mainRef} className="relative flex flex-1 bg-black">
        {(room.status === "error" || room.knockRequests.length > 0) && (
          <div className="absolute inset-x-4 top-4 z-10 mx-auto flex max-w-md flex-col gap-2">
            {room.status === "error" && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3 text-xs">
                  <span>Falha ao conectar na sala (senha incorreta ou sala fechada).</span>
                  {onResetPassword && (
                    <Button size="sm" variant="outline" onClick={onResetPassword} className="h-7 shrink-0 text-xs">
                      Digitar senha
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <AnimatePresence initial={false}>
              {room.knockRequests.map((req) => (
                <motion.div
                  key={req.requestId}
                  layout
                  initial={{ opacity: 0, y: -16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Alert className="bg-card">
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <AnimatedIcon animation={notificationIcon} autoplay loop className="text-muted-foreground" />
                        <strong>{req.name}</strong> quer entrar na sala
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => room.denyKnock(req.requestId)}>
                          <AnimatedIcon animation={plusToXIcon} reverse />
                          Recusar
                        </Button>
                        <Button size="sm" onClick={() => room.approveKnock(req.requestId)}>
                          <AnimatedIcon animation={checkmarkIcon} autoplay />
                          Aprovar
                        </Button>
                      </span>
                    </AlertDescription>
                  </Alert>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        <AnimatePresence>
          {shareToast && (
            <motion.div
              initial={{ opacity: 0, y: -12, x: "-50%", scale: 0.95 }}
              animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
              exit={{ opacity: 0, y: -8, x: "-50%", scale: 0.95 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="pointer-events-none absolute left-1/2 top-4 z-20 flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm shadow-md"
            >
              <MonitorUp className="size-4 shrink-0 text-muted-foreground" />
              <span>
                <strong className="font-medium">{shareToast}</strong> começou a compartilhar
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {selectedTile ? (
          <FullscreenTile
            tile={selectedTile}
            muted={mutedPeers.has(selectedTile.peerId)}
            onToggleMuted={() => toggleMuted(selectedTile.peerId)}
            videoOff={room.videoOffPeers.has(selectedTile.peerId)}
            onToggleVideo={() => toggleVideo(selectedTile.peerId)}
            onClose={closeFullscreenTile}
            aspectMode={aspectMode}
            onAspectModeChange={setAspectMode}
            getPublishPc={getPublishPc}
            getSubscribePc={getSubscribePc}
          />
        ) : theater && tiles.length > 0 ? (
          <TheaterView
            tiles={tiles}
            stage={theaterStage}
            onPickStage={setTheaterStage}
            mutedPeers={mutedPeers}
            onToggleMuted={toggleMuted}
            videoOffPeers={room.videoOffPeers}
            onToggleVideo={toggleVideo}
            getPublishPc={getPublishPc}
            getSubscribePc={getSubscribePc}
          />
        ) : tiles.length === 0 ? (
          <Empty roomId={roomId} password={password} />
        ) : (
          <Grid
            tiles={tiles}
            mutedPeers={mutedPeers}
            onToggleMuted={toggleMuted}
            videoOffPeers={room.videoOffPeers}
            onToggleVideo={toggleVideo}
            onSelect={openFullscreenTile}
            getPublishPc={getPublishPc}
            getSubscribePc={getSubscribePc}
          />
        )}

        {room.errorMessage && (
          <div className="absolute inset-x-4 bottom-4">
            <Alert variant="destructive">
              <AlertDescription className="font-mono text-xs">{room.errorMessage}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Anchored to main, not to the viewport: the header stays
            clickable above it and the drawer covers the room, not the
            page chrome. */}
        <SharePanel
          open={sharePanelOpen}
          canScreenShare={canShareScreen}
          sharing={room.isSharing}
          starting={starting}
          error={shareError}
          // Seeded from what's LIVE while a share is up -- the hardcoded
          // default used to lie while sharing a camera ("Tela inteira"
          // selected, applying as-is was a no-op that claimed otherwise).
          initial={{
            source: room.source ?? (canShareScreen ? "screen" : "camera"),
            quality: room.quality,
            fps: room.fps,
            surface: room.surface,
          }}
          onOpenChange={setSharePanelOpen}
          onConfirm={confirmShare}
        />
      </main>
    </div>
  );
}

function Grid({
  tiles,
  mutedPeers,
  onToggleMuted,
  videoOffPeers,
  onToggleVideo,
  onSelect,
  getPublishPc,
  getSubscribePc,
}: {
  tiles: Tile[];
  mutedPeers: Set<string>;
  onToggleMuted: (peerId: string) => void;
  videoOffPeers: Set<string>;
  onToggleVideo: (peerId: string) => void;
  onSelect: (peerId: string) => void;
  getPublishPc: () => RTCPeerConnection | null;
  getSubscribePc: () => RTCPeerConnection | null;
}) {
  return (
    <div
      className={
        // One column on a phone; two or three once there's width for
        // them, but never more columns than there are streams.
        "grid flex-1 auto-rows-fr gap-2 p-2 sm:gap-3 sm:p-3 " +
        (tiles.length === 1 ? "grid-cols-1" : tiles.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")
      }
    >
      <AnimatePresence initial={false}>
        {tiles.map((tile) => (
          <motion.button
            key={tile.peerId}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={() => onSelect(tile.peerId)}
            data-tile="1"
            className="group relative min-h-0 overflow-hidden rounded-lg border bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TileVideo tile={tile} muted={mutedPeers.has(tile.peerId)} />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-left text-sm">
              <span className="truncate font-medium">{tile.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                ver em tela cheia
              </span>
            </span>
            {/* An opaque cover rather than hiding the tile's <video>:
                audio and video of a share ride the SAME MediaStream
                (stream id = the publisher's peer id), so unmounting or
                emptying the stream to hide the picture would cut the
                sound too. The video element keeps playing underneath --
                only the picture is hidden. */}
            {!tile.isYou && videoOffPeers.has(tile.peerId) && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80"
                onClick={(e) => e.stopPropagation()}
              >
                <VideoOff className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">vídeo desativado</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVideo(tile.peerId);
                  }}
                >
                  Ativar vídeo
                </Button>
              </div>
            )}
            {/* Own tile is always silent (hearing yourself back echoes),
                so there's nothing to toggle on it. */}
            {!tile.isYou && hasAudio(tile.stream) && (
              <MuteButton
                muted={mutedPeers.has(tile.peerId)}
                onToggle={() => onToggleMuted(tile.peerId)}
                className="absolute right-2 top-2 z-20"
              />
            )}
            {/* Rendered even while the stream is still negotiating: the
                opt-out is consulted server-side the moment the track
                arrives, so the choice made before that isn't lost.
                z-20: the overlay below carries a z-index of its own, and
                z-indexed siblings paint above every auto one. */}
            {!tile.isYou && (
              <VideoToggleButton
                off={videoOffPeers.has(tile.peerId)}
                onToggle={() => onToggleVideo(tile.peerId)}
                className="absolute left-2 top-2 z-20"
              />
            )}
            {/* Picture-in-picture needs a stream to pin -- before that
                there's nothing to float. Left side: next to the video
                toggle on remote tiles, alone on your own. */}
            {tile.stream && (
              <PipButton className={tile.isYou ? "absolute left-2 top-2 z-20" : "absolute left-12 top-2 z-20"} />
            )}
            {/* Numbers exist only once there's a stream to read them
                from -- before that the panel would just say coletando. */}
            {tile.isYou && tile.stream && (
              <StatsButton getPc={getPublishPc} stream={tile.stream} own className="absolute right-2 top-2 z-20" />
            )}
            {!tile.isYou && tile.stream && (
              <StatsButton getPc={getSubscribePc} stream={tile.stream} own={false} className="absolute right-12 top-2 z-20" />
            )}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Toggled from the people-count badge in the header -- everyone
// currently in the room, whether or not they have anything on screen
// right now (tiles only exist for people actually publishing).
function PeopleList({
  count,
  participants,
  videoOffPeers,
  yourName,
  onRenameSelf,
}: {
  count: number;
  participants: { peerId: string; name: string; isYou: boolean; publishing: boolean }[];
  videoOffPeers: Set<string>;
  // room.you's label -- the participants list renders the own row as
  // "Você", so the editor has to be seeded from the real name, not from
  // what's on screen.
  yourName: string | null;
  onRenameSelf: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismissable<HTMLDivElement>(open, close);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // A popover close (click outside, a stray Escape) discards the edit
  // too -- reopening on a half-typed editor nobody remembers opening
  // would be confusing.
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  const startEdit = () => {
    setDraft(yourName ?? "");
    setEditing(true);
  };
  const confirmEdit = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== yourName) onRenameSelf(name);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Users className="size-4" />
        <span className="tabular-nums">{count}</span>
        <span className="hidden sm:inline">{count === 1 ? "pessoa" : "pessoas"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-20 mt-2 w-56 origin-top-left rounded-md border bg-card p-2 text-card-foreground shadow-md"
          >
            <p className="mb-1 px-1.5 text-xs font-medium text-muted-foreground">Na sala</p>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {participants.map((p) => (
                <li key={p.peerId} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm">
                  {p.isYou && editing ? (
                    <div className="flex w-full items-center gap-1">
                      <Input
                        value={draft}
                        maxLength={30}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit();
                          if (e.key === "Escape") setEditing(false);
                        }}
                        className="h-7 text-sm"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0"
                        onClick={confirmEdit}
                        aria-label="Salvar nome"
                        title="Salvar nome"
                      >
                        <Check className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0"
                        onClick={() => setEditing(false)}
                        aria-label="Cancelar"
                        title="Cancelar"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="truncate">
                        {p.name}
                        {p.isYou && <span className="text-muted-foreground"> (você)</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {p.isYou && (
                          <button
                            type="button"
                            onClick={startEdit}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            aria-label="Mudar meu nome"
                            title="Mudar meu nome"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {p.publishing && (
                          <span className="flex shrink-0 items-center gap-1.5">
                            {/* Keeps my own per-viewer choice visible even with
                                the tile hidden behind its overlay. */}
                            {videoOffPeers.has(p.peerId) && (
                              <VideoOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Vídeo desativado por você" />
                            )}
                            <MonitorUp className="size-3.5 shrink-0 text-muted-foreground" aria-label="Compartilhando" />
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FullscreenTile({
  tile,
  muted,
  onToggleMuted,
  videoOff,
  onToggleVideo,
  onClose,
  aspectMode,
  onAspectModeChange,
  getPublishPc,
  getSubscribePc,
}: {
  tile: Tile;
  muted: boolean;
  onToggleMuted: () => void;
  videoOff: boolean;
  onToggleVideo: () => void;
  onClose: () => void;
  aspectMode: AspectMode;
  onAspectModeChange: (mode: AspectMode) => void;
  getPublishPc: () => RTCPeerConnection | null;
  getSubscribePc: () => RTCPeerConnection | null;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-black" data-tile="1">
      <TileVideo tile={tile} muted={muted} aspectMode={aspectMode} className="flex-1" />
      {/* Same story as the grid overlay: cover, don't unmount -- the
          audio underneath must keep playing. Placed before the bars so
          the header cluster above stays clickable. */}
      {!tile.isYou && videoOff && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80">
          <VideoOff className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">vídeo desativado</span>
          <Button size="sm" variant="secondary" onClick={onToggleVideo}>
            Ativar vídeo
          </Button>
        </div>
      )}
      <div className="absolute left-3 top-3 z-20 rounded-md bg-black/70 px-3 py-1.5 text-sm font-medium">
        {tile.name}
      </div>
      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {tile.stream && (
          <StatsButton getPc={tile.isYou ? getPublishPc : getSubscribePc} stream={tile.stream} own={tile.isYou} />
        )}
        <AspectModeButton mode={aspectMode} onChange={onAspectModeChange} />
        {tile.stream && <PipButton />}
        {!tile.isYou && <VideoToggleButton off={videoOff} onToggle={onToggleVideo} />}
        {!tile.isYou && hasAudio(tile.stream) && <MuteButton muted={muted} onToggle={onToggleMuted} />}
        <Button variant="secondary" size="sm" onClick={onClose} aria-label="Voltar para o grid">
          <AnimatedIcon animation={plusToXIcon} reverse />
          Voltar
        </Button>
      </div>
    </div>
  );
}

// Theater mode: the pinned (or automatic) tile fills the room and a
// thin strip along the bottom carries everyone as clickable
// thumbnails. Deliberately simpler than fullscreen -- no fullscreen, no
// aspect picker, one stage to watch -- the point is to hide the grid,
// not to duplicate the fullscreen controls.
function TheaterView({
  tiles,
  stage,
  onPickStage,
  mutedPeers,
  onToggleMuted,
  videoOffPeers,
  onToggleVideo,
  getPublishPc,
  getSubscribePc,
}: {
  tiles: Tile[];
  stage: string | null;
  onPickStage: (peerId: string | null) => void;
  mutedPeers: Set<string>;
  onToggleMuted: (peerId: string) => void;
  videoOffPeers: Set<string>;
  onToggleVideo: (peerId: string) => void;
  getPublishPc: () => RTCPeerConnection | null;
  getSubscribePc: () => RTCPeerConnection | null;
}) {
  // Pinned stage when it's still here, else the same automatic choice
  // the single-key shortcuts use: first remote stream, else the first
  // tile (your own).
  const stageTile = tiles.find((t) => t.peerId === stage) ?? tiles.find((t) => !t.isYou && t.stream) ?? tiles[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stageTile && (
        <div className="relative min-h-0 flex-1" data-tile="1">
          <TileVideo tile={stageTile} muted={mutedPeers.has(stageTile.peerId)} />
          {/* Same cover-don't-unmount story as the grid and fullscreen:
              the audio lives on the stream under the picture. */}
          {!stageTile.isYou && videoOffPeers.has(stageTile.peerId) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80">
              <VideoOff className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">vídeo desativado</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onToggleVideo(stageTile.peerId)}
              >
                Ativar vídeo
              </Button>
            </div>
          )}
          <div className="absolute left-3 top-3 z-20 rounded-md bg-black/70 px-3 py-1.5 text-sm font-medium">
            {stageTile.name}
          </div>
          <div className="absolute right-3 top-3 z-20 flex gap-2">
            {stageTile.stream && (
              <StatsButton
                getPc={stageTile.isYou ? getPublishPc : getSubscribePc}
                stream={stageTile.stream}
                own={stageTile.isYou}
              />
            )}
            {stageTile.stream && <PipButton />}
            {!stageTile.isYou && (
              <VideoToggleButton
                off={videoOffPeers.has(stageTile.peerId)}
                onToggle={() => onToggleVideo(stageTile.peerId)}
              />
            )}
            {!stageTile.isYou && hasAudio(stageTile.stream) && (
              <MuteButton
                muted={mutedPeers.has(stageTile.peerId)}
                onToggle={() => onToggleMuted(stageTile.peerId)}
              />
            )}
          </div>
        </div>
      )}
      {tiles.length > 1 && (
        <div className="flex h-20 shrink-0 items-center gap-2 overflow-x-auto border-t bg-black/40 p-2">
          {tiles.map((t) => (
            <button
              key={t.peerId}
              type="button"
              data-tile="1"
              onClick={() => onPickStage(t.peerId)}
              className={
                "relative h-full aspect-video shrink-0 overflow-hidden rounded-md border bg-black " +
                (t.peerId === stageTile?.peerId
                  ? "ring-2 ring-ring"
                  : "opacity-75 transition-opacity hover:opacity-100")
              }
              title={`Colocar ${t.name} no palco`}
            >
              {/* Thumbnails are always silent -- the stage is the only
                  thing allowed to sound, or a tile would play twice. */}
              <TileVideo tile={t} muted />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px]">
                {t.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The fullscreen tile's fit selector. Was a single button that cycled
// the five modes blindly -- you couldn't go back one step without
// walking the list around -- so it's a small popover now, same
// dismissal mechanics as the PeopleList.
function AspectModeButton({ mode, onChange }: { mode: AspectMode; onChange: (mode: AspectMode) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrapRef = useDismissable<HTMLDivElement>(open, close);
  const current = ASPECT_MODES.find((m) => m.mode === mode) ?? ASPECT_MODES[0];
  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ajuste de tela: ${current.label}`}
        title={`Ajuste de tela: ${current.label}`}
      >
        <Crop className="size-4" />
        {current.label}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-30 mt-2 w-52 origin-top-right rounded-md border bg-card p-1 text-card-foreground shadow-md"
          >
            {ASPECT_MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-pressed={m.mode === mode}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(m.mode);
                  close();
                }}
                className={
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground" +
                  (m.mode === mode ? " font-medium" : "")
                }
              >
                <Check className={"size-3.5 shrink-0" + (m.mode === mode ? "" : " invisible")} />
                {m.label}
                {m.ratio && <span className="ml-auto text-xs text-muted-foreground">{m.ratio}</span>}
              </button>
            ))}
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              As proporções fixas exibem tudo, sem cortar. "Preencher" recorta de propósito.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TileVideo({
  tile,
  muted,
  aspectMode = "auto",
  className = "",
}: {
  tile: Tile;
  muted: boolean;
  aspectMode?: AspectMode;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = tile.stream;
    if (!tile.stream) {
      setNeedsTap(false);
      return;
    }
    const stream = tile.stream;
    // A re-enabled track usually arrives on the SAME MediaStream the
    // element is already playing -- the server keeps one stream per
    // publisher (its id is the publisher's peer id), so re-assigning
    // srcObject would be referentially identical and the effect wouldn't
    // even rerun. Listening for the track and re-seating it is what
    // makes the picture come back after a video opt-out is undone.
    const reseat = () => {
      video.srcObject = stream;
      // Clears the tap overlay too: the first play() attempt (right
      // after a remount) can lose the autoplay race and put the overlay
      // up, while this later one -- same gesture era, media now
      // flowing -- succeeds. Leaving needsTap set would park a "Toque
      // para assistir" sheet on top of a video that is, in fact,
      // already playing.
      video.play().then(
        () => setNeedsTap(false),
        () => {},
      );
    };
    stream.addEventListener("addtrack", reseat);
    // Phones refuse to autoplay anything carrying sound. Rather than
    // muting other people's streams outright (and silently dropping
    // their audio), try to play and fall back to asking for the one tap
    // the browser is waiting for. My own tile is always muted -- playing
    // my own microphone back at me would echo.
    video.play().then(
      () => setNeedsTap(false),
      () => setNeedsTap(true),
    );
    return () => stream.removeEventListener("addtrack", reseat);
  }, [tile.stream]);

  if (!tile.stream) {
    return (
      <div className={`flex h-full w-full items-center justify-center text-sm text-muted-foreground ${className}`}>
        conectando…
      </div>
    );
  }

  // "auto" shows the stream at its real ratio, untouched (object-contain,
  // filling the tile). The fixed ratios (16:9, 4:3, 1:1) constrain the
  // VIDEO element itself to a box of that shape -- with aspectRatio on a
  // replaced element plus max-w/max-h, CSS resolves "the largest box of
  // this ratio that fits", so a 16:9 stream under a 4:3 box keeps its
  // whole picture letterboxed instead of having its sides shaved off the
  // way object-cover did. "fill" is the one deliberate crop.
  const fixedRatio = ASPECT_MODES.find((m) => m.mode === aspectMode)?.ratio;
  const fit = fixedRatio
    ? "max-h-full max-w-full object-contain"
    : aspectMode === "fill"
      ? "h-full w-full object-cover"
      : "h-full w-full object-contain";

  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // My own tile is always silent -- playing my own microphone back
        // at me would echo. Everyone else's follows this viewer's choice.
        muted={tile.isYou || muted}
        style={fixedRatio ? { aspectRatio: fixedRatio } : undefined}
        className={fit}
      />
      {needsTap && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            const video = videoRef.current;
            if (!video) return;
            video.play().then(
              () => setNeedsTap(false),
              () => {
                // Still blocked -- muting always satisfies the autoplay
                // policy, so at least the picture starts.
                video.muted = true;
                void video.play();
                setNeedsTap(false);
              },
            );
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70"
        >
          <AnimatedIcon animation={playPauseCircleIcon} size={40} />
          <span className="text-sm font-medium">Toque para assistir</span>
        </span>
      )}
    </div>
  );
}

function MuteButton({
  muted,
  onToggle,
  className = "",
}: {
  muted: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      // Grid tiles are themselves buttons that open fullscreen, so this
      // must not bubble up into that.
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={className}
      aria-label={muted ? "Ativar som" : "Silenciar"}
      title={muted ? "Ativar som" : "Silenciar"}
    >
      <AnimatedIcon animation={volumeIcon} reverse={muted} />
    </Button>
  );
}

// Picture-in-picture for one tile's stream: the browser floats the
// picture in an always-on-top window, so the stream keeps playing
// (sound included) while this tab shows something else -- or the whole
// browser is minimized. Only one video may sit in PiP at a time, so
// the active state is tracked at document level, not per button. iOS
// Safari deliberately ships no web PiP, hence the availability check.
function PipButton({ className = "" }: { className?: string }) {
  const [inPip, setInPip] = useState(false);
  useEffect(() => {
    const sync = () => setInPip(document.pictureInPictureElement !== null);
    document.addEventListener("enterpictureinpicture", sync);
    document.addEventListener("leavepictureinpicture", sync);
    return () => {
      document.removeEventListener("enterpictureinpicture", sync);
      document.removeEventListener("leavepictureinpicture", sync);
    };
  }, []);

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        // The button and the <video> always share a tile root; looking
        // the video up here saves threading a ref through Grid,
        // TileVideo and FullscreenTile.
        const video = e.currentTarget.closest("[data-tile]")?.querySelector("video");
        if (!(video instanceof HTMLVideoElement)) return;
        if (document.pictureInPictureElement === video) {
          void document.exitPictureInPicture().catch(() => {});
          return;
        }
        void video.requestPictureInPicture().catch(() => {});
      }}
      className={className}
      aria-label={inPip ? "Sair do picture-in-picture" : "Assistir em picture-in-picture"}
      title={inPip ? "Sair do picture-in-picture" : "Assistir em picture-in-picture"}
    >
      <PictureInPicture2 className="size-4" />
    </Button>
  );
}

// Per-viewer, server-side video opt-out for one publisher: the SFU stops
// forwarding this person's video frames (audio never stops). The choice
// lives in the room hook, keyed by peer id, so it survives reconnects.
function VideoToggleButton({
  off,
  onToggle,
  className = "",
}: {
  off: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={className}
      aria-label={off ? "Ativar vídeo" : "Desativar vídeo"}
      title={off ? "Ativar vídeo" : "Desativar vídeo (o áudio continua)"}
    >
      {off ? <VideoOff className="size-4" /> : <Video className="size-4" />}
    </Button>
  );
}

// Connection numbers for one tile, read live from getStats(). The poller
// only runs while this popover is open, so a room never stats itself in
// the background; opening a different panel closes this one first
// (useDismissable), which keeps at most one poller alive.
function StatsButton({
  getPc,
  stream,
  own,
  className = "",
}: {
  getPc: () => RTCPeerConnection | null;
  stream: MediaStream | null;
  own: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrapRef = useDismissable<HTMLDivElement>(open, close);
  const stats = usePeerStats({ getPc, stream, own, active: open });

  const bitrate = (bps: number | null) =>
    bps === null ? "—" : bps >= 1_000_000 ? `${(bps / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mb/s` : `${Math.max(1, Math.round(bps / 1000)).toLocaleString("pt-BR")} kb/s`;

  return (
    <div ref={wrapRef} className={className}>
      <Button
        variant="secondary"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Estatísticas de conexão"
        title="Estatísticas de conexão"
      >
        <Activity className="size-4" />
      </Button>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.15 }}
          className="absolute right-2 top-10 z-30 w-56 rounded-md border bg-card p-3 text-card-foreground shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          {stats === null ? (
            <p className="text-xs text-muted-foreground">coletando…</p>
          ) : (
            <dl className="space-y-1 text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{own ? "Enviando" : "Recebendo"}</dt>
                <dd>{bitrate(stats.bitrateBps)}</dd>
              </div>
              {stats.audioBitrateBps !== null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Áudio</dt>
                  <dd>{bitrate(stats.audioBitrateBps)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">RTT</dt>
                <dd>{stats.rttMs === null ? "—" : `${Math.round(stats.rttMs)} ms`}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Perda</dt>
                <dd>{stats.lossPct === null ? "—" : `${stats.lossPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Vídeo</dt>
                <dd>
                  {stats.width === null || stats.height === null
                    ? "—"
                    : `${stats.width}×${stats.height}`}
                  {stats.fps !== null && ` @ ${Math.round(stats.fps)} fps`}
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            RTT mede o caminho até o servidor SFU -- para todo mundo assistindo, é o mesmo número.
          </p>
        </motion.div>
      )}
    </div>
  );
}

function Empty({ roomId, password }: { roomId: string; password?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
      <p>Ninguém está compartilhando ainda.</p>
      {canShareScreen ? (
        <p className="mt-2 text-sm">Qualquer pessoa na sala pode começar — inclusive você.</p>
      ) : (
        <p className="mt-2 max-w-xs text-sm">
          Você pode compartilhar sua câmera. Compartilhar a tela do celular não é possível pelo navegador — para
          isso, abra esta sala num computador.
        </p>
      )}
      {password ? (
        <>
          <p className="mt-4 text-sm">
            Passe o código <Code>{roomId}</Code> e a senha para quem for entrar, ou envie o link direto:
          </p>
          <div className="mt-3">
            <CopyLinkWithPassword roomId={roomId} password={password} variant="outline" />
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm">
          Quem não tiver a senha pode pedir para entrar direto pelo código <Code>{roomId}</Code>.
        </p>
      )}
      <p className="mt-6 text-xs text-muted-foreground/80">
        Atalhos: <span className="font-mono">F</span> tela cheia · <span className="font-mono">M</span> mudo ·{" "}
        <span className="font-mono">V</span> vídeo · <span className="font-mono">S</span> compartilhar
      </p>
    </div>
  );
}

function CopyLinkWithPassword({
  roomId,
  password,
  variant = "secondary",
}: {
  roomId: string;
  password: string;
  variant?: "secondary" | "outline" | "default";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = `${window.location.origin}/r/${roomId}?pwd=${encodeURIComponent(password)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (navigator.share) {
        navigator.share({ title: `tela - Sala ${roomId}`, url: link }).catch(() => {});
      }
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={copy}
      title="Copiar link direto com senha"
      className="gap-1.5"
    >
      {copied ? (
        <AnimatedIcon animation={checkmarkIcon} autoplay className="text-green-500" />
      ) : (
        <Link2 className="size-4" />
      )}
      <span className="hidden sm:inline">{copied ? "Link com senha copiado!" : "Copiar link com senha"}</span>
      <span className="sm:hidden">{copied ? "Copiado!" : "Link com senha"}</span>
    </Button>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard API is unavailable in plenty of mobile contexts.
      // A share sheet is the natural fallback on a phone, and the code
      // is on screen to read out either way.
      if (navigator.share) {
        navigator.share({ title: "tela", url: link }).catch(() => {});
      }
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={copy} className="font-mono tracking-widest" title="Copiar código / link da sala">
      <AnimatedIcon animation={copied ? checkmarkIcon : copyIcon} autoplay={copied} />
      {code}
    </Button>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono tracking-widest">{children}</span>;
}
