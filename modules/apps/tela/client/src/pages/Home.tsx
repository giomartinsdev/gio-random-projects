import { useState } from "react";
import { useNavigate } from "react-router";
import { MonitorUp, LogIn, Loader2 } from "lucide-react";
import { api, rememberHostToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Home() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const { roomId, hostToken } = await api.createRoom(createPassword);
      // Kept out of the URL on purpose -- the link is meant to be
      // shared, and anyone holding this token could take over the share.
      rememberHostToken(roomId, hostToken);
      navigate(`/r/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível criar a sala");
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (joining) return;
    setError(null);
    setJoining(true);
    const code = joinCode.trim().toUpperCase();
    try {
      // Checked here so a wrong password is a clear message rather than
      // a WebSocket that just refuses to open.
      await api.checkPassword(code, joinPassword);
      navigate(`/r/${code}`, { state: { password: joinPassword } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight">tela</h1>
          <p className="mt-2 text-muted-foreground">
            Compartilhe sua tela por um link e uma senha. Sem cadastro.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Começar</CardTitle>
            <CardDescription>Crie uma sala para compartilhar, ou entre numa que te passaram.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              defaultValue="create"
              onValueChange={() => setError(null)}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="create">Compartilhar</TabsTrigger>
                <TabsTrigger value="join">Assistir</TabsTrigger>
              </TabsList>

              <TabsContent value="create">
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="create-password">Senha da sala</Label>
                    <Input
                      id="create-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="mínimo 4 caracteres"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      required
                      minLength={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Quem quiser assistir vai precisar dela junto com o código da sala.
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={creating}>
                    {creating ? <Loader2 className="animate-spin" /> : <MonitorUp />}
                    Criar sala
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="join">
                <form onSubmit={handleJoin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="join-code">Código da sala</Label>
                    <Input
                      id="join-code"
                      placeholder="ABC123"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      className="font-mono tracking-widest uppercase"
                      maxLength={6}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="join-password">Senha</Label>
                    <Input
                      id="join-password"
                      type="password"
                      autoComplete="current-password"
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={joining}>
                    {joining ? <Loader2 className="animate-spin" /> : <LogIn />}
                    Entrar
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          O vídeo vai direto de um navegador pro outro. O servidor só apresenta os dois.
        </p>
      </div>
    </div>
  );
}
