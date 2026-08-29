import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../lib/api.js";
import { Button, Input, Textarea } from "../components/ui/index.js";
import MarkdownContent from "../components/MarkdownContent.js";
import { resolveImageUrl } from "../lib/discordActivity.js";

type ToolbarAction = {
  label: string;
  title: string;
  before: string;
  after: string;
  placeholder: string;
};

const TOOLBAR: ToolbarAction[] = [
  { label: "B", title: "Negrito", before: "**", after: "**", placeholder: "negrito" },
  { label: "I", title: "Itálico", before: "*", after: "*", placeholder: "itálico" },
  { label: "“”", title: "Citação", before: "\n> ", after: "", placeholder: "citação" },
  { label: "</>", title: "Código", before: "`", after: "`", placeholder: "código" },
  { label: "🔗", title: "Link", before: "[", after: "](https://)", placeholder: "texto do link" },
  { label: "🖼️", title: "Imagem", before: "![", after: "](https://)", placeholder: "alt da imagem" },
  {
    label: "▶️",
    title: "Link do YouTube",
    before: "\n\n[Assista no YouTube](",
    after: ")\n\n",
    placeholder: "https://www.youtube.com/watch?v=...",
  },
  {
    label: "🎧",
    title: "Link do Spotify",
    before: "\n\n[Ouça no Spotify](",
    after: ")\n\n",
    placeholder: "https://open.spotify.com/...",
  },
];

// Also handles editing: /posts/:id/editar loads the existing post
// (via a client-side lookup, since post-api's GET /posts/:slug only
// returns published ones and this needs to work for the author's own
// drafts too) and PATCHes instead of POSTing on submit.
export default function PostCreate() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [type, setType] = useState<"article" | "course">("article");
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEditing);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // Owner-only edit means we can't rely on the public slug lookup
    // for drafts -- PATCH itself does the real ownership check
    // server-side; this local list scan is just to prefill the form
    // and works for both draft and published since it also covers
    // this author's own unpublished posts once listed.
    api
      .listPosts()
      .then((res) => {
        const existing = res.posts.find((p) => p.id === id);
        if (existing) {
          setTitle(existing.title);
          setBodyMarkdown(existing.bodyMarkdown);
          setExcerpt(existing.excerpt);
          setCoverImageUrl(existing.coverImageUrl);
          setType(existing.type);
        }
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  function applyToolbarAction(action: ToolbarAction) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = bodyMarkdown.slice(start, end) || action.placeholder;
    const next = bodyMarkdown.slice(0, start) + action.before + selected + action.after + bodyMarkdown.slice(end);
    setBodyMarkdown(next);
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + action.before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  }

  async function submit(status: "draft" | "published", e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isEditing && id) {
        await api.updatePost(id, { title, bodyMarkdown, excerpt, coverImageUrl, status });
      } else {
        await api.createPost({ title, bodyMarkdown, excerpt, coverImageUrl, type, status });
      }
      navigate("/perfil");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
    } finally {
      setLoading(false);
    }
  }

  if (loadingExisting) return <p className="text-buteco-cream/60">Carregando…</p>;

  return (
    <div>
      <h1 className="font-heading font-bold text-3xl mb-6">
        {isEditing ? "Editar post" : "Escrever um "}
        {!isEditing && <span className="text-gradient">post</span>}
      </h1>

      <form className="flex flex-col gap-4">
        <Input
          type="text"
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="text-lg font-heading"
        />

        <div className="flex flex-wrap gap-4">
          {!isEditing && (
            <div className="flex gap-4 font-body text-sm items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={type === "article"} onChange={() => setType("article")} />
                Artigo
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={type === "course"} onChange={() => setType("course")} />
                Curso
              </label>
            </div>
          )}
        </div>

        <Input
          type="text"
          placeholder="Resumo curto (opcional)"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />

        <div className="flex gap-3 items-start">
          <Input
            type="text"
            placeholder="URL da imagem de capa (opcional) — o fru-fru que deixa o post bonitão"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            className="flex-1"
          />
          {coverImageUrl && (
            <img
              src={resolveImageUrl(coverImageUrl)}
              alt="Prévia da capa"
              className="w-14 h-14 rounded-lg object-cover border border-buteco-amber/20 shrink-0"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          )}
        </div>

        {/* Formatting toolbar: inserts markdown at the cursor rather than
            requiring the author to hand-write syntax -- YouTube/Spotify
            buttons insert a placeholder link on its own line, which
            MarkdownContent's <a> renderer then turns into a clickable
            chip once the URL is filled in. */}
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2 glass-card p-1.5 w-fit">
            {TOOLBAR.map((action) => (
              <button
                key={action.title}
                type="button"
                title={action.title}
                onClick={() => applyToolbarAction(action)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-heading text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Textarea
              ref={textareaRef}
              placeholder="Escreva em markdown…"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              required
              rows={20}
              className="font-mono resize-y"
            />

            <div className="glass-card p-6 overflow-y-auto max-h-[36rem]">
              <p className="font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/40 mb-4">
                Prévia em tempo real
              </p>
              {bodyMarkdown ? (
                <MarkdownContent content={bodyMarkdown} />
              ) : (
                <p className="text-buteco-cream/30 text-sm italic">O que você escrever aparece aqui…</p>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 mt-2">
          <Button variant="secondary" disabled={loading} onClick={(e) => submit("draft", e)}>
            Salvar rascunho
          </Button>
          <Button disabled={loading} onClick={(e) => submit("published", e)}>
            Publicar
          </Button>
        </div>
      </form>
    </div>
  );
}
