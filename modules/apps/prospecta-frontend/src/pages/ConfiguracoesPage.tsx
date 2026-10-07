import { useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, KeyRound, Mail, MessageCircle, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { isConfigured, loadConfig, saveConfig, type ProspectaConfig } from "@/lib/config";
import { useAsync } from "@/lib/useAsync";
import { useConfig } from "@/lib/useConfig";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Orb } from "@/components/ui/Orb";
import { ErrorState, LoadingState } from "@/components/ApiState";
import { Topbar } from "@/components/Topbar";

const TABS = ["Empresa", "Canais", "Agentes", "Integrações", "LGPD"] as const;
type Tab = (typeof TABS)[number];

// Informativo — não é estado do backend (a API não expõe config de agentes).
const AGENT_TEAM: { name: string; role: string }[] = [
  { name: "Prospectador", role: "Varre a web por prospects" },
  { name: "Pesquisador", role: "Enriquece dados e valida sinais" },
  { name: "Redator", role: "Escreve abordagens personalizadas" },
  { name: "Qualificador", role: "Pontua o fit contra o ICP" },
];

export function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("Empresa");
  const saved = useConfig();
  const [cfg, setCfg] = useState<ProspectaConfig>(() => loadConfig());
  const [company, setCompany] = useState({ name: "", site: "", description: "" });
  const [icp, setIcp] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const configured = isConfigured(saved);
  const loaded = useAsync(() => api.company(saved.companyId), [], configured);

  useEffect(() => {
    if (!loaded.data) return;
    setCompany({ name: loaded.data.name, site: loaded.data.site, description: loaded.data.description });
    setIcp(loaded.data.icp?.definition ?? "");
  }, [loaded.data]);

  async function save() {
    saveConfig(cfg);
    setBusy(true);
    setStatus(null);
    try {
      if (cfg.companyId.trim()) {
        if (icp.trim()) await api.defineIcp(cfg.companyId.trim(), { definition: icp, signals: loaded.data?.icp?.signals ?? [] });
        setStatus({ kind: "ok", text: "Configurações salvas" + (icp.trim() ? " · ICP atualizado" : "") });
      } else {
        const created = await api.createCompany(company);
        const next = { ...cfg, companyId: created.id };
        setCfg(next);
        saveConfig(next);
        if (icp.trim()) await api.defineIcp(created.id, { definition: icp, signals: [] });
        setStatus({ kind: "ok", text: `Empresa ${created.id} criada` + (icp.trim() ? " · ICP definido" : "") });
        loaded.reload();
      }
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : "falha ao falar com a API" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Configurações"
        right={
          <nav className="flex items-center gap-1.5">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-sm px-3.5 py-2 text-[14px] transition-colors",
                  t === tab ? "bg-elevated font-medium text-fg" : "text-fg-3 hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </nav>
        }
      />

      {tab !== "Empresa" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-7">
          <Card className="max-w-md p-6 text-center">
            <CardHead title={tab} className="justify-center" />
            <p className="mt-2 text-[13px] text-fg-2">
              Esta seção ainda não tem endpoint no backend — nada é simulado aqui. Entra nas próximas user stories.
            </p>
          </Card>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start gap-5 overflow-y-auto scroll-thin p-7">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead
                title={<span className="flex items-center gap-2"><KeyRound size={16} className="text-accent-light" />Conexão com a API</span>}
                right={<span className="font-mono text-[12px] text-fg-3">X-API-Key</span>}
              />
              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">URL da prospecta-api</span>
                  <Input value={cfg.apiUrl} onChange={(e) => setCfg({ ...cfg, apiUrl: e.target.value })} placeholder="http://localhost:8022" />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">Chave (X-API-Key)</span>
                  <Input type="password" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="cole a chave aqui" />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] text-fg-2">ID da empresa</span>
                <Input value={cfg.companyId} onChange={(e) => setCfg({ ...cfg, companyId: e.target.value })} placeholder="preenchido ao criar a empresa, ou cole um id existente" />
              </label>
              <p className="text-[12px] text-fg-3">A chave fica apenas no localStorage deste navegador e é enviada no header X-API-Key.</p>
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <div className="flex flex-col gap-1">
                <CardHead title="Perfil da empresa" />
                <p className="text-[13px] text-fg-2">
                  {saved.companyId
                    ? "Dados reais de GET /companies/{id} (somente leitura — a API não expõe update de empresa)."
                    : "Informe os dados para criar a empresa via POST /companies."}
                </p>
              </div>
              {saved.companyId && loaded.loading ? (
                <LoadingState label="Carregando empresa…" />
              ) : saved.companyId && loaded.error ? (
                <ErrorState error={loaded.error} onRetry={loaded.reload} compact />
              ) : (
                <>
                  <div className="flex gap-4">
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-[13px] text-fg-2">Nome da empresa</span>
                      <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} disabled={Boolean(saved.companyId)} />
                    </label>
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className="text-[13px] text-fg-2">Site</span>
                      <Input value={company.site} onChange={(e) => setCompany({ ...company, site: e.target.value })} disabled={Boolean(saved.companyId)} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] text-fg-2">O que você vende</span>
                    <Textarea value={company.description} onChange={(e) => setCompany({ ...company, description: e.target.value })} disabled={Boolean(saved.companyId)} />
                  </label>
                </>
              )}
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Cliente ideal (ICP)" right={<BadgeCheck size={16} className="text-accent-light" />} />
              <Textarea value={icp} onChange={(e) => setIcp(e.target.value)} className="min-h-[90px]" placeholder="Descreva o cliente ideal…" />
              <p className="text-[12px] text-fg-3">Salvo via POST /companies/&lbrace;id&rbrace;/icp.</p>
            </Card>

            <div className="flex-1" />
            {status && (
              <p className={cn("text-right text-[13px]", status.kind === "err" ? "text-danger" : "text-fg-2")}>{status.text}</p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setCfg(loadConfig()); setStatus(null); }} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={busy}>
                Salvar
              </Button>
            </div>
          </div>

          <div className="flex w-[420px] shrink-0 flex-col gap-4">
            <Card elevated className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Seus agentes" right={<span className="text-[12px] text-fg-3">informativo</span>} />
              {AGENT_TEAM.map((agent) => (
                <div key={agent.name} className="flex items-center gap-3 rounded-sm bg-bg p-3">
                  <Orb state="idle" size={20} glow={false} />
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="text-[14px] font-medium text-fg">{agent.name}</span>
                    <span className="truncate text-[12px] text-fg-2">{agent.role}</span>
                  </div>
                </div>
              ))}
              <p className="text-[12px] text-fg-3">A API ainda não expõe configuração/estado dos agentes.</p>
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Canais de abordagem" />
              <ChannelRow icon={<Mail size={18} />} name="E-mail" hint="enviado pelo agente após aprovação" />
              <ChannelRow icon={<MessageCircle size={18} />} name="WhatsApp" hint="enviado pelo agente após aprovação" />
              <p className="text-[12px] text-fg-3">O backend não reporta o status de conexão dos canais.</p>
            </Card>

            <Card className="flex items-center gap-3 rounded-lg p-5">
              <Shield size={20} className="shrink-0 text-accent-light" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-fg">Privacidade e LGPD</span>
                <span className="text-[12px] text-fg-2">
                  Dados públicos, opt-out claro e registro de consentimento em cada abordagem.
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelRow({ icon, name, hint }: { icon: ReactNode; name: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm bg-bg p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[14px] font-medium text-fg">{name}</span>
        <span className="truncate text-[12px] text-fg-3">{hint}</span>
      </div>
    </div>
  );
}
