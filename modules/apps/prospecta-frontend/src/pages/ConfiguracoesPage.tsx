import { useEffect, useState, type ComponentType, type InputHTMLAttributes } from "react";
import {
  Bell,
  Building2,
  ChevronDown,
  KeyRound,
  LogOut,
  ShieldCheck,
  Target,
  UserRound,
  type LucideProps,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadConfig, saveConfig, type ProspectaConfig } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";
import { useConfigured } from "@/lib/useConfig";
import { isGoogleSession, markPasswordSession } from "@/lib/google";
import { cn } from "@/lib/utils";
import { navigatePublic } from "@/lib/useHashRoute";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { ErrorState, LoadingState } from "@/components/ApiState";
import { Topbar } from "@/components/Topbar";

const TABS: { id: Tab; label: string; icon: ComponentType<LucideProps> }[] = [
  { id: "Conta", label: "Conta", icon: UserRound },
  { id: "Empresa", label: "Empresa", icon: Building2 },
  { id: "Cliente ideal (ICP)", label: "Cliente ideal (ICP)", icon: Target },
  { id: "Preferências", label: "Preferências", icon: Bell },
  { id: "Privacidade", label: "Privacidade", icon: ShieldCheck },
];
type Tab = "Conta" | "Empresa" | "Cliente ideal (ICP)" | "Preferências" | "Privacidade";

// Configurações do cliente final: tudo gira em torno da sessão (useAuth). O
// modo operador (URL/chave/id) existe, mas recolhido em "Avançado (operador)" —
// quem entra com sessão nunca vê X-API-Key.
export function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("Conta");
  const { user } = useAuth();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar title="Configurações" />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-7">
        <div className="mx-auto flex w-full max-w-[880px] items-start gap-8">
          <TabNav tab={tab} onTab={setTab} />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {tab === "Conta" && <ContaTab />}
            {tab === "Empresa" && <EmpresaTab />}
            {tab === "Cliente ideal (ICP)" && <IcpTab />}
            {tab === "Preferências" && <PreferenciasTab />}
            {tab === "Privacidade" && <PrivacidadeTab />}
            {!user && <AdvancedSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="flex w-[210px] shrink-0 flex-col gap-0.5">
      {TABS.map(({ id, icon: Icon }) => {
        const active = id === tab;
        return (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={cn(
              "flex items-center gap-3 rounded-sm px-3 py-2.5 text-left text-[14px] transition-colors",
              active ? "bg-elevated font-medium text-fg" : "text-fg-2 hover:bg-elevated/60 hover:text-fg",
            )}
          >
            <Icon size={17} className={cn("shrink-0", active ? "text-accent-light" : "text-fg-3")} />
            {id}
          </button>
        );
      })}
    </nav>
  );
}

// ---- Conta ----

function ContaTab() {
  const { user, company, logout } = useAuth();
  if (!user) return <SignInPrompt />;

  return (
    <>
      <Card className="flex flex-col gap-5 rounded-lg p-6">
        <CardHead title="Sua conta" />
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-[18px] font-semibold text-white">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold text-fg">{user.name}</span>
            <span className="text-[13px] text-fg-2">{user.email}</span>
          </div>
        </div>
        <ReadField label="Nome" value={user.name} />
        <ReadField label="E-mail" value={user.email} hint="O e-mail de acesso não pode ser alterado." />
        {company && <ReadField label="Empresa" value={company.name} />}
      </Card>

      <PasswordCard />

      <Card className="flex flex-col gap-4 rounded-lg p-6">
        <CardHead title="Sessão" />
        <p className="text-[13px] text-fg-2">Encerrar sua sessão neste navegador.</p>
        <Button
          variant="secondary"
          className="w-fit"
          icon={<LogOut size={16} />}
          onClick={async () => {
            await logout();
            navigatePublic("login");
          }}
        >
          Sair
        </Button>
      </Card>
    </>
  );
}

// Troca de senha (POST /auth/password). Conta só-Google não tem senha local: o
// formulário vira "defina uma senha". O backend pode não reportar has_password,
// então usamos também a marca local de como este dispositivo entrou.
function PasswordCard() {
  const { user, refresh } = useAuth();
  const [googleOnly, setGoogleOnly] = useState(false);
  useEffect(() => {
    setGoogleOnly(user?.has_password === false || (user?.has_password === undefined && isGoogleSession()));
  }, [user]);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function submit() {
    setStatus(null);
    if (!googleOnly && !current) {
      setStatus({ kind: "err", text: "Informe sua senha atual." });
      return;
    }
    if (next.length < 8) {
      setStatus({ kind: "err", text: "A nova senha precisa ter ao menos 8 caracteres." });
      return;
    }
    if (next !== confirm) {
      setStatus({ kind: "err", text: "As senhas não conferem." });
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      markPasswordSession();
      await refresh();
      setCurrent("");
      setNext("");
      setConfirm("");
      setGoogleOnly(false);
      setStatus({ kind: "ok", text: "Senha atualizada." });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof ApiError ? err.message : "não foi possível atualizar a senha" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 rounded-lg p-6">
      <div className="flex flex-col gap-1">
        <CardHead title={googleOnly ? "Defina uma senha" : "Trocar senha"} />
        <p className="text-[13px] text-fg-2">
          {googleOnly
            ? "Sua conta entra pelo Google. Defina uma senha para também acessar com e-mail e senha."
            : "Use uma senha forte que você não use em outros lugares."}
        </p>
      </div>

      {googleOnly && (
        <p className="flex items-center gap-2 text-[12px] text-fg-3">
          <ShieldCheck size={14} className="text-accent-light" />
          Sua conta já é protegida pelo Google.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {!googleOnly && (
          <Field label="Senha atual" type="password" value={current} onChange={setCurrent} placeholder="••••••••" autoComplete="current-password" />
        )}
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field label="Nova senha" type="password" value={next} onChange={setNext} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
          <Field label="Confirmar senha" type="password" value={confirm} onChange={setConfirm} placeholder="Repita a nova senha" autoComplete="new-password" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={cn("text-[13px]", status?.kind === "err" ? "text-danger" : "text-fg-2")}>{status?.text}</span>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Salvando…" : googleOnly ? "Definir senha" : "Salvar nova senha"}
        </Button>
      </div>
    </Card>
  );
}

// ---- Empresa ----

function EmpresaTab() {
  const cfg = useConfigured();
  const loaded = useAsync(() => api.company(cfg!.companyId), [cfg?.companyId], cfg !== null);

  if (!cfg) return <SignInPrompt />;
  if (loaded.loading) return <LoadingState label="Carregando empresa…" />;
  if (loaded.error || !loaded.data) return <ErrorState error={loaded.error ?? "empresa indisponível"} onRetry={loaded.reload} />;

  const company = loaded.data;
  return (
    <Card className="flex flex-col gap-5 rounded-lg p-6">
      <div className="flex flex-col gap-1">
        <CardHead
          title="Sua empresa"
          right={<StatusBadge tone="muted">Somente leitura</StatusBadge>}
        />
        <p className="text-[13px] text-fg-2">É com esses dados que os agentes descrevem sua oferta e encontram o ICP certo.</p>
      </div>
      <ReadField label="Nome da empresa" value={company.name || "—"} />
      <ReadField label="Site" value={company.site || "—"} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-fg-2">O que você vende</span>
        <Textarea value={company.description || ""} readOnly className="min-h-[90px] cursor-default bg-elevated/60 text-fg-2 focus:border-line focus:ring-0" />
      </label>
      <p className="text-[12px] text-fg-3">Precisa atualizar algo? É só falar com o time — a edição acontece do nosso lado.</p>
    </Card>
  );
}

// ---- Cliente ideal (ICP) ----

function IcpTab() {
  const cfg = useConfigured();
  const loaded = useAsync(() => api.company(cfg!.companyId), [cfg?.companyId], cfg !== null);
  const [definition, setDefinition] = useState("");
  const [signals, setSignals] = useState<string[]>([]);
  const [signalInput, setSignalInput] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded.data) return;
    setDefinition(loaded.data.icp?.definition ?? "");
    setSignals(loaded.data.icp?.signals ?? []);
  }, [loaded.data]);

  if (!cfg) return <SignInPrompt />;

  function addSignal() {
    const value = signalInput.trim();
    if (value && !signals.includes(value)) setSignals((prev) => [...prev, value]);
    setSignalInput("");
  }

  async function save() {
    setStatus(null);
    if (!definition.trim()) {
      setStatus({ kind: "err", text: "Descreva seu cliente ideal antes de salvar." });
      return;
    }
    setBusy(true);
    try {
      await api.defineIcp(cfg!.companyId, { definition: definition.trim(), signals });
      setStatus({ kind: "ok", text: "Cliente ideal salvo. Os agentes passam a usá-lo nas próximas buscas." });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof ApiError ? err.message : "não foi possível salvar o ICP" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5 rounded-lg p-6">
      <div className="flex flex-col gap-1">
        <CardHead title="Cliente ideal (ICP)" />
        <p className="text-[13px] text-fg-2">Descreva em linguagem natural quem faz sentido para você. Os agentes usam isso para qualificar cada lead.</p>
      </div>

      {loaded.loading ? (
        <LoadingState label="Carregando…" />
      ) : loaded.error ? (
        <ErrorState error={loaded.error} onRetry={loaded.reload} compact />
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-fg-2">Descrição</span>
            <Textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              className="min-h-[130px]"
              placeholder="ex.: SaaS B2B no Brasil, de 50 a 500 funcionários, com sinais de expansão…"
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-fg-2">Sinais de compra</span>
            {signals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {signals.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSignals((prev) => prev.filter((x) => x !== s))}
                    title="Remover sinal"
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[13px] font-medium text-accent-light transition-colors hover:bg-accent-soft/70"
                  >
                    {s}
                    <span className="text-[13px] opacity-70">×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={signalInput}
                onChange={(e) => setSignalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSignal();
                  }
                }}
                placeholder="ex.: expansão de frota, nova rodada de investimento…"
              />
              <Button variant="secondary" onClick={addSignal} className="shrink-0">
                Adicionar
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className={cn("text-[13px]", status?.kind === "err" ? "text-danger" : "text-fg-2")}>{status?.text}</span>
        <Button onClick={save} disabled={busy || loaded.loading}>
          {busy ? "Salvando…" : "Salvar ICP"}
        </Button>
      </div>
    </Card>
  );
}

// ---- Preferências (locais, neste navegador) ----

interface Prefs {
  weeklyDigest: boolean;
  newLeads: boolean;
  approvals: boolean;
  productNews: boolean;
}

const PREFS_KEY = "prospecta:prefs";
const PREFS_DEFAULT: Prefs = { weeklyDigest: true, newLeads: true, approvals: true, productNews: false };

function useLocalPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? { ...PREFS_DEFAULT, ...(JSON.parse(raw) as Partial<Prefs>) } : PREFS_DEFAULT;
    } catch {
      return PREFS_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage indisponível: as preferências valem só nesta aba.
    }
  }, [prefs]);
  const set = (key: keyof Prefs) => (value: boolean) => setPrefs((prev) => ({ ...prev, [key]: value }));
  return { prefs, set };
}

function PreferenciasTab() {
  const { prefs, set } = useLocalPrefs();
  return (
    <>
      <Card className="flex flex-col gap-5 rounded-lg p-6">
        <div className="flex flex-col gap-1">
          <CardHead title="Notificações" />
          <p className="text-[13px] text-fg-2">Escolha o que você quer receber enquanto os agentes trabalham.</p>
        </div>
        <div className="flex flex-col gap-4">
          <Toggle checked={prefs.newLeads} onChange={set("newLeads")} label="Novos leads qualificados" desc="Avisamos quando um lead cruza o corte do seu ICP." />
          <Toggle checked={prefs.approvals} onChange={set("approvals")} label="Aprovação antes de enviar" desc="Você revisa a abordagem antes de qualquer mensagem sair." />
          <Toggle checked={prefs.weeklyDigest} onChange={set("weeklyDigest")} label="Resumo semanal" desc="Um panorama do que os agentes encontraram e abordaram na semana." />
          <Toggle checked={prefs.productNews} onChange={set("productNews")} label="Novidades do produto" desc="Recursos novos e dicas de uso. Sem enxurrada." />
        </div>
      </Card>
      <Card className="flex items-center gap-3 rounded-lg p-5">
        <Bell size={18} className="shrink-0 text-fg-3" />
        <p className="text-[12px] text-fg-3">As preferências ficam salvas neste navegador. Em breve acompanham a sua conta.</p>
      </Card>
    </>
  );
}

// ---- Privacidade / LGPD ----

interface Consent {
  dataProcessing: boolean;
  productEmails: boolean;
}

const CONSENT_KEY = "prospecta:consent";
const CONSENT_DEFAULT: Consent = { dataProcessing: true, productEmails: true };

function useLocalConsent() {
  const [consent, setConsent] = useState<Consent>(() => {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      return raw ? { ...CONSENT_DEFAULT, ...(JSON.parse(raw) as Partial<Consent>) } : CONSENT_DEFAULT;
    } catch {
      return CONSENT_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      // ignore
    }
  }, [consent]);
  const set = (key: keyof Consent) => (value: boolean) => setConsent((prev) => ({ ...prev, [key]: value }));
  return { consent, set };
}

function PrivacidadeTab() {
  const { consent, set } = useLocalConsent();
  return (
    <>
      <Card className="flex flex-col gap-5 rounded-lg p-6">
        <div className="flex flex-col gap-2">
          <CardHead title="Privacidade e LGPD" right={<ShieldCheck size={16} className="text-accent-light" />} />
          <p className="text-[14px] leading-[1.6] text-fg-2">
            Trabalhamos apenas com dados públicos. Cada abordagem tem opt-out claro e registro de consentimento, e você é
            quem aprova o que sai em seu nome.
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-5 rounded-lg p-6">
        <CardHead title="Seus consentimentos" />
        <div className="flex flex-col gap-4">
          <Toggle
            checked={consent.dataProcessing}
            onChange={set("dataProcessing")}
            label="Tratamento de dados para prospecção"
            desc="Necessário para os agentes encontrarem e qualificarem leads do seu ICP."
          />
          <Toggle
            checked={consent.productEmails}
            onChange={set("productEmails")}
            label="Comunicações do produto"
            desc="Novidades, dicas e conteúdo. Você pode desligar quando quiser."
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 rounded-lg p-6">
        <CardHead title="Seus direitos" />
        <p className="text-[13px] leading-[1.6] text-fg-2">
          Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento. Fale com o time pelo suporte
          e cuidamos disso para você.
        </p>
      </Card>
    </>
  );
}

// ---- Avançado (operador) — recolhido; só aparenta quando não há sessão ----

function AdvancedSection() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<ProspectaConfig>(() => loadConfig());
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-2 text-[12px] text-fg-3 transition-colors hover:text-fg-2"
      >
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        {user ? "Modo operador" : "Avançado (operador)"}
      </button>

      {open && (
        <Card className="flex flex-col gap-4 rounded-lg p-5">
          <CardHead
            title={
              <span className="flex items-center gap-2">
                <KeyRound size={16} className="text-fg-3" />
                Avançado (operador)
              </span>
            }
            right={<span className="font-mono text-[12px] text-fg-3">X-API-Key</span>}
          />
          <p className="text-[12px] text-fg-3">Acesso técnico por chave e id da empresa. Use apenas se a sua operação pedir.</p>
          <div className="flex gap-4">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[13px] text-fg-2">URL da prospecta-api</span>
              <Input value={cfg.apiUrl} onChange={(e) => setCfg({ ...cfg, apiUrl: e.target.value })} placeholder="https://prospecta-api…" />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[13px] text-fg-2">Chave (X-API-Key)</span>
              <Input type="password" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="cole a chave aqui" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-fg-2">ID da empresa</span>
            <Input value={cfg.companyId} onChange={(e) => setCfg({ ...cfg, companyId: e.target.value })} placeholder="id da empresa" />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-fg-3">A chave fica só neste navegador.</span>
            <Button
              onClick={() => {
                saveConfig(cfg);
                setStatus("Configuração salva neste navegador.");
              }}
            >
              Salvar
            </Button>
          </div>
          {status && <p className="text-right text-[13px] text-fg-2">{status}</p>}
        </Card>
      )}
    </div>
  );
}

// ---- Peças ----

function SignInPrompt() {
  return (
    <Card className="flex flex-col items-center gap-3 rounded-lg p-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-light">
        <UserRound size={22} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[16px] font-semibold text-fg">Entre para ver sua conta</span>
        <span className="text-[14px] text-fg-2">Sua conta e preferências aparecem aqui quando você entra.</span>
      </div>
      <Button onClick={() => navigatePublic("login")}>Entrar</Button>
    </Card>
  );
}

function ReadField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-fg-2">{label}</span>
      <Input value={value} readOnly className="cursor-default bg-elevated/60 text-fg-2 focus:border-line focus:ring-0" />
      {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-[13px] text-fg-2">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} {...props} />
    </label>
  );
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3.5 text-left">
      <span
        className={cn(
          "mt-0.5 flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line bg-bg",
        )}
      >
        <span className={cn("h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-fg">{label}</span>
        {desc && <span className="text-[12px] leading-[1.5] text-fg-3">{desc}</span>}
      </span>
    </button>
  );
}
