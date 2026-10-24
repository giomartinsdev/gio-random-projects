import { useState } from "react";
import { CircleAlert, Plus, Trash2, Wand2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { HeaderKind, Template, TemplateButton, TemplateCategory, TemplateVariable } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Drawer";
import { Tag } from "@/components/ui/Badge";
import { WhatsAppPreview } from "@/components/WhatsAppPreview";
import { Note } from "@/components/Topbar";

type Draft = Omit<Template, "id" | "createdAt" | "updatedAt" | "metrics" | "metaId" | "quality" | "status">;

const EMPTY: Draft = {
  name: "",
  displayName: "",
  channel: "whatsapp",
  category: "marketing",
  language: "pt_BR",
  header: { kind: "none" },
  body: "",
  footer: "",
  buttons: [],
  variables: [],
};

/**
 * Editor de template. A Meta exige nome snake_case, categoria e variáveis
 * posicionais com exemplo — o formulário cobra isso antes de "enviar", porque
 * um template rejeitado custa dias. Nada aqui chama a Meta: o template entra
 * como `pending` (ou `draft`, se o operador só salvar).
 */
export function TemplateEditor({
  onClose,
  initial,
}: {
  onClose: () => void;
  /** Se vier de "Duplicar", o formulário nasce preenchido (nome novo, status draft). */
  initial?: Template;
}) {
  const { createTemplate, logActivity } = useStore();
  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? {
          name: `${initial.name}_copia`.slice(0, 60),
          displayName: `${initial.displayName} (cópia)`,
          channel: initial.channel,
          category: initial.category,
          language: initial.language,
          header: initial.header,
          body: initial.body,
          footer: initial.footer,
          buttons: initial.buttons,
          variables: initial.variables,
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** Extrai {{n}} do corpo e mantém as variáveis já configuradas. */
  function syncVariables(body: string) {
    set("body", body);
    setDraft((d) => {
      const indices = Array.from(new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]))).sort(
        (a, b) => Number(a) - Number(b),
      );
      const next: TemplateVariable[] = indices.map(
        (i) => d.variables.find((v) => v.index === i) ?? { index: i, label: "", example: "" },
      );
      return { ...d, variables: next };
    });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!draft.displayName.trim()) e.displayName = "Dê um nome legível para o time.";
    if (!/^[a-z0-9_]{2,60}$/.test(draft.name)) e.name = "Use snake_case, 2–60 caracteres (ex.: reativacao_cupom).";
    if (draft.body.trim().length < 12) e.body = "O corpo precisa ter pelo menos uma frase.";
    if (draft.body.length > 1024) e.body = "A Meta limita o corpo a 1024 caracteres.";
    draft.variables.forEach((v) => {
      if (!v.label.trim()) e[`var-${v.index}`] = "Descreva o que entra aqui.";
      if (!v.example.trim()) e[`var-${v.index}`] = "Exemplo obrigatório (a Meta pede na submissão).";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function save(status: Template["status"]) {
    if (!validate()) return;
    const t = createTemplate({ ...draft, status });
    logActivity({
      kind: "template",
      title: status === "pending" ? "Template enviado para a Meta" : "Template salvo como rascunho",
      detail: `${t.name} · ${t.category}`,
      refId: t.id,
    });
    onClose();
  }

  return (
    <Modal
      open
      title={initial ? "Duplicar template" : "Novo template"}
      subtitle="O mesmo conteúdo que você vai submeter à Meta — com prévia fiel."
      onClose={onClose}
      width={960}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => save("draft")}>
            Salvar rascunho
          </Button>
          <Button size="sm" icon={<Wand2 size={15} />} onClick={() => save("pending")}>
            Enviar para análise
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Nome para o time" error={errors.displayName}>
              <Input
                value={draft.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder="Volta pro café — cupom pessoal"
              />
            </Field>
            <Field label="Nome técnico (snake_case)" error={errors.name}>
              <Input
                value={draft.name}
                onChange={(e) => set("name", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder="reativacao_cupom_volta"
                className="font-mono"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Categoria" hint="Marketing exige opt-in; utilidade é transacional.">
              <Select value={draft.category} onChange={(e) => set("category", e.target.value as TemplateCategory)}>
                <option value="marketing">Marketing</option>
                <option value="utility">Utilidade</option>
                <option value="authentication">Autenticação</option>
              </Select>
            </Field>
            <Field label="Idioma">
              <Select value={draft.language} onChange={(e) => set("language", e.target.value)}>
                <option value="pt_BR">Português (BR)</option>
                <option value="es_ES">Espanhol</option>
                <option value="en_US">Inglês</option>
              </Select>
            </Field>
          </div>

          <Field label="Cabeçalho">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={draft.header.kind}
                onChange={(e) => {
                  const kind = e.target.value as HeaderKind;
                  set("header", { ...draft.header, kind });
                }}
                className="w-[150px]"
              >
                <option value="none">Sem cabeçalho</option>
                <option value="text">Texto</option>
                <option value="image">Imagem</option>
                <option value="video">Vídeo</option>
                <option value="document">Documento</option>
              </Select>
              {draft.header.kind === "text" && (
                <Input
                  value={draft.header.text ?? ""}
                  onChange={(e) => set("header", { ...draft.header, text: e.target.value })}
                  placeholder="Seu café, todo mês"
                  className="min-w-[200px] flex-1"
                />
              )}
              {(draft.header.kind === "image" ||
                draft.header.kind === "video" ||
                draft.header.kind === "document") && (
                <Input
                  value={draft.header.mediaHint ?? ""}
                  onChange={(e) => set("header", { ...draft.header, mediaHint: e.target.value })}
                  placeholder="nome-do-arquivo.jpg"
                  className="min-w-[200px] flex-1 font-mono"
                />
              )}
            </div>
          </Field>

          <Field
            label="Corpo da mensagem"
            error={errors.body}
            hint="Use {{1}}, {{2}}… para variáveis. A prévia ao lado mostra exatamente como chega."
          >
            <Textarea
              value={draft.body}
              onChange={(e) => syncVariables(e.target.value)}
              className="min-h-[130px]"
              placeholder={"Oi, {{1}}! Faz tempo que você não passa por aqui ☕\n\nSeparamos um cupom só seu: *{{2}}*."}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Rodapé (opcional)" hint="Até 60 caracteres.">
              <Input value={draft.footer ?? ""} onChange={(e) => set("footer", e.target.value)} placeholder="Café Aurora" />
            </Field>
            <Field label="Validade do cupom embutido" hint="Informativo — a oferta real vive na campanha.">
              <Input placeholder="30/11" disabled />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-fg-2">Botões</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => set("buttons", [...draft.buttons, { type: "quick_reply", text: "" }])}
              >
                Adicionar
              </Button>
            </div>
            {draft.buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={b.type}
                  onChange={(e) => {
                    const next = [...draft.buttons];
                    next[i] = { ...b, type: e.target.value as TemplateButton["type"] };
                    set("buttons", next);
                  }}
                  className="w-[130px]"
                >
                  <option value="quick_reply">Resposta</option>
                  <option value="url">URL</option>
                  <option value="phone">Telefone</option>
                </Select>
                <Input
                  value={b.text}
                  onChange={(e) => {
                    const next = [...draft.buttons];
                    next[i] = { ...b, text: e.target.value };
                    set("buttons", next);
                  }}
                  placeholder="Usar meu cupom"
                />
                <IconButton label="Remover botão" onClick={() => set("buttons", draft.buttons.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
            {draft.buttons.length === 0 && <Note>Sem botões. A mensagem ainda pede uma resposta em texto.</Note>}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-fg-2">Variáveis</span>
            {draft.variables.length === 0 ? (
              <Note>Nenhuma variável. Escreva {"{{1}}"} no corpo para o editor pedir o mapeamento.</Note>
            ) : (
              <div className="flex flex-col gap-2">
                {draft.variables.map((v) => (
                  <div key={v.index} className="flex items-start gap-2">
                    <Tag className="mt-2.5 shrink-0">{`{{${v.index}}}`}</Tag>
                    <Field className="flex-1" error={errors[`var-${v.index}`]}>
                      <Input
                        value={v.label}
                        onChange={(e) =>
                          set(
                            "variables",
                            draft.variables.map((x) => (x.index === v.index ? { ...x, label: e.target.value } : x)),
                          )
                        }
                        placeholder="Primeiro nome"
                      />
                    </Field>
                    <Field className="w-[180px] shrink-0">
                      <Input
                        value={v.example}
                        onChange={(e) =>
                          set(
                            "variables",
                            draft.variables.map((x) => (x.index === v.index ? { ...x, example: e.target.value } : x)),
                          )
                        }
                        placeholder="Ana"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-sm border border-line bg-bg p-3">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-[11px] leading-relaxed text-fg-3">
              Depois de aprovado, o conteúdo não muda: alterações exigem um novo template. Nome, categoria e idioma não
              podem ser reciclados por 30 dias.
            </p>
          </div>
        </div>

        <div className="flex w-[380px] shrink-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="caps">Prévia</span>
            <button onClick={onClose} className="text-fg-3 transition-colors hover:text-fg lg:hidden" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>
          <div className={cn("rounded-md border border-line bg-bg p-3")}>
            <WhatsAppPreview
              template={{
                header: draft.header,
                body: draft.body || "Escreva o corpo para ver a prévia…",
                footer: draft.footer,
                buttons: draft.buttons.filter((b) => b.text.trim()),
                variables: draft.variables,
              }}
            />
          </div>
          <Note>
            A prévia usa os valores de exemplo das variáveis. No envio real, cada contato recebe o seu.
          </Note>
        </div>
      </div>
    </Modal>
  );
}
