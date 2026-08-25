import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Check, Copy, Eye, Loader2, MonitorUp, Play, ScreenShareOff, Video } from "lucide-react";
import { api, readHostToken } from "@/lib/api";
import { canShareCamera, canShareScreen, useScreenShare } from "@/lib/useScreenShare";
import { useWakeLock } from "@/lib/useWakeLock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Room() {
  const { id } = useParams<{ id: string }>();
  const roomId = (id ?? "").toUpperCase();
  const location = useLocation();

  const hostToken = readHostToken(roomId);
  // Passed through navigation state by the join form so the password
  // never lands in the URL. Someone opening a shared link directly has
  // no state, and gets the password prompt below instead.
  const [password, setPassword] = useState<string | null>(
    (location.state as { password?: string } | null)?.password ?? null,
  );

  if (hostToken) return <HostRoom roomId={roomId} token={hostToken} />;
  if (password) return <ViewerRoom roomId={roomId} password={password} />;
  return <PasswordPrompt roomId={roomId} onUnlocked={setPassword} />;
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
          <CardDescription>Digite a senha para assistir.</CardDescription>
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

function HostRoom({ roomId, token }: { roomId: string; token: string }) {
  const share = useScreenShare({ role: "host", roomId, token });
  const videoRef = useRef<HTMLVideoElement>(null);
  useWakeLock(share.isSharing);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = share.localStream;
  }, [share.localStream]);

  if (share.status === "host-taken") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{share.errorMessage ?? "Essa sala já tem alguém compartilhando."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <RoomLayout
      roomId={roomId}
      badge={
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Eye className="size-4" />
          <span className="tabular-nums">{share.viewerCount}</span>
          <span className="hidden sm:inline">
            {share.viewerCount === 1 ? "pessoa assistindo" : "pessoas assistindo"}
          </span>
        </span>
      }
      actions={
        share.isSharing ? (
          <Button variant="destructive" onClick={share.stopSharing} className="flex-1 sm:flex-none">
            <ScreenShareOff />
            Parar
          </Button>
        ) : (
          <>
            {canShareScreen && (
              <Button onClick={() => share.startSharing("screen")} className="flex-1 sm:flex-none">
                <MonitorUp />
                Compartilhar tela
              </Button>
            )}
            {canShareCamera && (
              <Button
                variant={canShareScreen ? "secondary" : "default"}
                onClick={() => share.startSharing("camera")}
                className="flex-1 sm:flex-none"
              >
                <Video />
                Câmera
              </Button>
            )}
          </>
        )
      }
    >
      {share.isSharing ? (
        <video ref={videoRef} autoPlay playsInline muted className="w-full flex-1 min-h-0 object-contain" />
      ) : (
        <Empty>
          {canShareScreen ? (
            <p>Escolha compartilhar sua tela ou sua câmera.</p>
          ) : (
            <>
              <p>Compartilhe sua câmera para começar.</p>
              {/* Not something to work around: no mobile browser
                  implements getDisplayMedia, so this is worth saying
                  plainly rather than leaving a button that can only fail. */}
              <p className="mt-2 max-w-xs text-sm">
                Compartilhar a tela do celular não é possível pelo navegador — para isso, abra esta sala num
                computador.
              </p>
            </>
          )}
          <p className="mt-4 text-sm">
            Passe o código <Code>{roomId}</Code> e a senha para quem vai assistir.
          </p>
        </Empty>
      )}

      {share.errorMessage && (
        <div className="absolute inset-x-4 bottom-4">
          <Alert variant="destructive">
            <AlertDescription className="font-mono text-xs">{share.errorMessage}</AlertDescription>
          </Alert>
        </div>
      )}
    </RoomLayout>
  );
}

function ViewerRoom({ roomId, password }: { roomId: string; password: string }) {
  const share = useScreenShare({ role: "viewer", roomId, password });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsTap, setNeedsTap] = useState(false);
  useWakeLock(share.remoteStream !== null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = share.remoteStream;
    if (!share.remoteStream) {
      setNeedsTap(false);
      return;
    }
    // Phones refuse to autoplay anything carrying sound. Rather than
    // muting the stream outright (and silently losing whatever audio the
    // host is sharing), try to play and fall back to asking for the one
    // tap the browser is waiting for.
    video.play().then(
      () => setNeedsTap(false),
      () => setNeedsTap(true),
    );
  }, [share.remoteStream]);

  function playNow() {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(
      () => setNeedsTap(false),
      () => {
        // Still blocked -- muting always satisfies the autoplay policy,
        // so at least the picture starts.
        video.muted = true;
        void video.play();
        setNeedsTap(false);
      },
    );
  }

  return (
    <RoomLayout
      roomId={roomId}
      badge={
        <span className="text-sm text-muted-foreground">
          {share.status === "connected" ? "assistindo" : "conectando…"}
        </span>
      }
    >
      {share.remoteStream ? (
        <>
          <video ref={videoRef} autoPlay playsInline className="w-full flex-1 min-h-0 object-contain" />
          {needsTap && (
            <button
              onClick={playNow}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70"
            >
              <Play className="size-12" />
              <span className="text-lg font-medium">Toque para assistir</span>
            </button>
          )}
        </>
      ) : (
        <Empty>
          {share.hostOnline ? (
            <p>Aguardando a pessoa escolher o que compartilhar…</p>
          ) : (
            <p>Ninguém está compartilhando nessa sala ainda.</p>
          )}
        </Empty>
      )}
    </RoomLayout>
  );
}

function RoomLayout({
  roomId,
  badge,
  actions,
  children,
}: {
  roomId: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // dvh, not vh: on mobile the browser's own chrome slides in and out,
    // and vh is measured against the tallest state -- a vh-sized page is
    // permanently a little taller than what's actually visible.
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <Link to="/" className="text-lg font-bold tracking-tight">
          tela
        </Link>
        <CopyableCode code={roomId} />
        {badge}
        {/* Full width on a phone (the buttons split the row), pushed to
            the right once there's room for everything on one line. */}
        {actions && <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">{actions}</div>}
      </header>
      <main className="relative flex flex-1 bg-black">{children}</main>
    </div>
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
    <Button variant="secondary" size="sm" onClick={copy} className="font-mono tracking-widest">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {code}
    </Button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono tracking-widest">{children}</span>;
}
