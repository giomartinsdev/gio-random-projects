import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Lock, Mail, MessageCircle, Send, Target } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { clearGoogleDraft, getGoogleDraft, googleConfigurado, setGoogleDraft } from "@/lib/google";
import type { GoogleSignupDraft } from "@/lib/types";
import { navigate, navigatePublic } from "@/lib/useHashRoute";
import { cn } from "@/lib/utils";
import { Orb } from "@/components/ui/Orb";
import { Textarea } from "@/components/ui/Input";
import { DotGrid, OrbGlow } from "@/components/landing/LandingUI";
import { AuthAlert, AuthDivider, AuthField, AuthInput, GoogleButton } from "@/components/auth/AuthUI";

const STEPS: { title: string; desc: string; icon: ReactNode }[] = [
  { title: "Conta e acesso", desc: "E-mail e senha do responsável", icon: <Lock size={16} /> },
  { title: "Sua empresa", desc: "O que ela vende e para quem", icon: <Building2 size={16} /> },
  { title: "Conecte os canais", desc: "E-mail e WhatsApp para abordar", icon: <Send size={16} /> },
  { title: "Primeira campanha", desc: "Descreva o cliente ideal (ICP)", icon: <Target size={16} /> },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AccountForm {
  name: string;
  cargo: string;
  email: string;
  password: string;
  phone: string;
}

export function SignupPage() {
  const { signup, company, googleLogin } = useAuth();
  // Fluxo Google: /auth/google já verificou e-mail+nome de um usuário novo.
  // Pulamos o passo de conta/senha e caímos direto na empresa.
  const [googleDraft, setDraft] = useState<GoogleSignupDraft | null>(() => getGoogleDraft());
  const isGoogle = googleDraft !== null;
  // Aviso vindo da tela de login (ex.: conta Google ainda sem cadastro). É um
  // recado de sucesso, não um erro de formulário.
  const [flash] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem("prospecta:auth-flash");
      if (v) sessionStorage.removeItem("prospecta:auth-flash");
      return v;
    } catch {
      return null;
    }
  });
  const [step, setStep] = useState(isGoogle ? 1 : 0);
  const [account, setAccount] = useState<AccountForm>(() => ({
    name: googleDraft?.name ?? "",
    cargo: "",
    email: googleDraft?.email ?? "",
    password: "",
    phone: "",
  }));
  const [terms, setTerms] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: "", site: "", description: "" });
  const [channels, setChannels] = useState<string[]>(["email", "whatsapp"]);
  const [icp, setIcp] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => setAccount((prev) => ({ ...prev, [key]: value }));

  // Cadastro direto com Google: verifica a conta e já cai no passo da empresa.
  async function startGoogle(credential: string) {
    setApiError(null);
    setBusy(true);
    try {
      const result = await googleLogin(credential);
      if ("needs_onboarding" in result) {
        const draft: GoogleSignupDraft = { email: result.email, name: result.name, google_credential: credential };
        setGoogleDraft(draft);
        setDraft(draft);
        setAccount((prev) => ({ ...prev, name: result.name, email: result.email }));
        setStep(1);
      } else {
        navigate("cockpit");
      }
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : "não foi possível usar essa conta Google agora");
    } finally {
      setBusy(false);
    }
  }

  function validateAccount(): boolean {
    const next: Record<string, string> = {};
    if (!account.name.trim()) next.name = "Informe seu nome.";
    if (!EMAIL_RE.test(account.email.trim())) next.email = "Informe um e-mail válido.";
    if (account.password.length < 8) next.password = "A senha precisa ter ao menos 8 caracteres.";
    if (!terms) next.terms = "É preciso aceitar os termos para continuar.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateCompany(): boolean {
    const next: Record<string, string> = {};
    if (!companyForm.name.trim()) next.companyName = "Informe o nome da empresa.";
    if (!companyForm.description.trim()) next.companyDescription = "Conte o que a empresa vende.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (step === 0) {
      if (validateAccount()) setStep(1);
      return;
    }

    if (step === 1) {
      if (!validateCompany()) return;
      setBusy(true);
      try {
        await signup({
          name: account.name.trim(),
          email: account.email.trim(),
          ...(isGoogle && googleDraft ? { google_credential: googleDraft.google_credential } : { password: account.password }),
          cargo: account.cargo.trim() || undefined,
          phone: account.phone.trim() || undefined,
          company: { name: companyForm.name.trim(), site: companyForm.site.trim(), description: companyForm.description.trim() },
        });
        clearGoogleDraft();
        setStep(2);
      } catch (err) {
        setApiError(err instanceof ApiError ? err.message : "não foi possível criar a conta agora");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    if (icp.trim() && company?.id) {
      setBusy(true);
      try {
        await api.defineIcp(company.id, { definition: icp.trim(), signals: [] });
      } catch (err) {
        setApiError(err instanceof ApiError ? err.message : "não foi possível salvar o ICP");
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    navigate("campanha");
  }

  // No fluxo Google o passo 0 não existe: "voltar" da empresa retorna ao login.
  function goBack() {
    setApiError(null);
    if (isGoogle && step === 1) {
      clearGoogleDraft();
      navigatePublic("login");
      return;
    }
    setStep((s) => s - 1);
  }

  const toggleChannel = (c: string) => setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const nextLabel = step === 1 ? "Criar conta e continuar" : step === 3 ? "Concluir" : "Continuar";

  return (
    <div className="flex min-h-dvh w-full flex-col bg-app-bg text-fg lg:flex-row">
      <StepRail step={step} />

      <main className="flex w-full flex-1 items-center justify-center px-6 py-12 lg:px-16">
        <form onSubmit={handleSubmit} className="flex w-full max-w-[440px] flex-col gap-5" noValidate>
          <div className="flex w-full items-center gap-2">
            {STEPS.map((_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-elevated")} />
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-accent-light">
              Passo {step + 1} de {STEPS.length}
            </span>
            <h1 className="text-[26px] font-bold tracking-[-0.8px] text-fg">
              {step === 0 ? "Crie sua conta" : STEPS[step].title}
            </h1>
            <p className="text-[15px] text-fg-2">
              {step === 0
                ? "Você será o responsável pela conta da empresa."
                : step === 1
                  ? "Conte sobre a empresa que vai prospectar."
                  : step === 2
                    ? "Escolha por onde os agentes vão abordar."
                    : "Descreva seu cliente ideal — você ajusta depois no app."}
            </p>
          </div>

          {apiError && <AuthAlert kind="error">{apiError}</AuthAlert>}
          {flash && <AuthAlert kind="info">{flash}</AuthAlert>}

          {step === 0 && (
            <>
              {googleConfigurado() && (
                <>
                  <GoogleButton onCredential={startGoogle} busy={busy} />
                  <AuthDivider />
                </>
              )}
              <div className="flex flex-col gap-4 sm:flex-row">
                <AuthField label="Seu nome" error={errors.name}>
                  <AuthInput value={account.name} invalid={Boolean(errors.name)} onChange={(e) => set("name", e.target.value)} placeholder="Giovanni Martins" />
                </AuthField>
                <AuthField label="Cargo">
                  <AuthInput value={account.cargo} onChange={(e) => set("cargo", e.target.value)} placeholder="Head de Growth" />
                </AuthField>
              </div>
              <AuthField label="E-mail corporativo" error={errors.email}>
                <AuthInput
                  type="email"
                  autoComplete="email"
                  value={account.email}
                  invalid={Boolean(errors.email)}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="voce@empresa.com.br"
                />
              </AuthField>
              <AuthField label="Senha" error={errors.password}>
                <AuthInput
                  type="password"
                  autoComplete="new-password"
                  value={account.password}
                  invalid={Boolean(errors.password)}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
              </AuthField>
              <AuthField label="Telefone (WhatsApp)">
                <AuthInput value={account.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+55 11 9 0000-0000" />
              </AuthField>
              <label className="flex w-full cursor-pointer items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors",
                    terms ? "border-accent bg-accent text-white" : "border-line bg-bg",
                  )}
                >
                  {terms && <Check size={12} strokeWidth={3} />}
                </span>
                <input type="checkbox" className="sr-only" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span className="text-[13px] leading-[1.5] text-fg-2">
                  Aceito os Termos de Uso e a Política de Privacidade, e o tratamento de dados conforme a LGPD.
                </span>
              </label>
              {errors.terms && <span className="-mt-3 text-[12px] text-danger">{errors.terms}</span>}
            </>
          )}

          {step === 1 && (
            <>
              <AuthField label="Nome da empresa" error={errors.companyName}>
                <AuthInput
                  value={companyForm.name}
                  invalid={Boolean(errors.companyName)}
                  onChange={(e) => setCompanyForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="ex.: Logística Sudeste"
                />
              </AuthField>
              <AuthField label="Site">
                <AuthInput value={companyForm.site} onChange={(e) => setCompanyForm((p) => ({ ...p, site: e.target.value }))} placeholder="suaempresa.com.br" />
              </AuthField>
              <AuthField label="O que você vende" error={errors.companyDescription}>
                <Textarea
                  value={companyForm.description}
                  className={cn("min-h-[90px]", errors.companyDescription && "border-danger")}
                  onChange={(e) => setCompanyForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Descreva o produto/serviço e para quem ele faz sentido…"
                />
              </AuthField>
            </>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              {[
                { id: "email", label: "E-mail", Icon: Mail },
                { id: "whatsapp", label: "WhatsApp", Icon: MessageCircle },
              ].map(({ id, label, Icon }) => {
                const on = channels.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleChannel(id)}
                    className={cn(
                      "flex items-center gap-3 rounded-sm border p-3.5 text-left transition-colors",
                      on ? "border-transparent bg-accent-soft" : "border-line bg-bg hover:border-line-strong",
                    )}
                  >
                    <Icon size={18} className={on ? "text-accent" : "text-fg-2"} />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className={cn("text-[14px] font-medium", on ? "text-accent-light" : "text-fg")}>{label}</span>
                      <span className="text-[12px] text-fg-3">{on ? "Ativado" : "Desativado"}</span>
                    </span>
                    {on && <Check size={18} className="text-accent" />}
                  </button>
                );
              })}
              <AuthAlert kind="info">Você ajusta os canais a qualquer momento em Configurações.</AuthAlert>
            </div>
          )}

          {step === 3 && (
            <AuthField label="Cliente ideal (ICP)">
              <Textarea
                value={icp}
                className="min-h-[120px]"
                onChange={(e) => setIcp(e.target.value)}
                placeholder="ex.: SaaS B2B no Brasil, de 50 a 500 funcionários…"
              />
            </AuthField>
          )}

          <div className="flex items-center gap-3 pt-1">
            {step > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-2 rounded-sm border border-line bg-bg px-5 py-[14px] text-[15px] font-semibold text-fg transition-colors hover:bg-elevated"
              >
                <ArrowLeft size={16} />
                Voltar
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-sm bg-accent px-5 py-[14px] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Enviando…" : nextLabel}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-[14px] text-fg-2">
            Já tem conta?
            <a href="#/login" className="font-semibold text-accent-light transition-colors hover:text-accent">
              Entrar
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}

function StepRail({ step }: { step: number }) {
  return (
    <aside className="relative hidden w-[420px] shrink-0 flex-col justify-between overflow-hidden bg-elevated p-12 lg:flex">
      <DotGrid className="text-[#1A1A20]" />
      <OrbGlow className="left-[-120px] top-[-140px] h-[420px] w-[420px]" color="#2563EB" opacity={0.45} />

      <div className="relative flex items-center gap-2.5">
        <Orb state="prospecting" size={28} glow={false} />
        <span className="text-[19px] font-bold tracking-[-0.5px] text-fg">Prospecta</span>
      </div>

      <div className="relative flex flex-col gap-7">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={s.title} className="flex items-start gap-3.5">
              <span
                className={cn(
                  "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[13px] font-bold",
                  active ? "bg-accent text-white" : done ? "bg-accent-soft text-accent" : "border border-line bg-elevated text-fg-3",
                )}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={cn("text-[14px] font-semibold", active ? "text-fg" : "text-fg-2")}>{s.title}</span>
                <span className="text-[12px] leading-[1.4] text-fg-3">{s.desc}</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="relative text-[11px] text-fg-3">Leva ~3 minutos · sem cartão de crédito</p>
    </aside>
  );
}
