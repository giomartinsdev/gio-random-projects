import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleCheck,
  KeyRound,
  Loader2,
  MessageCircle,
  PlugZap,
  Unplug,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { Note } from "@/components/Topbar";

/**
 * Canal de WhatsApp DA CONTA.
 *
 * Cada conta ativa o próprio número: o token pertence ao workspace, nunca ao
 * processo. Por isso esta tela é o passo que faltava — sem ela, uma conta nova
 * só poderia "usar o WhatsApp de outra pessoa".
 *
 * A ativação é em duas etapas na vida real: criar o app/WABA no Meta Business
 * (fora do produto) e trazer as três credenciais para cá. O produto confirma
 * com a Graph antes de gravar; se a Meta recusar, o canal não é ativado e o
 * motivo aparece aqui.
 */
export function ChannelCard() {
  const store = useStore();
  const provider = store.provider;
  const activated = Boolean(provider?.activated);
  const live = Boolean(provider?.live);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ wabaId: "", phoneId: "", token: "" });
  const [mode, setMode] = useState<"live" | "dry-run">(live ? "live" : "dry-run");
  const [busy, setBusy] = useState<"save" | "check" | "off" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);

  async function activate() {
    if (!store.activateChannel) {
      setNote({ tone: "err", text: "este servidor não aceita ativação de canal" });
      return;
    }
    setBusy("save");
    setNote(null);
    try {
      await store.activateChannel({ mode, ...form });
      setNote({ tone: "ok", text: "WhatsApp ativado nesta conta." });
      setForm({ wabaId: "", phoneId: "", token: "" });
      setOpen(false);
    } catch (err) {
      setNote({
        tone: "err",
        text: err instanceof Error ? err.message : "não consegui ativar o canal",
      });
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("check");
    setCheck(null);
    try {
      const info = await store.checkChannel!();
      setCheck({
        ok: info.ok,
        text: info.ok
          ? info.live
            ? `${info.verifiedName ?? "número conectado"} · ${info.number ?? ""}`
            : "canal simulado: nada sai para a Meta"
          : info.note,
      });
    } catch (err) {
      setCheck({ ok: false, text: err instanceof Error ? err.message : "falha ao verificar" });
    } finally {
      setBusy(null);
    }
  }

  async function deactivate() {
    if (!store.deactivateChannel) return;
    setBusy("off");
    setNote(null);
    try {
      await store.deactivateChannel();
      setNote({ tone: "ok", text: "Canal desativado e credenciais apagadas." });
      setCheck(null);
    } catch (err) {
      setNote({
        tone: "err",
        text: err instanceof Error ? err.message : "não consegui desativar o canal",
      });
    } finally {
      setBusy(null);
    }
  }

  const canSubmit = form.wabaId.trim() && form.phoneId.trim() && form.token.trim();

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-sm border px-4 py-3.5",
          activated && live
            ? "border-success/30 bg-success/5"
            : activated
              ? "border-line bg-bg"
              : "border-warn/30 bg-warn/5",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {activated && live ? (
            <CircleCheck size={15} className="text-success" />
          ) : activated ? (
            <Check size={15} className="text-fg-2" />
          ) : (
            <CircleAlert size={15} className="text-warn" />
          )}
          <span className="text-[13px] font-medium text-fg">
            {activated && live
              ? "WhatsApp conectado"
              : activated
                ? "WhatsApp em modo simulado"
                : "WhatsApp ainda não ativado"}
          </span>
          <StatusBadge tone={activated && live ? "success" : activated ? "muted" : "warn"}>
            {activated && live ? "live" : activated ? "dry-run" : "inativo"}
          </StatusBadge>
          {provider?.wabaId && (
            <span className="ml-auto font-mono text-[11px] text-fg-3">WABA {provider.wabaId}</span>
          )}
        </div>

        {activated ? (
          <div className="grid gap-x-6 gap-y-1 text-[12px] text-fg-2 sm:grid-cols-2">
            <span>
              Número:{" "}
              <span className="font-mono text-fg">
                {provider?.displayPhone || store.workspace.whatsappNumber || "—"}
              </span>
            </span>
            <span>
              Nome verificado: <span className="text-fg">{provider?.verifiedName || "não informado"}</span>
            </span>
            <span>
              Qualidade: <span className="text-fg">{provider?.quality || "não informada"}</span>
            </span>
            <span>
              Modo: <span className="font-mono text-fg">{provider?.mode}</span>
            </span>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-fg-2">
            Enquanto o canal não for ativado, dá para montar audiências, templates e campanhas —
            mas nenhuma mensagem sai. O disparo é recusado com o motivo, não simulado.
          </p>
        )}

        <p className="text-[11px] leading-snug text-fg-3">{provider?.note}</p>

        {provider?.webhookUrl && (
          <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface px-3 py-2">
            <span className="caps text-[10px] text-fg-3">Callback do webhook</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-2">
                {provider.webhookUrl}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(provider.webhookUrl!);
                  setNote({ tone: "ok", text: "URL copiada." });
                }}
              >
                Copiar
              </Button>
            </div>
            <span className="text-[11px] leading-snug text-fg-3">
              Cole em Meta for Developers → WhatsApp → Configuration → Callback URL, usando o mesmo
              verify token configurado no servidor.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {activated && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void verify()}
              icon={
                busy === "check" ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />
              }
            >
              {busy === "check" ? "Verificando…" : "Testar conexão"}
            </Button>
          )}
          <Button
            size="sm"
            variant={activated ? "secondary" : "primary"}
            onClick={() => setOpen((v) => !v)}
            icon={activated ? <KeyRound size={13} /> : <ArrowUpRight size={13} />}
          >
            {activated ? "Trocar credenciais" : "Ativar WhatsApp"}
          </Button>
          {activated && store.deactivateChannel && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void deactivate()}
              icon={<Unplug size={13} />}
            >
              Desativar
            </Button>
          )}
        </div>

        {check && (
          <span
            className={cn(
              "flex items-start gap-1.5 text-[12px]",
              check.ok ? "text-success" : "text-danger",
            )}
          >
            {check.ok ? <Check size={13} /> : <CircleAlert size={13} />}
            {check.text}
          </span>
        )}
        {note && (
          <span className={cn("text-[12px]", note.tone === "ok" ? "text-success" : "text-danger")}>
            {note.text}
          </span>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-4 rounded-sm border border-line bg-bg px-4 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-fg">Credenciais do app da Meta</span>
            <span className="text-[11px] leading-snug text-fg-3">
              Em Meta for Developers → seu app → WhatsApp → API Setup. Use o número da sua empresa.
              O token é gravado cifrado e não volta para o navegador.
            </span>
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            <Field label="WABA ID" hint="WhatsApp Business Account ID.">
              <Input
                className="font-mono"
                value={form.wabaId}
                onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value }))}
                placeholder="123456789012345"
              />
            </Field>
            <Field label="Phone Number ID" hint="ID do número, não o telefone.">
              <Input
                className="font-mono"
                value={form.phoneId}
                onChange={(e) => setForm((f) => ({ ...f, phoneId: e.target.value }))}
                placeholder="987654321098765"
                icon={<MessageCircle size={15} />}
              />
            </Field>
            <Field
              label="Token de acesso"
              hint="Permanente, de um System User. Fica cifrado no servidor."
              className="md:col-span-2"
            >
              <Input
                className="font-mono"
                type="password"
                autoComplete="off"
                value={form.token}
                onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                placeholder="EAA…"
                icon={<KeyRound size={15} />}
              />
            </Field>
            <Field
              label="Modo do canal"
              hint="live envia de verdade; dry-run só simula e serve para testar o produto."
            >
              <Select value={mode} onChange={(e) => setMode(e.target.value as "live" | "dry-run")}>
                <option value="live">live — Cloud API</option>
                <option value="dry-run">dry-run — simulado</option>
              </Select>
            </Field>
          </div>

          <Note>
            Ativar em live faz uma chamada real à Graph: a Meta confirma o número e o token antes de
            qualquer coisa ser gravada. Se a WABA estiver restrita, a ativação é recusada com a
            orientação do Account Quality.
          </Note>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!canSubmit || busy !== null} onClick={() => void activate()}>
              {busy === "save" ? "Ativando…" : "Ativar WhatsApp"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
