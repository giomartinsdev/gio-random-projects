import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";
import { navigate, navigatePublic } from "@/lib/useHashRoute";
import { cn } from "@/lib/utils";

// Telas de entrada. O visual é o do prospecta: painel de marca com dot grid +
// orbs e formulário compacto. A validação e a sessão são do servidor — o que
// esta tela faz é mandar credencial e guardar o token que voltar.

function BrandPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="relative flex w-[46%] shrink-0 flex-col justify-between overflow-hidden bg-[#0B0B0D] p-10">
      <span
        aria-hidden
        className="dot-grid pointer-events-none absolute inset-0 text-white/10"
        style={{ backgroundSize: "22px 22px" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/3 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(37,99,235,0.45) 0%, transparent 70%)" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 h-[380px] w-[380px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(125,166,255,0.28) 0%, transparent 70%)" }}
      />

      <button onClick={() => navigatePublic("landing")} className="relative flex w-fit items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px]">📣</span>
        <span className="text-[16px] font-semibold tracking-tight text-white">uhumarketing</span>
      </button>

      <div className="relative flex flex-col gap-4">
        <h2 className="max-w-[380px] text-[34px] font-semibold leading-[1.12] tracking-tight text-white">{title}</h2>
        <p className="max-w-[360px] text-[14px] leading-relaxed text-[#A8A8B0]">{text}</p>
      </div>

      <div className="relative flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6E76]">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Sua conta · seus dados
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-white text-lp-ink">
      <BrandPanel
        title="O marketing do negócio, montado por quem conhece o negócio."
        text="Templates, métricas e um canvas livre para desenhar a descoberta e a saída de cada campanha."
      />

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="flex w-full max-w-[380px] flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-lp-ink-3">Entrar</span>
            <h1 className="text-[26px] font-semibold tracking-tight">Bem-vindo de volta</h1>
            <p className="text-[13px] leading-relaxed text-lp-ink-2">
              Entre com o e-mail e a senha da sua conta.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-lp-ink-2">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-sm border border-lp-line bg-lp-surface px-3.5 text-[14px] outline-none transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
              autoComplete="email"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-lp-ink-2">Senha</span>
              <button type="button" className="text-[12px] text-lp-ink-3 hover:text-lp-ink-2">
                Esqueci
              </button>
            </span>
            <span className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-sm border border-lp-line bg-lp-surface px-3.5 pr-11 text-[14px] outline-none transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Esconder senha" : "Mostrar senha"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lp-ink-3 hover:text-lp-ink-2"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          {error && <span className="text-[12px] text-danger">{error}</span>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Entrar
          </button>

          <p className="text-center text-[13px] text-lp-ink-2">
            Ainda não tem conta?{" "}
            <button type="button" onClick={() => navigatePublic("cadastro")} className="font-semibold text-accent hover:underline">
              Criar workspace
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

export function SignupPage() {
  const { signup } = useSession();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Criar workspace — uhumarketing";
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(name, email, password, company);
      navigate("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-white text-lp-ink">
      <BrandPanel
        title="Comece com uma campanha e termine com um sistema."
        text="Sua conta nasce vazia. Você conecta o WhatsApp, cria o primeiro template e monta a campanha — o histórico é só o seu."
      />

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-lp-ink-3">Cadastro</span>
            <h1 className="text-[26px] font-semibold tracking-tight">Criar workspace</h1>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-lp-ink-2">Seu nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marina Reis"
              className="h-11 rounded-sm border border-lp-line bg-lp-surface px-3.5 text-[14px] outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-lp-ink-2">Negócio</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Café Aurora"
              className="h-11 rounded-sm border border-lp-line bg-lp-surface px-3.5 text-[14px] outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-lp-ink-2">E-mail profissional</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@seunegocio.com.br"
              className="h-11 rounded-sm border border-lp-line bg-lp-surface px-3.5 text-[14px] outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-lp-ink-2">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              className="h-11 rounded-sm border border-lp-line bg-lp-surface px-3.5 text-[14px] outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent-ring"
            />
          </label>

          {error && <span className="text-[12px] text-danger">{error}</span>}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]",
              loading && "opacity-60",
            )}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Criar e entrar
          </button>

          <p className="text-center text-[13px] text-lp-ink-2">
            Já tem conta?{" "}
            <button type="button" onClick={() => navigatePublic("login")} className="font-semibold text-accent hover:underline">
              Entrar
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
