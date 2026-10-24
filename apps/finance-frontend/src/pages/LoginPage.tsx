import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import {
  GOOGLE_CLIENT_ID,
  loadGoogleIdentityScript,
  loginConfigurado,
  loginWithGoogle,
} from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

// Tela de entrada: o botão oficial do Google (renderizado pelo próprio GIS,
// não um link estilizado — é ele que entrega o ID token que o finance-api
// verifica). Mesmo desenho do clubs-frontend.
export function LoginPage({ onLogged }: { onLogged: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    if (!loginConfigurado()) return;
    let alive = true;
    loadGoogleIdentityScript()
      .then(() => {
        if (!alive || !window.google?.accounts?.id || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            setEntrando(true);
            setError("");
            try {
              await loginWithGoogle(response.credential);
              onLogged();
            } catch {
              if (alive) {
                setError("Não conseguimos entrar com essa conta. Tente de novo.");
                setEntrando(false);
              }
            }
          },
        });
        window.google.accounts.id.renderButton(holder.current, {
          type: "standard",
          theme: document.documentElement.classList.contains("dark") ? "filled_black" : "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 300,
        });
      })
      .catch(() => alive && setError("Não conseguimos carregar o login do Google agora."));
    return () => {
      alive = false;
    };
  }, [onLogged]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="size-4 text-primary" />
          finance
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-20">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-lg">Entrar no finance</CardTitle>
            <CardDescription>
              Sua gestão financeira: registre e acompanhe com o Google, e continue pelo WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {loginConfigurado() ? (
              <>
                <div ref={holder} />
                {entrando && <p className="text-xs text-muted-foreground">Entrando…</p>}
                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                O login com Google não está configurado neste ambiente.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
