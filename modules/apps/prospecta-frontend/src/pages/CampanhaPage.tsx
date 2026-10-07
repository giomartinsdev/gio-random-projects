import { useEffect, useState } from "react";
import { ArrowLeft, Check, Info, Mail, MessageCircle, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useConfigured } from "@/lib/useConfig";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/useHashRoute";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Orb } from "@/components/ui/Orb";
import { ConfigureApiState, ErrorState, LoadingState } from "@/components/ApiState";
import { Topbar } from "@/components/Topbar";

const SUGGESTIONS = ["SaaS B2B no Brasil", "Indústria 100+ funcionários", "Healthtech em SP"];

// Texto fixo e assumidamente informativo — não é estado do backend.
const HOW_IT_WORKS: string[] = [
  "Buscar prospects por sinais do ICP",
  "Qualificar com score de fit",
  "Enriquecer dados de contato",
  "Redigir e (com aprovação) enviar a abordagem",
];

export function CampanhaPage() {
  const cfg = useConfigured();
  const company = useAsync(() => api.company(cfg!.companyId), [], cfg !== null);

  const [name, setName] = useState("");
  const [icp, setIcp] = useState("");
  const [channels, setChannels] = useState<string[]>(["email", "whatsapp"]);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"ok" | "err">("ok");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (company.data) {
      setIcp(company.data.icp?.definition ?? "");
      setName((prev) => prev || `${company.data!.name} — campanha`);
    }
  }, [company.data]);

  const toggle = (c: string) => setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function submit(start: boolean) {
    if (!cfg) return;
    setBusy(true);
    setStatus(null);
    try {
      if (icp.trim()) await api.defineIcp(cfg.companyId, { definition: icp, signals: company.data?.icp?.signals ?? [] });
      const created = await api.createCampaign({
        company_id: cfg.companyId,
        name: name.trim() || "Nova campanha",
        channels,
      });
      if (start && created.id) {
        const started = await api.startCampaign(created.id);
        setStatusKind("ok");
        setStatus(`Campanha ${created.id} iniciada · status ${started.status}`);
      } else {
        setStatusKind("ok");
        setStatus(`Campanha criada (${created.id}) · status ${created.status}`);
      }
    } catch (err) {
      setStatusKind("err");
      setStatus(err instanceof Error ? err.message : "falha ao falar com a API");
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar title="Nova campanha" />
        <ConfigureApiState message="Defina a chave e o id da empresa em Configurações antes de criar uma campanha." />
      </div>
    );
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
        right={<span className="font-mono text-[12px] text-fg-3">{company.data ? `empresa ${company.data.id}` : ""}</span>}
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
                <span className="text-[14px] font-medium text-fg">Nome da campanha</span>
              </div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Logística Sudeste" />
            </Card>

            <Card className="flex flex-col gap-3.5 rounded-lg p-5">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent-light" />
                <span className="text-[14px] font-medium text-fg">Cliente ideal (ICP)</span>
              </div>
              {company.loading ? (
                <LoadingState label="Carregando ICP da empresa…" />
              ) : company.error ? (
                <ErrorState error={company.error} onRetry={company.reload} compact />
              ) : (
                <>
                  <textarea
                    value={icp}
                    onChange={(e) => setIcp(e.target.value)}
                    rows={4}
                    placeholder="Descreva o cliente ideal…"
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
                </>
              )}
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

            {status && (
              <p className={cn("text-right text-[13px]", statusKind === "err" ? "text-danger" : "text-fg-2")}>{status}</p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" disabled={busy || company.loading} onClick={() => submit(false)}>
                Salvar rascunho
              </Button>
              <Button disabled={busy || company.loading || channels.length === 0} onClick={() => submit(true)}>
                Iniciar prospecção
              </Button>
            </div>
          </div>

          <div className="flex w-[380px] shrink-0 flex-col gap-4">
            <Card elevated className="flex flex-col gap-4 rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Orb state="writing" size={22} glow={false} />
                  <h3 className="text-[15px] font-semibold text-fg">Como o agente trabalha</h3>
                </div>
              </div>
              {HOW_IT_WORKS.map((step) => (
                <div key={step} className="flex gap-3">
                  <Check size={18} className="shrink-0 text-fg-3" />
                  <span className="text-[14px] text-fg-2">{step}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-sm bg-bg px-3.5 py-3">
                <Info size={14} className="shrink-0 text-fg-3" />
                <span className="text-[12px] text-fg-3">
                  Informativo. O plano real do agente ainda não é exposto pela API.
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
