import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Check, Copy, Crop, Link2, Loader2, Mic, MicOff, MonitorUp, Play, ScreenShareOff, Users, Video, Volume2, VolumeX, X } from "lucide-react";
import { api } from "@/lib/api";
import { canShareCamera, canShareScreen, useRoom } from "@/lib/useRoom";
import { useWakeLock } from "@/lib/useWakeLock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// A viewer's own preference for how the fullscreen tile fits its
// space -- purely local rendering, never touches the publisher's
// actual stream/encoding (see useRoom.ts for that). "auto" letterboxes
// at the stream's real ratio; the fixed ratios crop/pad to match a
// specific shape (useful for a game recorded 4:3, say, watched on a
// 16:9 screen); "fill" crops to cover the tile edge-to-edge regardless
// of ratio.
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
  const roomId = (id ?? "").toUpperCase();
  const location = useLocation();

  // Password can arrive through:
  // 1. Navigation state (joining / creating from home)
  // 2. Query param ?pwd=... / ?password=... / ?p=... (direct link shared with password)
  // 3. Hash #pwd=... / #password=... / #p=...
  const [password, setPassword] = useState<string | null>(() => {
    const statePassword = (location.state as { password?: string } | null)?.password;
    if (statePassword) return statePassword;

    const searchParams = new URLSearchParams(location.search);
    const queryPwd = searchParams.get("pwd") || searchParams.get("password") || searchParams.get("p");
    if (queryPwd) return queryPwd;

    if (location.hash) {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
      const hashPwd = hashParams.get("pwd") || hashParams.get("password") || hashParams.get("p");
      if (hashPwd) return hashPwd;
    }

    return null;
  });

  if (!password) return <PasswordPrompt roomId={roomId} onUnlocked={setPassword} />;
  return <LiveRoom roomId={roomId} password={password} onResetPassword={() => setPassword(null)} />;
}

function PasswordPrompt({ roomId, onUnlocked }: { roomId: string; onUnlocked: (p: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      await api.checkPassword(roomId, password);
      onUnlocked(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sala {roomId}</CardTitle>
          <CardDescription>Digite a senha para entrar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
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
              {checking && <Loader2 className="animate-spin" />}
              Entrar
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
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
  password,
  onResetPassword,
}: {
  roomId: string;
  password: string;
  onResetPassword?: () => void;
}) {
  const room = useRoom(roomId, password);
  const [selected, setSelected] = useState<string | null>(null);
  // Which people I've muted, decided per stream and only on my side --
  // muting someone here doesn't stop them sending audio to anyone else.
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  // One choice for the whole session, not per-tile: switching who
  // you're watching in fullscreen keeps whatever fit you picked
  // instead of resetting to "Original" every time.
  const [aspectMode, setAspectMode] = useState<AspectMode>("auto");

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

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const selectedTile = tiles.find((t) => t.peerId === selected) ?? null;
  const peopleCount = room.peers.length + 1;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <Link to="/" className="text-lg font-bold tracking-tight">
          tela
        </Link>
        <CopyableCode code={roomId} />
        <CopyLinkWithPassword roomId={roomId} password={password} />
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span className="tabular-nums">{peopleCount}</span>
          <span className="hidden sm:inline">{peopleCount === 1 ? "pessoa" : "pessoas"}</span>
        </span>
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

        {/* Full width on a phone (the buttons split the row), pushed to
            the right once everything fits on one line. */}
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {room.isSharing ? (
            <>
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
                {room.sendingAudio && room.hasAudioTrack ? <Mic /> : <MicOff />}
                <span className="sm:hidden">{room.sendingAudio && room.hasAudioTrack ? "Áudio" : "Sem áudio"}</span>
                <span className="hidden sm:inline">
                  {!room.hasAudioTrack ? "Sem áudio" : room.sendingAudio ? "Enviando áudio" : "Áudio desligado"}
                </span>
              </Button>
              <Button variant="destructive" onClick={room.stopSharing} className="flex-1 sm:flex-none">
                <ScreenShareOff />
                Parar
              </Button>
            </>
          ) : (
            <>
              {canShareScreen && (
                <Button onClick={() => room.startSharing("screen")} className="flex-1 sm:flex-none">
                  <MonitorUp />
                  Compartilhar tela
                </Button>
              )}
              {canShareCamera && (
                <Button
                  variant={canShareScreen ? "secondary" : "default"}
                  onClick={() => room.startSharing("camera")}
                  className="flex-1 sm:flex-none"
                >
                  <Video />
                  Câmera
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      <main className="relative flex flex-1 bg-black">
        {room.status === "error" && (
          <div className="absolute inset-x-4 top-4 z-10 mx-auto max-w-md">
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
          </div>
        )}

        {selectedTile ? (
          <FullscreenTile
            tile={selectedTile}
            muted={mutedPeers.has(selectedTile.peerId)}
            onToggleMuted={() => toggleMuted(selectedTile.peerId)}
            onClose={() => setSelected(null)}
            aspectMode={aspectMode}
            onAspectModeChange={setAspectMode}
          />
        ) : tiles.length === 0 ? (
          <Empty roomId={roomId} password={password} />
        ) : (
          <Grid tiles={tiles} mutedPeers={mutedPeers} onToggleMuted={toggleMuted} onSelect={setSelected} />
        )}

        {room.errorMessage && (
          <div className="absolute inset-x-4 bottom-4">
            <Alert variant="destructive">
              <AlertDescription className="font-mono text-xs">{room.errorMessage}</AlertDescription>
            </Alert>
          </div>
        )}
      </main>
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
      {tiles.map((tile) => (
        <button
          key={tile.peerId}
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
        </button>
      ))}
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
          <X className="size-4" />
          Voltar
        </Button>
      </div>
    </div>
  );
}

// Cycles through ASPECT_MODES on each click rather than a dropdown --
// only 5 options, and a single tap/click is faster than opening a
// menu for something people will flip a few times per session at most.
function AspectModeButton({ mode, onChange }: { mode: AspectMode; onChange: (mode: AspectMode) => void }) {
  const index = ASPECT_MODES.findIndex((m) => m.mode === mode);
  const current = ASPECT_MODES[index] ?? ASPECT_MODES[0];
  const next = ASPECT_MODES[(index + 1) % ASPECT_MODES.length];
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onChange(next.mode);
      }}
      aria-label={`Ajuste de tela: ${current.label} (toque para ${next.label})`}
      title={`Ajuste de tela: ${current.label} (toque para ${next.label})`}
    >
      <Crop className="size-4" />
      {current.label}
    </Button>
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
  // no fixed box). The fixed ratios (16:9, 4:3, 1:1) bound a box of that
  // shape and crop the video to fill it -- a deliberate re-frame, not a
  // letterbox. "fill" skips the box and crops straight to the tile.
  const fixedRatio = ASPECT_MODES.find((m) => m.mode === aspectMode)?.ratio;
  const fit = aspectMode === "auto" ? "object-contain" : "object-cover";

  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}>
      <div
        className={fixedRatio ? "relative" : "relative h-full w-full"}
        style={fixedRatio ? { aspectRatio: fixedRatio, height: "100%", width: "auto", maxWidth: "100%" } : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // My own tile is always silent -- playing my own microphone back
          // at me would echo. Everyone else's follows this viewer's choice.
          muted={tile.isYou || muted}
          className={`h-full w-full ${fit}`}
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
            <Play className="size-10" />
            <span className="text-sm font-medium">Toque para assistir</span>
          </span>
        )}
      </div>
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
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </Button>
  );
}

function Empty({ roomId, password }: { roomId: string; password: string }) {
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
      <p className="mt-4 text-sm">
        Passe o código <Code>{roomId}</Code> e a senha para quem for entrar, ou envie o link direto:
      </p>
      <div className="mt-3">
        <CopyLinkWithPassword roomId={roomId} password={password} variant="outline" />
      </div>
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
      {copied ? <Check className="size-4 text-green-500" /> : <Link2 className="size-4" />}
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
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {code}
    </Button>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono tracking-widest">{children}</span>;
}
