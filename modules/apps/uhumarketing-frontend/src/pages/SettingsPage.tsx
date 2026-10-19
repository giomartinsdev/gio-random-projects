import { useState } from "react";
import {
  BellRing,
  Check,
  CircleAlert,
  Database,
  Globe,
  KeyRound,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Toggle } from "@/components/ui/Input";
import { Card, CardHead } from "@/components/ui/Card";
import { StatusBadge, Tag } from "@/components/ui/Badge";
import { Topbar, PageBody, PageHeader, Note } from "@/components/Topbar";
import { Modal } from "@/components/ui/Drawer";
import { DataSourceCard } from "@/components/DataSourceCard";
import { useDataSource } from "@/lib/dataSource";

export function SettingsPage() {
  const store = useStore();
  const { user } = useSession();
  const [source] = useDataSource();
  const [confirmReset, setConfirmReset] = useState(false);
  const [tested, setTested] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [invites, setInvites] = useState<string[]>([]);
  const [quietStart, setQuietStart] = useState(String(store.workspace.quietHours.start));
  const [quietEnd, setQuietEnd] = useState(String(store.workspace.quietHours.end));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar title="Configurações" right={<StatusBadge tone="success">conta demo</StatusBadge>} />

      <PageBody className="max-w-[1000px]">
        <PageHeader
          title="O negócio por trás dos envios"
          description="Identidade, número, políticas de opt-in e conexão com a Meta. Na integração real, é esta tela que guarda o token da WABA."
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
              <Input value={store.workspace.name} readOnly />
            </Field>
            <Field label="Segmento">
              <Input value={store.workspace.segment} readOnly />
            </Field>
            <Field label="Site">
              <Input icon={<Globe size={15} />} value={store.workspace.site} readOnly />
            </Field>
            <Field label="Fuso horário">
              <Select value={store.workspace.timezone} disabled>
                <option value="America/Sao_Paulo">America/Sao_Paulo</option>
              </Select>
            </Field>
          </div>
          <Note>
            Dados de demonstração (Café Aurora). Quando a conta real entrar, estes campos vêm do cadastro e ficam
            editáveis aqui — na POC eles são fixos para o seed não perder coerência.
          </Note>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHead
            title="WhatsApp Business (Meta)"
            subtitle="Número, qualidade e limite de conversas"
            right={
              <StatusBadge tone={store.workspace.quality === "green" ? "success" : store.workspace.quality === "yellow" ? "warn" : "danger"}>
                qualidade {store.workspace.quality}
              </StatusBadge>
            }
          />
          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="Número conectado">
              <Input className="font-mono" value={store.workspace.whatsappNumber} readOnly icon={<MessageCircle size={15} />} />
            </Field>
            <Field label="Limite de mensagens">
              <Input value={store.workspace.messagingLimit} readOnly />
            </Field>
            <Field label="WABA ID" hint="Mock — o id real vem do Gerenciador de Negócios.">
              <Input className="font-mono" value="waba_1092384756" readOnly />
            </Field>
            <Field label="Token de acesso" hint="Nunca é exibido inteiro, nem na POC.">
              <Input className="font-mono" value="EAAG••••••••••••••••7f2c" readOnly icon={<KeyRound size={15} />} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setTested(true)}>
              Testar conexão
            </Button>
            {tested && (
              <span className="flex items-center gap-1.5 text-[12px] text-success">
                <Check size={13} /> conexão ok (simulada)
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
              status="conectado"
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
              <span className="truncate text-[13px] font-medium text-fg">{user?.name ?? "Marina Reis"}</span>
              <span className="truncate text-[11px] text-fg-3">{user?.email ?? "marina@cafeaurora.com.br"}</span>
            </div>
            <StatusBadge tone="accent">admin</StatusBadge>
          </div>
          <div className="flex items-center gap-3 rounded-sm bg-bg px-3.5 py-3 opacity-60">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-elevated text-[12px] font-semibold text-fg-2">TS</span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-fg">Time de suporte</span>
              <span className="truncate text-[11px] text-fg-3">atendimento@cafeaurora.com.br</span>
            </div>
            <StatusBadge tone="muted">leitor</StatusBadge>
          </div>
          {invites.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-bg px-3.5 py-3">
              <span className="caps">Convites pendentes</span>
              {invites.map((email) => (
                <span key={email} className="flex items-center gap-2 font-mono text-[11px] text-fg-2">
                  <CircleAlert size={12} className="text-warn" /> {email} · aguardando aceite
                </span>
              ))}
            </div>
          )}
          <Button size="sm" variant="secondary" className="w-fit" onClick={() => setInviteOpen(true)}>
            Convidar pessoa
          </Button>
        </Card>

        <Card className="flex flex-col gap-3 border-danger/25 p-5">
          <CardHead
            title="Zona de risco"
            subtitle={
              source === "backend"
                ? "Restaurar reaplica o seed no banco: apaga o que foi criado, inclusive envios e histórico."
                : "A POC guarda tudo no navegador. Restaurar apaga o que você criou aqui."
            }
            right={<CircleAlert size={16} className="text-danger" />}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
              Restaurar dados de exemplo
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                if (source === "backend") {
                  // No modo real o estado vive no Postgres; exportar o
                  // localStorage exportaria outro produto.
                  window.open(`${import.meta.env.VITE_UHU_API_URL ?? "http://localhost:8195"}/api/v1/bootstrap`, "_blank");
                  return;
                }
                const raw = localStorage.getItem("uhumarketing:state:v1");
                if (!raw) {
                  setConfirmReset(true);
                  return;
                }
                // "Exportar" antes de resetar: o JSON do estado inteiro, para
                // quem quiser inspecionar o mock fora do navegador.
                const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `uhumarketing-estado-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {source === "backend" ? "Abrir estado da API" : "Exportar estado atual"}
            </Button>
          </div>
        </Card>
      </PageBody>

      <Modal
        open={inviteOpen}
        title="Convidar pessoa"
        subtitle="Na POC o convite não sai — ele só entra na lista de pendentes desta sessão."
        onClose={() => {
          setInviteOpen(false);
          setInviteEmail("");
          setInviteError("");
        }}
        width={480}
        footer={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setInviteOpen(false);
                setInviteEmail("");
                setInviteError("");
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const email = inviteEmail.trim().toLowerCase();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                  setInviteError("Informe um e-mail válido.");
                  return;
                }
                if (invites.includes(email) || email === (user?.email ?? "").toLowerCase()) {
                  setInviteError("Esse e-mail já está na conta.");
                  return;
                }
                setInvites((prev) => [...prev, email]);
                store.logActivity({ kind: "team", title: "Convite enviado", detail: email });
                setInviteOpen(false);
                setInviteEmail("");
                setInviteError("");
              }}
            >
              Enviar convite
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="E-mail" error={inviteError}>
            <Input
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteError("");
              }}
              placeholder="pessoa@cafeaurora.com.br"
              type="email"
            />
          </Field>
          <Field label="Papel">
            <Select defaultValue="leitor">
              <option value="admin">Admin — vê e edita tudo</option>
              <option value="editor">Editor — monta campanhas e fluxos</option>
              <option value="leitor">Leitor — só acompanha resultados</option>
            </Select>
          </Field>
          <Note>O papel é ilustrativo: a POC não tem controle de permissão de verdade.</Note>
        </div>
      </Modal>

      <Modal
        open={confirmReset}
        title="Restaurar a POC?"
        subtitle="Campanhas, templates, fluxos e audiências criados por você serão descartados."
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
              onClick={() => {
                store.reset();
                setConfirmReset(false);
              }}
            >
              Restaurar
            </Button>
          </>
        }
      >
        <Note>
          Os dados de exemplo voltam no estado original. A sessão (nome/e-mail) é mantida — só o conteúdo é recriado.
        </Note>
      </Modal>
    </div>
  );
}

function Integration({ name, detail, status }: { name: string; detail: string; status: "conectado" | "pendente" | "desconectado" }) {
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
        tone={status === "conectado" ? "success" : status === "pendente" ? "warn" : "muted"}
        className={cn(status === "desconectado" && "opacity-70")}
      >
        {status}
      </StatusBadge>
    </div>
  );
}
