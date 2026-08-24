import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../lib/api.js";
import Button from "../components/Button.js";

// Also handles editing: /posts/:id/editar loads the existing post
// (via a client-side lookup, since post-api's GET /posts/:slug only
// returns published ones and this needs to work for the author's own
// drafts too) and PATCHes instead of POSTing on submit.
export default function PostCreate() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [excerpt, setExcerpt] = useState("");
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
          setType(existing.type);
        }
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  async function submit(status: "draft" | "published", e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isEditing && id) {
        await api.updatePost(id, { title, bodyMarkdown, excerpt, status });
      } else {
        await api.createPost({ title, bodyMarkdown, excerpt, type, status });
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
      <h1 className="font-heading font-bold text-3xl text-buteco-amber mb-6">
        {isEditing ? "Editar post" : "Escrever um post"}
      </h1>

      <form className="flex flex-col gap-4">
        <input
          type="text"
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="bg-buteco-brown-light/50 border border-buteco-amber/20 rounded-lg px-4 py-3 text-buteco-cream text-lg font-heading placeholder:text-buteco-cream/40 focus:outline-none focus:border-buteco-amber"
        />

        {!isEditing && (
          <div className="flex gap-4 font-body text-sm">
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

        <input
          type="text"
          placeholder="Resumo curto (opcional)"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className="bg-buteco-brown-light/50 border border-buteco-amber/20 rounded-lg px-4 py-3 text-buteco-cream placeholder:text-buteco-cream/40 focus:outline-none focus:border-buteco-amber"
        />

        <textarea
          placeholder="Escreva em markdown…"
          value={bodyMarkdown}
          onChange={(e) => setBodyMarkdown(e.target.value)}
          required
          rows={16}
          className="bg-buteco-brown-light/50 border border-buteco-amber/20 rounded-lg px-4 py-3 text-buteco-cream font-mono text-sm placeholder:text-buteco-cream/40 focus:outline-none focus:border-buteco-amber resize-y"
        />

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
