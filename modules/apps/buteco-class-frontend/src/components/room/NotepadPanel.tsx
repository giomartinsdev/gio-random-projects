import { Textarea } from "../ui/index.js";
import { cn } from "../../lib/cn.js";

// bookclub-/classroom-api both reject bodies over 20k characters;
// enforcing it at the textarea means a paste clamp instead of a drop:
// the server just discards what doesn't fit.
const MAX_LENGTH = 20_000;

// Shared real-time notepad look + the counter and the honesty line
// the old UI never said out loud: text IS server-saved, but the
// note is wiped when the room empties. Claiming persistence here
// would be a lie users lose notes to.
export function NotepadPanel({
  value,
  onChange,
  disabled = false,
  disabledPlaceholder = "",
  placeholder,
  emptyNote = "salvo no servidor, mas some quando a sala esvazia",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledPlaceholder?: string;
  placeholder: string;
  emptyNote?: string;
  className?: string;
}) {
  const nearLimit = value.length > MAX_LENGTH - 1000;
  return (
    <div className={cn("flex flex-col flex-1 min-h-0", className)}>
      <div className="px-3 sm:px-4 pt-3 pb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/40 truncate">bloco compartilhado</span>
        <span className={cn("font-mono text-[0.65rem] whitespace-nowrap", nearLimit ? "text-buteco-amber" : "text-buteco-cream/40")}>
          {value.length.toLocaleString("pt-BR")}/{MAX_LENGTH.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="flex-1 min-h-0 px-3 sm:px-4 pb-3">
        {/* Inset document field, edge-to-edge inside the panel card. */}
        <Textarea
          value={value}
          maxLength={MAX_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={disabled ? disabledPlaceholder : placeholder}
          className="w-full h-full resize-none font-mono text-sm leading-relaxed scroll-smooth"
        />
      </div>
      <p className="px-3 sm:px-4 py-2 border-t border-white/5 text-[0.65rem] font-mono text-buteco-cream/35 shrink-0">{emptyNote}</p>
    </div>
  );
}