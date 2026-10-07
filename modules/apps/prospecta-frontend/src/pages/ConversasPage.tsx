import { useEffect, useState } from "react";
import { EllipsisVertical, Send, SlidersHorizontal, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { CONVERSATION_DETAIL, CONVERSATIONS } from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationDetail, Message } from "@/lib/types";
import { AgentBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Orb } from "@/components/ui/Orb";
import { Avatar } from "@/components/ui/Table";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ConversasPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useAsync<{ items: Conversation[] }>(() => api.conversations(), { items: CONVERSATIONS });
  const detail = useAsync<ConversationDetail>(
    () => (selected ? api.conversation(selected) : Promise.resolve(CONVERSATION_DETAIL)),
    CONVERSATION_DETAIL,
    [selected],
  );
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(CONVERSATION_DETAIL.messages);

  // Abre a primeira conversa por padrão, como no design (thread sempre à vista).
  useEffect(() => {
    if (selected === null && list.data.items.length > 0) setSelected(list.data.items[0].id);
  }, [list.data, selected]);

  useEffect(() => setMessages(detail.data.messages), [detail.data]);

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, channel: detail.data.channel, direction: "out", status: "drafted", content }]);
    try {
      await api.sendMessage({ lead_id: detail.data.lead_id, channel: detail.data.channel, content });
    } catch {
      // Sem API no ar: a bolha local já mostra a intenção do operador.
    }
  }

  const unread = list.data.items.find((c) => c.id === selected)?.unread;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line px-[18px] pb-3.5 pt-[18px]">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-fg">Conversas</h2>
            <SlidersHorizontal size={16} className="text-fg-3" />
          </div>
          <Input placeholder="Buscar conversas…" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {list.data.items.map((conv) => {
            const active = conv.id === selected;
            return (
              <button
                key={conv.id}
                onClick={() => setSelected(conv.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-[18px] py-3.5 text-left transition-colors",
                  active ? "bg-elevated" : "hover:bg-elevated/50",
                )}
              >
                <Avatar initials={initials(conv.company_name)} size={40} tone={conv.unread ? "accent" : "elevated"} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{conv.company_name}</span>
                    {conv.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </div>
                  <span className="truncate text-[13px] text-fg-2">{conv.last_message}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Avatar initials={initials(detail.data.company_name)} size={38} tone={unread ? "accent" : "elevated"} />
            <div className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold text-fg">{detail.data.company_name}</span>
              <span className="text-[12px] text-fg-3">
                {detail.data.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <AgentBadge label="Agente responde" state="writing" />
            <EllipsisVertical size={18} className="text-fg-3" />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-thin px-6 pb-4 pt-6">
          <span className="text-center font-mono text-[11px] text-fg-3">HOJE</span>
          {messages.map((msg) =>
            msg.direction === "in" ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[520px] rounded-md bg-accent p-4">
                  <p className="text-[13px] leading-relaxed text-white">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-2.5">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center">
                  <Orb state="writing" size={22} glow={false} />
                </span>
                <div className="max-w-[520px] rounded-md border border-line bg-surface p-4">
                  <p className="text-[13px] leading-relaxed text-fg-2">{msg.content}</p>
                </div>
              </div>
            ),
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-6 pb-5 pt-3.5">
          <div className="flex items-center gap-3 rounded-md border border-line bg-elevated p-3">
            <Sparkles size={16} className="shrink-0 text-accent-light" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium text-fg">Sugestão do agente</span>
              <span className="truncate text-[12px] text-fg-2">
                Responder com o material e propor 15 min na quinta.
              </span>
            </div>
            <Button className="shrink-0 py-2.5 text-[14px]">Aprovar e enviar</Button>
          </div>
          <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-4 py-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Escreva ou peça ao agente para responder…"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-3 outline-none"
            />
            <button onClick={send} aria-label="Enviar" className="text-accent transition-opacity hover:opacity-80">
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
