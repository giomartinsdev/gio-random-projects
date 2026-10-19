import { useState } from "react";
import {
  BellRing,
  CircleAlert,
  Database,
  Globe,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useSession } from "@/lib/session";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Toggle } from "@/components/ui/Input";
import { Card, CardHead } from "@/components/ui/Card";
import { StatusBadge, Tag } from "@/components/ui/Badge";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { Modal } from "@/components/ui/Drawer";
import { DataSourceCard } from "@/components/DataSourceCard";
import { ChannelCard } from "@/components/ChannelCard";

export function SettingsPage() {
  const store = useStore();
  const { user } = useSession();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [quietStart, setQuietStart] = useState(String(store.workspace.quietHours.start));
  const [quietEnd, setQuietEnd] = useState(String(store.workspace.quietHours.end));
  const [business, setBusiness] = useState({
    name: store.workspace.name,
    segment: store.workspace.segment,
    site: store.workspace.site,
    whatsappNumber: store.workspace.whatsappNumber,
    emailSender: store.workspace.emailSender,
  });
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirtyBusiness =
    business.name !== store.workspace.name ||
    business.segment !== store.workspace.segment ||
    business.site !== store.workspace.site ||
    business.whatsappNumber !== store.workspace.whatsappNumber ||
    business.emailSender !== store.workspace.emailSender ||
    Number(quietStart) !== store.workspace.quietHours.start ||
    Number(quietEnd) !== store.workspace.quietHours.end;

  async function saveWorkspace() {
    setSaving(true);
    setSaveNote(null);
    try {
      await store.updateWorkspace({
        name: business.name.trim(),
        segment: business.segment.trim(),
        site: business.site.trim(),
        emailSender: business.emailSender.trim(),
        whatsappNumber: business.whatsappNumber.trim(),
        quietHours: { start: Number(quietStart), end: Number(quietEnd) },
      });
      setSaveNote({ tone: "ok", text: "Dados da conta salvos." });
    } catch (err) {
      setSaveNote({
        tone: "err",
        text: err instanceof Error ? err.message : "Não consegui salvar.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        title="Configurações"
        right={<StatusBadge tone="accent">{store.workspace.plan || "conta"}</StatusBadge>}
      />

      <PageBody className="max-w-[1000px]">
        <PageHeader
          title="O negócio por trás dos envios"
          description="Identidade, número, políticas de opt-in e conexão com a Meta. O token do WhatsApp fica cifrado no servidor."
        />

        <DataSourceCard />

        <Card className="flex flex-col gap-4 p-5">
          <CardHead
            title="Negócio"
            subtitle="Como a marca se apresenta em cada mensagem"
            right={<Tag>{store.workspace.plan}</Tag>}
          />
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Nome do negócio">
              <Input
                value={business.name}
                onChange={(e) => setBusiness((b) => ({ ...b, name: e.target.value }))}
                placeholder="Café Aurora"
              />
            </Field>
            <Field label="Segmento">
              <Input
                value={business.segment}
                onChange={(e) => setBusiness((b) => ({ ...b, segment: e.target.value }))}
                placeholder="Torrefação de café especial"
              />
            </Field>
            <Field label="Site">
              <Input
                icon={<Globe size={15} />}
                value={business.site}
                onChange={(e) => setBusiness((b) => ({ ...b, site: e.target.value }))}
                placeholder="sualoja.com.br"
              />
            </Field>
            <Field label="E-mail que assina os envios">
              <Input
                type="email"
                value={business.emailSender}
                onChange={(e) => setBusiness((b) => ({ ...b, emailSender: e.target.value }))}
                placeholder="time@sualoja.com.br"
              />
            </Field>
            <Field label="Fuso horário">
              <Select value={store.workspace.timezone} disabled>
                <option value="America/Sao_Paulo">America/Sao_Paulo</option>
              </Select>
            </Field>
          </div>
          <Note>
            Uma conta nova começa sem número. Preencher o número de WhatsApp abaixo é o que libera o disparo —
            antes disso, a campanha é recusada com o motivo na tela.
          </Note>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHead
            title="WhatsApp Business (Meta)"
            subtitle="O canal desta conta: número, qualidade e credenciais"
            right={
              <StatusBadge
                tone={
                  store.provider?.activated && store.provider?.live
                    ? "success"
                    : store.provider?.activated
                      ? "muted"
                      : "warn"
                }
              >
                {store.provider?.activated
                  ? store.provider?.live
                    ? "conectado"
                    : "simulado"
                  : "inativo"}
              </StatusBadge>
            }
          />
          <ChannelCard />
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Número conectado" hint="Só dígitos com DDI/DDD. É o número que assina os envios.">
              <Input
                className="font-mono"
                value={business.whatsappNumber}
                onChange={(e) => setBusiness((b) => ({ ...b, whatsappNumber: e.target.value }))}
                placeholder="5511912345678"
                icon={<MessageCircle size={15} />}
              />
            </Field>
            <Field label="Limite de mensagens" hint="A Meta informa quando o número é verificado.">
              <Input value={store.workspace.messagingLimit || "—"} readOnly />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void saveWorkspace()}
              disabled={saving || !dirtyBusiness}
            >
              {saving ? "Salvando…" : "Salvar dados da conta"}
            </Button>
            {saveNote && (
              <span
                className={cn(
                  "text-[12px]",
                  saveNote.tone === "ok" ? "text-success" : "text-danger",
                )}
              >
                {saveNote.text}
              </span>
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHead title="Política de envio" subtitle="O que o produto garante antes de cada mensagem" right={<ShieldCheck size={16} className="text-fg-3" />} />
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Início da janela silenciosa">
              <Input
                type="number"
                min={0}
                max={23}
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                icon={<Timer size={15} />}
              />
            </Field>
            <Field label="Fim da janela silenciosa">
              <Input
                type="number"
                min={0}
                max={23}
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                icon={<Timer size={15} />}
              />
            </Field>
          </div>
          <Toggle
            checked
            onChange={() => undefined}
            label="Só envia com opt-in explícito"
            desc="Sem consentimento registrado, a mensagem é ignorada — e o motivo aparece no log."
            disabled
          />
          <Toggle
            checked
            onChange={() => undefined}
            label="Opt-out em 1 clique"
            desc="“Não quero receber” remove o contato de todas as campanhas de marketing."
            disabled
          />
          <Toggle
            checked
            onChange={() => undefined}
            label="Exigir aprovação humana para novos fluxos"
            desc="O fluxo só entra no ar depois que alguém revisa descoberta, oferta e saída."
            disabled
          />
          <Note>{store.workspace.optInPolicy}</Note>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHead title="Integrações" subtitle="O que a integração real vai plugar aqui" right={<Database size={16} className="text-fg-3" />} />
          <div className="flex flex-col divide-y divide-line">
            <Integration
              name="Meta WhatsApp Cloud API"
              detail="Envio de templates, status e qualidade do número"
              status={
                store.provider?.activated
                  ? store.provider.live
                    ? "conectado"
                    : "simulado"
                  : "desconectado"
              }
            />
            <Integration name="CRM / e-commerce" detail="Pedidos, tags e eventos (carrinho, entrega)" status="pendente" />
            <Integration name="Webhook de saída" detail="Avisa o seu sistema a cada resposta ou conversão" status="pendente" />
            <Integration name="Google Sheets" detail="Importar listas com opt-in" status="desconectado" />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHead title="Equipe e acesso" subtitle="Quem opera a conta" />
          <div className="flex items-center gap-3 rounded-sm bg-bg px-3.5 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">
              {(user?.name ?? "M").slice(0, 1).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-fg">{user?.name ?? "—"}</span>
              <span className="truncate text-[11px] text-fg-3">{user?.email ?? "—"}</span>
            </div>
            <StatusBadge tone="accent">admin</StatusBadge>
          </div>
          <Note>
            Uma conta por workspace. Convites por e-mail ainda não existem — quando existirem, serão um registro no
            servidor, não um item que desaparece ao recarregar.
          </Note>
        </Card>

        <Card className="flex flex-col gap-3 border-danger/25 p-5">
          <CardHead
            title="Zona de risco"
            subtitle="Apagar remove templates, contatos, audiências, campanhas, fluxos e envios desta conta. A conta e o login continuam."
            right={<CircleAlert size={16} className="text-danger" />}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
              Apagar dados da conta
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                // Exporta o que o servidor mandou — não há cópia local para
                // exportar, e o token não vai junto.
                const doc = {
                  workspace: store.workspace,
                  templates: store.templates,
                  segments: store.segments,
                  campaigns: store.campaigns,
                  flows: store.flows,
                  sends: store.sends,
                };
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = `uhumarketing-conta-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Exportar dados da conta
            </Button>
          </div>
        </Card>
      </PageBody>

      <Modal
        open={confirmReset}
        title="Apagar os dados da conta?"
        subtitle="Templates, contatos, audiências, campanhas, fluxos e envios serão descartados."
        onClose={() => setConfirmReset(false)}
        width={480}
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={resetting}
              onClick={async () => {
                setResetting(true);
                setResetError("");
                try {
                  await api.resetAccount();
                  setConfirmReset(false);
                  // Recarregar é o caminho honesto: o estado em memória tem
                  // ids que não existem mais no banco.
                  window.location.reload();
                } catch (err) {
                  setResetError(
                    err instanceof ApiError ? err.message : "Não consegui apagar os dados.",
                  );
                  setResetting(false);
                }
              }}
            >
              {resetting ? "Apagando…" : "Apagar"}
            </Button>
          </>
        }
      >
        {resetError ? (
          <Note className="border-danger/30 text-danger">{resetError}</Note>
        ) : (
          <Note>
            Isto não pode ser desfeito. A conta e o login continuam; só o conteúdo é apagado.
          </Note>
        )}
      </Modal>
    </div>
  );
}

function Integration({ name, detail, status }: { name: string; detail: string; status: "conectado" | "simulado" | "pendente" | "desconectado" }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs bg-elevated">
        <BellRing size={14} className="text-fg-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{name}</span>
        <span className="truncate text-[11px] text-fg-3">{detail}</span>
      </div>
      <StatusBadge
        tone={
          status === "conectado" ? "success" : status === "pendente" ? "warn" : "muted"
        }
        className={cn(status === "desconectado" && "opacity-70")}
      >
        {status}
      </StatusBadge>
    </div>
  );
}
