import { useEffect, useRef, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Input } from "../ui/index.js";
import { cn } from "../../lib/cn.js";

// The one message shape both rooms share. requestedPage is how the
// book club flags "podemos ir para a página N?" chat commands -- the
// room layer only knows it renders as a highlighted card.
export type ChatMessage = {
  id: string;
  userName: string;
  body: string;
  requestedPage?: number | null;
};

// Composer + transcript. Zero protocol knowledge: the pages own draft
// state and every send; this owns only layout, scroll-to-bottom, and
// the page-request card. `toolbar` sits in the composer row (the book
// club's quote-current-page button); `aboveComposer` renders a full
// row of its own (that same page's page-request form).
export function ChatPanel({
  messages,
  disabled = false,
  disabledPlaceholder = "",
  placeholder,
  draft,
  onDraftChange,
  onSend,
  sendDisabled = false,
  toolbar,
  aboveComposer,
  highlightPageNumbers = false,
  onGoToPage,
  emptyHint = "Ninguém falou nada ainda -- diga oi.",
  className,
}: {
  messages: ChatMessage[];
  disabled?: boolean;
  disabledPlaceholder?: string;
  placeholder: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sendDisabled?: boolean;
  toolbar?: ReactNode;
  aboveComposer?: ReactNode;
  highlightPageNumbers?: boolean;
  onGoToPage?: (page: number) => void;
  emptyHint?: string;
  className?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className={cn("flex flex-col flex-1 min-h-0 overflow-hidden", className)}>
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 flex flex-col gap-3 min-h-0" aria-live="polite">
        {messages.length === 0 && <p className="text-buteco-cream/35 text-sm italic">{emptyHint}</p>}
        {messages.map((m) =>
          highlightPageNumbers && m.requestedPage ? (
            <div key={m.id} className="rounded-xl border border-buteco-amber/30 bg-buteco-amber/10 p-2.5">
              <p className="text-xs text-buteco-cream/90 leading-relaxed">
                <span className="font-heading font-semibold text-buteco-amber">{m.userName}</span> {m.body}
              </p>
              {onGoToPage && (
                <button
                  type="button"
                  onClick={() => onGoToPage(m.requestedPage!)}
                  className="mt-2 text-xs font-heading font-semibold text-buteco-navy bg-buteco-amber rounded-lg px-2.5 py-1 cursor-pointer hover:bg-buteco-amber-light transition-colors"
                >
                  Ir para a página {m.requestedPage} →
                </button>
              )}
            </div>
          ) : (
            <div key={m.id}>
              <span className="font-heading text-sm text-buteco-amber">{m.userName}</span>
              <p className="text-buteco-cream/90 text-sm break-words">{m.body}</p>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {aboveComposer}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="p-2.5 sm:p-3 border-t border-white/10 flex gap-2"
      >
        {toolbar}
        <Input
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={disabled ? disabledPlaceholder : placeholder}
          disabled={disabled || sendDisabled}
          size="sm"
          className="flex-1"
        />
        <button
          type="submit"
          disabled={disabled || sendDisabled}
          aria-label="Enviar mensagem"
          className="shrink-0 w-9 h-9 grid place-items-center rounded-lg bg-buteco-amber text-buteco-navy hover:bg-buteco-amber-light transition-colors disabled:opacity-40 cursor-pointer"
        >
          <Send size={15} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}