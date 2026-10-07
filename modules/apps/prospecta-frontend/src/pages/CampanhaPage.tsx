import { useState } from "react";
import { ArrowLeft, Check, Mail, MessageCircle, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { loadConfig } from "@/lib/config";
import { AGENT_PLAN, COMPANY } from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/useHashRoute";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Orb } from "@/components/ui/Orb";
import { Topbar } from "@/components/Topbar";

const SUGGESTIONS = ["SaaS B2B no Brasil", "Indústria 100+ funcionários", "Healthtech em SP"];

export function CampanhaPage() {
  const [icp, setIcp] = useState(COMPANY.icp?.definition ?? "");
  const [channels, setChannels] = useState<string[]>(["email", "whatsapp"]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (c: string) => setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function submit(start: boolean) {
    const cfg = loadConfig();
    setBusy(true);
    setStatus(null);
    try {
      if (cfg.companyId) await api.defineIcp(cfg.companyId, { definition: icp, signals: [] }).catch(() => undefined);
      const created = await api.createCampaign({ company_id: cfg.companyId || "demo", name: "Logística Sudeste", channels });
      if (start && created.id) await api.startCampaign(created.id);
      setStatus(start ? `Campanha ${created.id} iniciada · prospecção em curso` : `Rascunho salvo (${created.id})`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "falha ao falar com a API");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Nova campanha"
        left={
          <button onClick={() => navigate("cockpit")} className="text-fg-2 transition-colors hover:text-fg" aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
        }
        right={<span className="font-mono text-[12px] text-fg-3">passo 1 de 3</span>}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scroll-thin px-7 pb-7 pt-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[26px] font-semibold tracking-tight text-fg">Descreva sua campanha</h2>
          <p className="text-[15px] text-fg-2">Escreva em linguagem natural. Os agentes cuidam do resto.</p>
        </div>

        <div className="flex min-h-0 items-start gap-5">
          <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
            <Card className="flex flex-col gap-3.5 rounded-lg p-5">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent-light" />
                <span className="text-[14px] font-medium text-fg">Cliente ideal (ICP)</span>
              </div>
              <textarea
                value={icp}
                onChange={(e) => setIcp(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-md border border-line bg-bg p-4 text-[15px] leading-relaxed text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-ring"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-fg-3">Sugestões:</span>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setIcp((prev) => (prev ? `${prev} ${s}.` : `${s}.`))}
                    className="rounded-full bg-elevated px-3 py-1 text-[13px] text-fg-2 transition-colors hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="flex flex-col gap-3.5 rounded-lg p-5">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} className="text-accent-light" />
                <span className="text-[14px] font-medium text-fg">Canais de abordagem</span>
              </div>
              <div className="flex gap-3">
                {[
                  { id: "email", label: "E-mail", Icon: Mail },
                  { id: "whatsapp", label: "WhatsApp", Icon: MessageCircle },
                ].map(({ id, label, Icon }) => {
                  const on = channels.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggle(id)}
                      className={cn(
                        "flex flex-1 items-center gap-3 rounded-sm border p-3.5 text-left transition-colors",
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
              </div>
            </Card>

            <div className="flex-1" />

            {status && <p className="text-right text-[13px] text-fg-2">{status}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => submit(false)}>
                Salvar rascunho
              </Button>
              <Button disabled={busy || channels.length === 0} onClick={() => submit(true)}>
                Iniciar prospecção
              </Button>
            </div>
          </div>

          <div className="flex w-[380px] shrink-0 flex-col gap-4">
            <Card elevated className="flex flex-col gap-4 rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Orb state="writing" size={22} glow={false} />
                  <h3 className="text-[15px] font-semibold text-fg">Plano do agente</h3>
                </div>
                <Sparkles size={16} className="text-accent-light" />
              </div>
              {AGENT_PLAN.map((step) => (
                <div key={step.title} className="flex gap-3">
                  <Check size={18} className={step.done ? "shrink-0 text-success" : "shrink-0 text-fg-3"} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-medium text-fg">{step.title}</span>
                    <span className="text-[12px] text-fg-2">{step.desc}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-sm bg-bg px-3.5 py-3">
                <span className="text-[12px] text-fg-2">Estimativa</span>
                <span className="font-mono text-[12px] text-accent-light">~40 leads em 24h</span>
              </div>
            </Card>

            <Card className="flex flex-col gap-3.5 rounded-lg p-5">
              <span className="caps">Preview · abordagem</span>
              <div className="flex flex-col gap-3 rounded-sm bg-bg p-4">
                <div className="flex items-center gap-2 text-[12px] text-fg-2">
                  <Mail size={14} />
                  para: contato@nordestelog.com.br
                </div>
                <span className="text-[13px] font-medium text-fg">Assunto: Expansão de frota no Sudeste</span>
                <p className="text-[13px] leading-relaxed text-fg-2">
                  Olá, [Nome]. Vi que a Nordeste Log está abrindo um novo CD em Campinas — times que crescem assim
                  costumam travar na qualificação de leads. Podemos falar 15 min esta semana?
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
