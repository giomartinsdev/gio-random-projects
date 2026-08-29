import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { signIn, signUp } from "../lib/authClient.js";
import { isDiscordActivity } from "../lib/discordActivity.js";
import { Banner, Button, Field, Input } from "../components/ui/index.js";

// Discord's brand mark (the game-controller-ish face). Lucide has no
// Discord icon and adding one via an icon package just for this is
// overkill -- inline SVG, fill=currentColor, sized like lucide's 20.
function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.3198 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561 19.9 19.9 0 0 0 5.9932 3.0303.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057 13.1 13.1 0 0 1-1.872-.8923.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0743.0743 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.3 12.3 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5218 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [discordLoading, setDiscordLoading] = useState(false);
  const navigate = useNavigate();
  // Inside the Activity the user is already signed in via the SDK's
  // own OAuth handshake (discordActivity.ts) -- offering a login
  // button there would just confuse.
  const inActivity = isDiscordActivity();

  async function handleDiscord() {
    setError(null);
    setDiscordLoading(true);
    try {
      const result = await signIn.social({ provider: "discord", callbackURL: `${window.location.origin}/` });
      // No navigate() here: better-auth's redirect plugin already set
      // window.location to Discord's consent screen. The callbackURL
      // must be ABSOLUTE -- the server redirects back to it from
      // post-api's host after the OAuth callback, so a relative path
      // would land there and 404.
      if (result.error) {
        setError(result.error.message ?? "O Discord não autorizou o login. Tente de novo.");
        setDiscordLoading(false);
      }
    } catch {
      setError("Não foi possível iniciar o login com o Discord.");
      setDiscordLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result =
        mode === "signin" ? await signIn.email({ email, password }) : await signUp.email({ email, password, name });
      if (result.error) {
        setError(result.error.message ?? "Não foi possível continuar. Tente de novo.");
        return;
      }
      navigate("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-6">
      <div className="glass-card shadow-glow p-8 animate-fade-in-up">
        <div className="text-center mb-8">
          <span className="text-4xl" aria-hidden="true">
            🍺
          </span>
          <h1 className="font-heading font-bold text-3xl mt-3 mb-1 text-gradient">Entrar no Buteco</h1>
          <p className="text-buteco-cream/60 text-sm">Sala de aula do Buteco — blog da comunidade</p>
        </div>

        {!inActivity && (
          <>
            <Button
              onClick={handleDiscord}
              loading={discordLoading}
              block
              size="lg"
              className="bg-[#5865F2] text-white shadow-lg shadow-[#5865F2]/25 hover:bg-[#4752c4]"
            >
              <DiscordMark /> Entrar com o Discord
            </Button>
            <div className="flex items-center gap-3 my-6" role="separator" aria-label="ou entre com email">
              <span className="h-px flex-1 bg-buteco-cream/10" />
              <span className="text-xs uppercase tracking-wider text-buteco-cream/40">
                ou com email
              </span>
              <span className="h-px flex-1 bg-buteco-cream/10" />
            </div>
          </>
        )}

        {error && (
          <div className={inActivity ? "mb-6" : "mb-4"}>
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <details className="group">
          <summary className="flex items-center justify-center gap-1.5 text-sm text-buteco-cream/60 hover:text-buteco-cream transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="transition-transform duration-200 group-open:rotate-90" aria-hidden="true">
              ›
            </span>
            Entrar com email e senha
          </summary>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-5">
            {mode === "signup" && (
              <Field label="Nome">
                <Input type="text" placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" placeholder="voce@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Senha" hint={mode === "signup" ? "Mínimo de 8 caracteres" : undefined}>
              <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </Field>

            <Button type="submit" loading={loading} className="mt-2 w-full">
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>

            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="block mx-auto text-sm text-buteco-cream/60 hover:text-buteco-amber transition-colors cursor-pointer"
            >
              {mode === "signin" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}