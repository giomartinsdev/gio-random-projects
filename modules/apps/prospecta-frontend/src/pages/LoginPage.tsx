import { useState, type FormEvent } from "react";
import { Check, Radar, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { navigate } from "@/lib/useHashRoute";
import { Orb } from "@/components/ui/Orb";
import { DotGrid, OrbGlow } from "@/components/landing/LandingUI";
import { AuthAlert, AuthDivider, AuthField, AuthInput, AuthSubmit, GoogleButton } from "@/components/auth/AuthUI";

const FEATURES = ["Encontra quem você não acharia", "Personalização em escala", "Pipeline, não listas"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Informe um e-mail válido.";
    if (!password) next.password = "Informe sua senha.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setApiError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await login({ email: email.trim(), password });
      navigate("cockpit");
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "não foi possível entrar agora");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-app-bg text-fg lg:flex-row">
      <BrandPanel />

      <main className="flex w-full flex-1 items-center justify-center px-6 py-12 lg:px-16">
        <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-5" noValidate>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-bold tracking-[-0.8px] text-fg">Entrar na sua conta</h1>
            <p className="text-[15px] text-fg-2">Acesse o cockpit de prospecção da sua empresa.</p>
          </div>

          {apiError && <AuthAlert kind="error">{apiError}</AuthAlert>}

          <AuthField label="E-mail" error={errors.email}>
            <AuthInput
              type="email"
              autoComplete="email"
              placeholder="voce@empresa.com.br"
              value={email}
              invalid={Boolean(errors.email)}
              onChange={(e) => setEmail(e.target.value)}
            />
          </AuthField>

          <AuthField
            label="Senha"
            error={errors.password}
            extra={<span className="text-[12px] font-medium text-accent-light">Esqueci minha senha</span>}
          >
            <AuthInput
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              invalid={Boolean(errors.password)}
              onChange={(e) => setPassword(e.target.value)}
            />
          </AuthField>

          <button
            type="button"
            onClick={() => setRemember((v) => !v)}
            className="flex w-fit items-center gap-2.5"
            aria-pressed={remember}
          >
            <span
              className={
                "grid h-[18px] w-[18px] place-items-center rounded-[5px] border transition-colors " +
                (remember ? "border-accent bg-accent text-white" : "border-line bg-bg")
              }
            >
              {remember && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="text-[13px] text-fg-2">Manter conectado por 30 dias</span>
          </button>

          <AuthSubmit busy={busy} type="submit">
            {busy ? "Entrando…" : "Entrar"}
          </AuthSubmit>

          <AuthDivider />
          <GoogleButton />

          <p className="flex items-center justify-center gap-1.5 text-[14px] text-fg-2">
            Ainda não tem conta?
            <a href="#/signup" className="font-semibold text-accent-light transition-colors hover:text-accent">
              Cadastre sua empresa
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}

// Painel de marca à esquerda (640px no design): dot grid + orbs, logo no topo,
// pitch no meio e features embaixo. Some no mobile.
function BrandPanel() {
  return (
    <aside className="relative hidden w-[640px] shrink-0 overflow-hidden bg-elevated p-16 lg:flex lg:flex-col lg:justify-between">
      <DotGrid className="text-[#1A1A20]" />
      <OrbGlow className="left-[-120px] top-[-160px] h-[480px] w-[480px]" color="#2563EB" opacity={0.5} />
      <OrbGlow className="bottom-[-80px] right-[-60px] h-[360px] w-[360px]" color="#7DA6FF" opacity={0.35} />

      <div className="relative flex items-center gap-2.5">
        <Orb state="prospecting" size={28} glow={false} />
        <span className="text-[20px] font-bold tracking-[-0.5px] text-fg">Prospecta</span>
      </div>

      <div className="relative flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#1F3D31] bg-[#12261E] px-3.5 py-1.5">
          <Sparkles size={14} className="text-success" />
          <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-success">Prospecção agêntica com IA</span>
        </span>
        <h2 className="max-w-[512px] text-[42px] font-bold leading-[1.1] tracking-[-1.5px] text-fg">
          Seu time de prospecção que nunca dorme
        </h2>
        <p className="max-w-[512px] text-[16px] leading-normal text-fg-2">
          Cadastre sua empresa e deixe agentes de IA encontrarem e abordarem clientes por e-mail e WhatsApp.
        </p>
      </div>

      <div className="relative flex flex-col gap-3">
        {FEATURES.map((f) => (
          <span key={f} className="flex items-center gap-3">
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-accent-soft text-accent">
              <Radar size={16} />
            </span>
            <span className="text-[14px] text-fg-2">{f}</span>
          </span>
        ))}
      </div>
    </aside>
  );
}
