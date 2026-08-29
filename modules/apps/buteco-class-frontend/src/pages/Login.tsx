import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { signIn, signUp } from "../lib/authClient.js";
import { Banner, Button, Field, Input } from "../components/ui/index.js";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
          <h1 className="font-heading font-bold text-3xl mt-3 mb-1 text-gradient">
            {mode === "signin" ? "Bem-vindo de volta" : "Criar conta"}
          </h1>
          <p className="text-buteco-cream/60 text-sm">Sala de aula do Buteco — blog da comunidade</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

          {error && <Banner tone="error">{error}</Banner>}

          <Button type="submit" loading={loading} className="mt-2 w-full">
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="block mx-auto mt-6 text-sm text-buteco-cream/60 hover:text-buteco-amber transition-colors cursor-pointer"
        >
          {mode === "signin" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}