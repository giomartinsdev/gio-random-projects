import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Crop, Link2, MonitorUp, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { canShareScreen, useRoom, type Credential, QUALITY_OPTIONS } from "@/lib/useRoom";
import { useWakeLock } from "@/lib/useWakeLock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { ShareDialog, type ShareChoice } from "@/components/ShareDialog";
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

  // The share panel: opened by the header's "Compartilhar" button, or by
  // its "Qualidade" variant once a share is already live.
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // True from confirm until the capture settles -- while the browser's
  // own picker is up the button stays inert, so a double click can't
  // queue two getDisplayMedia calls (the hook also guards this, this
  // just keeps the button honest).
  const [starting, setStarting] = useState(false);

  const toggleMuted = (peerId: string) =>
    setMutedPeers((current) => {
      const next = new Set(current);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });

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

  useWakeLock(tiles.length > 0);

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

  // Whatever the dialog confirms: live shares only retune the encoder
  // (see applyQuality) -- a real change of source/quality is the next
  // share's business. `starting` covers the browser picker window.
  const confirmShare = (choice: ShareChoice) => {
    setShareDialogOpen(false);
    if (room.isSharing) {
      room.applyQuality(choice.quality, choice.fps);
      return;
    }
    setStarting(true);
    const surface = choice.source === "screen" ? choice.surface : undefined;
    room
      .startSharing(choice.source, choice.quality, choice.fps, surface)
      .finally(() => setStarting(false));
  };

  // Label for the live "Qualidade" button, showing what's actually
  // being sent right now.
  const qualityLabel = QUALITY_OPTIONS.find((o) => o.value === room.quality)?.label ?? String(room.quality);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <Link to="/" className="text-lg font-bold tracking-tight">
          tela
        </Link>
        <CopyableCode code={roomId} />
        {password && <CopyLinkWithPassword roomId={roomId} password={password} />}
        <PeopleList count={peopleCount} participants={participants} />
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
            the dialog, mid-stream via its live variant. */}
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {room.isSharing ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setShareDialogOpen(true)}
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
              <Button onClick={() => setShareDialogOpen(true)} disabled={starting} className="w-full">
                <AnimatedIcon animation={canShareScreen ? airplayIcon : videoIcon} />
                {canShareScreen ? "Compartilhar" : "Compartilhar câmera"}
              </Button>
            </motion.div>
          )}
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

        {selectedTile ? (
          <FullscreenTile
            tile={selectedTile}
            muted={mutedPeers.has(selectedTile.peerId)}
            onToggleMuted={() => toggleMuted(selectedTile.peerId)}
            onClose={closeFullscreenTile}
            aspectMode={aspectMode}
            onAspectModeChange={setAspectMode}
          />
        ) : tiles.length === 0 ? (
          <Empty roomId={roomId} password={password} />
        ) : (
          <Grid tiles={tiles} mutedPeers={mutedPeers} onToggleMuted={toggleMuted} onSelect={openFullscreenTile} />
        )}

        {room.errorMessage && (
          <div className="absolute inset-x-4 bottom-4">
            <Alert variant="destructive">
              <AlertDescription className="font-mono text-xs">{room.errorMessage}</AlertDescription>
            </Alert>
          </div>
        )}
      </main>

      <ShareDialog
        open={shareDialogOpen}
        canScreenShare={canShareScreen}
        sharing={room.isSharing}
        initial={{ source: canShareScreen ? "screen" : "camera", quality: room.quality, fps: room.fps, surface: room.surface }}
        onOpenChange={setShareDialogOpen}
        onConfirm={confirmShare}
      />
    </div>
  );
}

function Grid({
  tiles,
  mutedPeers,
  onToggleMuted,
  onSelect,
}: {
  tiles: Tile[];
  mutedPeers: Set<string>;
  onToggleMuted: (peerId: string) => void;
  onSelect: (peerId: string) => void;
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
            className="group relative min-h-0 overflow-hidden rounded-lg border bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TileVideo tile={tile} muted={mutedPeers.has(tile.peerId)} />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-left text-sm">
              <span className="truncate font-medium">{tile.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                ver em tela cheia
              </span>
            </span>
            {/* Own tile is always silent (hearing yourself back echoes),
                so there's nothing to toggle on it. */}
            {!tile.isYou && hasAudio(tile.stream) && (
              <MuteButton
                muted={mutedPeers.has(tile.peerId)}
                onToggle={() => onToggleMuted(tile.peerId)}
                className="absolute right-2 top-2"
              />
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
}: {
  count: number;
  participants: { peerId: string; name: string; isYou: boolean; publishing: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismissable<HTMLDivElement>(open, close);

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
                  <span className="truncate">
                    {p.name}
                    {p.isYou && <span className="text-muted-foreground"> (você)</span>}
                  </span>
                  {p.publishing && (
                    <MonitorUp className="size-3.5 shrink-0 text-muted-foreground" aria-label="Compartilhando" />
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
  onClose,
  aspectMode,
  onAspectModeChange,
}: {
  tile: Tile;
  muted: boolean;
  onToggleMuted: () => void;
  onClose: () => void;
  aspectMode: AspectMode;
  onAspectModeChange: (mode: AspectMode) => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-black">
      <TileVideo tile={tile} muted={muted} aspectMode={aspectMode} className="flex-1" />
      <div className="absolute left-3 top-3 rounded-md bg-black/70 px-3 py-1.5 text-sm font-medium">
        {tile.name}
      </div>
      <div className="absolute right-3 top-3 flex gap-2">
        <AspectModeButton mode={aspectMode} onChange={onAspectModeChange} />
        {!tile.isYou && hasAudio(tile.stream) && <MuteButton muted={muted} onToggle={onToggleMuted} />}
        <Button variant="secondary" size="sm" onClick={onClose} aria-label="Voltar para o grid">
          <AnimatedIcon animation={plusToXIcon} reverse />
          Voltar
        </Button>
      </div>
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
    // Phones refuse to autoplay anything carrying sound. Rather than
    // muting other people's streams outright (and silently dropping
    // their audio), try to play and fall back to asking for the one tap
    // the browser is waiting for. My own tile is always muted -- playing
    // my own microphone back at me would echo.
    video.play().then(
      () => setNeedsTap(false),
      () => setNeedsTap(true),
    );
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
