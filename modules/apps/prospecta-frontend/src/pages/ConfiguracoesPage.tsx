import { useState, type ReactNode } from "react";
import { BadgeCheck, Check, KeyRound, Mail, MessageCircle, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { loadConfig, saveConfig, type ProspectaConfig } from "@/lib/config";
import { AGENT_TEAM, COMPANY } from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Orb } from "@/components/ui/Orb";
import { Topbar } from "@/components/Topbar";

const TABS = ["Empresa", "Canais", "Agentes", "Integrações", "LGPD"] as const;
type Tab = (typeof TABS)[number];

export function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("Empresa");
  const [cfg, setCfg] = useState<ProspectaConfig>(() => loadConfig());
  const [company, setCompany] = useState({
    name: COMPANY.name,
    site: COMPANY.site,
    description: COMPANY.description,
  });
  const [icp, setIcp] = useState(COMPANY.icp?.definition ?? "");
  const [team, setTeam] = useState(AGENT_TEAM);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    saveConfig(cfg);
    setBusy(true);
    setStatus(null);
    try {
      if (!cfg.companyId) {
        const created = await api.createCompany(company);
        const next = { ...cfg, companyId: created.id };
        setCfg(next);
        saveConfig(next);
        await api.defineIcp(created.id, { definition: icp, signals: [] });
        setStatus(`Empresa ${created.id} criada · ICP definido`);
      } else {
        await api.defineIcp(cfg.companyId, { definition: icp, signals: [] });
        setStatus("Configurações salvas");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "salvo localmente (API indisponível)");
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
              Esta seção usa a mesma projeção de <span className="font-mono text-accent-light">/companies/&lbrace;id&rbrace;</span>{" "}
              e os canais do contrato. Conteúdo detalhado entra nas próximas user stories.
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
                  <Input
                    type="password"
                    value={cfg.apiKey}
                    onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                    placeholder="cole a chave aqui"
                  />
                </label>
              </div>
              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">ID da empresa</span>
                  <Input value={cfg.companyId} onChange={(e) => setCfg({ ...cfg, companyId: e.target.value })} placeholder="preenchido ao salvar" />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">ID da campanha</span>
                  <Input value={cfg.campaignId} onChange={(e) => setCfg({ ...cfg, campaignId: e.target.value })} placeholder="opcional" />
                </label>
              </div>
              <p className="text-[12px] text-fg-3">A chave fica apenas no localStorage deste navegador e é enviada no header X-API-Key.</p>
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <div className="flex flex-col gap-1">
                <CardHead title="Perfil da empresa" />
                <p className="text-[13px] text-fg-2">A IA usa estas informações para descrever a oferta e encontrar o ICP certo.</p>
              </div>
              <div className="flex gap-4">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">Nome da empresa</span>
                  <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] text-fg-2">Site</span>
                  <Input value={company.site} onChange={(e) => setCompany({ ...company, site: e.target.value })} />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] text-fg-2">O que você vende</span>
                <Textarea value={company.description} onChange={(e) => setCompany({ ...company, description: e.target.value })} />
              </label>
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Cliente ideal (ICP)" right={<BadgeCheck size={16} className="text-accent-light" />} />
              <Textarea value={icp} onChange={(e) => setIcp(e.target.value)} className="min-h-[90px]" />
            </Card>

            <div className="flex-1" />
            {status && <p className="text-right text-[13px] text-fg-2">{status}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setCfg(loadConfig())} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={busy}>
                Salvar
              </Button>
            </div>
          </div>

          <div className="flex w-[420px] shrink-0 flex-col gap-4">
            <Card elevated className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Seus agentes" right={<span className="text-[12px] text-accent-light">{team.filter((a) => a.on).length} ativos</span>} />
              {team.map((agent, i) => (
                <div key={agent.name} className="flex items-center gap-3 rounded-sm bg-bg p-3">
                  <Orb state={agent.on ? "researching" : "idle"} size={20} glow={false} />
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="text-[14px] font-medium text-fg">{agent.name}</span>
                    <span className="truncate text-[12px] text-fg-2">{agent.role}</span>
                  </div>
                  <Switch
                    on={agent.on}
                    onToggle={() => setTeam((prev) => prev.map((a, idx) => (idx === i ? { ...a, on: !a.on } : a)))}
                  />
                </div>
              ))}
            </Card>

            <Card className="flex flex-col gap-4 rounded-lg p-5">
              <CardHead title="Canais conectados" />
              <ChannelRow icon={<Mail size={18} />} name="E-mail" hint="conectado · domínio verificado" />
              <ChannelRow icon={<MessageCircle size={18} />} name="WhatsApp" hint="conectado · +55 11 9xxxx-xx10" />
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

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-line")}
    >
      <span
        className={cn(
          "absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all",
          on ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

function ChannelRow({ icon, name, hint }: { icon: ReactNode; name: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm bg-bg p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[14px] font-medium text-fg">{name}</span>
        <span className="truncate text-[11px] text-success">{hint}</span>
      </div>
      <Check size={18} className="shrink-0 text-success" />
    </div>
  );
}
