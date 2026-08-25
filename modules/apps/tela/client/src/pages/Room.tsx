import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Check, Copy, Eye, Loader2, MonitorUp, ScreenShareOff } from "lucide-react";
import { readHostToken } from "@/lib/api";
import { useScreenShare } from "@/lib/useScreenShare";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";

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
    <Shell>
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
    </Shell>
  );
}

function HostRoom({ roomId, token }: { roomId: string; token: string }) {
  const share = useScreenShare({ role: "host", roomId, token });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = share.localStream;
  }, [share.localStream]);

  if (share.status === "host-taken") {
    return (
      <Shell>
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>
            {share.errorMessage ?? "Essa sala já tem alguém compartilhando."}
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  return (
    <RoomLayout
      roomId={roomId}
      badge={
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Eye className="size-4" />
          {share.viewerCount} {share.viewerCount === 1 ? "pessoa assistindo" : "pessoas assistindo"}
        </span>
      }
      actions={
        share.isSharing ? (
          <Button variant="destructive" onClick={share.stopSharing}>
            <ScreenShareOff />
            Parar
          </Button>
        ) : (
          <Button onClick={share.startSharing}>
            <MonitorUp />
            Compartilhar tela
          </Button>
        )
      }
    >
      {share.isSharing ? (
        <video ref={videoRef} autoPlay playsInline muted className="w-full flex-1 min-h-0 object-contain" />
      ) : (
        <Empty>
          <p>Clique em "Compartilhar tela" para começar.</p>
          <p className="mt-1 text-sm">
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

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = share.remoteStream;
  }, [share.remoteStream]);

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
        <video ref={videoRef} autoPlay playsInline className="w-full flex-1 min-h-0 object-contain" />
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
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-bold tracking-tight">
            tela
          </Link>
          <CopyableCode code={roomId} />
          {badge}
        </div>
        {actions}
      </header>
      <main className="relative flex flex-1 bg-black">{children}</main>
    </div>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permissions) -- the code is
      // on screen to read out either way.
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

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-4 py-12">{children}</div>;
}
