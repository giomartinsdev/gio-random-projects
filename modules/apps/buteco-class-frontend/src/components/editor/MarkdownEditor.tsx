import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bold, Code, Heading2, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2, Music2, Quote, Youtube } from "lucide-react";
import MarkdownContent from "../MarkdownContent.js";
import { Textarea, IconButton } from "../ui/index.js";
import { cn } from "../../lib/cn.js";
import { api } from "../../lib/api.js";

type Insert = {
  id: string;
  title: string;
  icon: LucideIcon;
  before: string;
  after: string;
  placeholder: string;
};

// Data, not handlers: each button is (before + selected + after).
// YouTube/Spotify insert a labelled link on its own line the way
// PostCreate historically did -- MarkdownContent's <a> component
// upgrades those into the big chips.
const EDITS: Insert[] = [
  { id: "heading", title: "Seção (##)", icon: Heading2, before: "\n\n## ", after: "", placeholder: "Título da seção" },
  { id: "bold", title: "Negrito (Ctrl/⌘+B)", icon: Bold, before: "**", after: "**", placeholder: "negrito" },
  { id: "italic", title: "Itálico (Ctrl/⌘+I)", icon: Italic, before: "*", after: "*", placeholder: "itálico" },
  { id: "quote", title: "Citação", icon: Quote, before: "\n> ", after: "", placeholder: "citação" },
  { id: "list", title: "Lista", icon: List, before: "\n- ", after: "", placeholder: "item" },
  { id: "ordered-list", title: "Lista numerada", icon: ListOrdered, before: "\n1. ", after: "", placeholder: "item" },
  { id: "code", title: "Código", icon: Code, before: "`", after: "`", placeholder: "código" },
  { id: "link", title: "Link (Ctrl/⌘+K)", icon: Link2, before: "[", after: "](https://)", placeholder: "texto do link" },
  {
    id: "youtube",
    title: "Link do YouTube (Ctrl/⌘+Shift+L)",
    icon: Youtube,
    before: "\n\n[Assista no YouTube](",
    after: ")\n\n",
    placeholder: "https://www.youtube.com/watch?v=...",
  },
  {
    id: "spotify",
    title: "Link do Spotify",
    icon: Music2,
    before: "\n\n[Ouça no Spotify](",
    after: ")\n\n",
    placeholder: "https://open.spotify.com/...",
  },
];

// Ctrl/⌘+B/I/K inline; YouTube's map entry is deliberately absent from
// this table -- it wants Shift too, and a plain Ctrl/⌘+L must not steal
// the browser's own focus-the-address-bar row.
const SHORTCUTS: Record<string, string> = { b: "bold", i: "italic", k: "link" };

// Markdown textarea + formatting toolbar + live preview. Fully
// controlled (value/onChange). Insertions use setRangeText on the
// textarea itself -- the DOM stays the source of truth for selection,
// then the new text flows through onChange for React. Keyboard
// shortcuts (Ctrl/⌘+B/I/K and +Shift+L for YouTube) live on the
// textarea, so they only fire while typing there.
export default function MarkdownEditor({
  value,
  onChange,
  label = "Escreva em markdown…",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(false);

  function insert(edit: Insert) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || edit.placeholder;
    const replaced = edit.before + selected + edit.after;
    // "select" collapses the new selection onto the replaced range --
    // the follow-up setSelectionRange then lands exactly on the
    // placeholder/text inside the wrappers for immediate overtyping.
    el.setRangeText(replaced, start, end, "select");
    // State first, then focus: React re-render keeps the DOM value
    // identical (it just became el.value), so selection survives.
    onChange(el.value);
    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      if (!el2) return;
      el2.focus();
      const selStart = start + edit.before.length;
      el2.setSelectionRange(selStart, selStart + selected.length);
    });
  }

  // Same insertion point dance without the wrapper/placeholder split --
  // an uploaded image lands as one ready-made `![alt](url)` snippet.
  function insertMarkdown(text: string) {
    const el = textareaRef.current;
    if (!el) return;
    el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
    onChange(el.value);
    requestAnimationFrame(() => el.focus());
  }

  async function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first so picking the same file again re-fires onChange.
    e.target.value = "";
    if (!file || uploading) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      const alt = file.name.replace(/\.[a-z0-9]+$/i, "").trim() || "imagem";
      insertMarkdown(`![${alt}](${url})`);
    } catch {
      // Upload failed (MinIO down, not logged in): fall back to the
      // old pasted-URL template rather than losing the click entirely.
      insertMarkdown(`![imagem](https://)`);
    } finally {
      setUploading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    const editId = e.shiftKey && key === "l" ? "youtube" : SHORTCUTS[key];
    if (!editId) return;
    const edit = EDITS.find((x) => x.id === editId);
    if (!edit) return;
    e.preventDefault();
    insert(edit);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 glass-card p-1.5 w-fit flex-wrap">
        {EDITS.map((edit) => {
          const Icon = edit.icon;
          return <IconButton key={edit.id} label={edit.title} size="sm" onClick={() => insert(edit)}><Icon size={15} /></IconButton>;
        })}
        {/* Upload real (MinIO) instead of the old paste-a-URL insert --
            the picker keeps the same spot in the toolbar the "image"
            button always had. */}
        <IconButton label="Enviar imagem" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void handlePicked(e)}
        />
      </div>

      {/* Mobile: write/preview tabs. Desktop: split panes, preview always up. */}
      <div className="lg:hidden flex gap-1 glass-card p-1 w-fit" role="tablist" aria-label="Editor ou prévia">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-1.5 rounded-lg font-heading font-semibold text-xs cursor-pointer transition-colors",
              tab === t ? "bg-buteco-amber/15 text-buteco-amber" : "text-buteco-cream/60 hover:text-buteco-cream",
            )}
          >
            {t === "write" ? "Escrever" : "Prévia"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Textarea
          ref={textareaRef}
          placeholder={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className={cn("font-mono min-h-[22rem] lg:h-[32rem] resize-y", tab === "preview" && "hidden lg:block")}
        />
        <div
          className={cn(
            "glass-card p-5 lg:p-6 overflow-y-auto lg:h-[32rem]",
            tab === "preview" ? "block" : "hidden lg:block",
          )}
        >
          <p className="font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/40 mb-4">Prévia em tempo real</p>
          {value ? (
            <MarkdownContent content={value} />
          ) : (
            <p className="text-buteco-cream/30 text-sm italic">O que você escrever aparece aqui…</p>
          )}
        </div>
      </div>
    </div>
  );
}