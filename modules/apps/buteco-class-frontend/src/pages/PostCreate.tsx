import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { Trash2 } from "lucide-react";
import { api, type ImportedPost } from "../lib/api.js";
import { clearPostDraft, loadPostDraft, postDraftKey, usePostDraftAutosave, type PostDraft } from "../lib/useAutosave.js";
import MarkdownEditor from "../components/editor/MarkdownEditor.js";
import { Banner, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, PageShell, Spinner, Textarea } from "../components/ui/index.js";
import { resolveImageUrl } from "../lib/discordActivity.js";
import { useSession } from "../lib/authClient.js";

function segmentedClasses(active: boolean): string {
  return [
    "px-3 h-9 inline-flex items-center rounded-lg font-heading font-semibold text-sm border transition-colors cursor-pointer",
    active
      ? "border-buteco-amber text-buteco-amber bg-buteco-amber/10"
      : "border-white/15 text-buteco-cream/80 hover:border-buteco-amber/40",
  ].join(" ");
}

const IMPORT_PROVIDER_LABEL: Record<ImportedPost["provider"], string> = {
  "dev.to": "dev.to",
  tabnews: "TabNews",
  medium: "Medium",
};

// Also handles editing: /posts/:id/editar finds the post in the
// author's own list (post-api's GET /posts/:slug only returns
// published ones and this must cover drafts too) and PATCHes instead
// of POSTing. Both paths autosave a localStorage draft copy; "delete"
// exists only in edit mode.
export default function PostCreate() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { data: session } = useSession();

  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [type, setType] = useState<PostDraft["type"]>("article");
  const [coverBroken, setCoverBroken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEditing);
  const [lookupFailed, setLookupFailed] = useState<string | false>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [restoreDraft, setRestoreDraft] = useState<ReturnType<typeof loadPostDraft>>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importedFrom, setImportedFrom] = useState<ImportedPost["provider"] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmingImport, setConfirmingImport] = useState(false);

  const draftKey = postDraftKey(id);
  const dirtyRef = useRef(false);
  const submittedRef = useRef(false);

  // Prefill from the author's own list; also flags a missing post
  // (deleted, wrong URL) vs. a post someone else owns ≠ editable.
  useEffect(() => {
    if (!id) {
      setLoadingExisting(false);
      setRestoreDraft(loadPostDraft(draftKey));
      return;
    }
    setRestoreDraft(loadPostDraft(draftKey));
    let cancelled = false;
    api
      .listPostsCached()
      .then((res) => {
        if (cancelled) return;
        const existing = res.posts.find((p) => p.id === id);
        if (!existing) {
          setLookupFailed("Esse post não existe (ou foi apagado).");
          return;
        }
        if (session && existing.authorId !== session.user.id) {
          setLookupFailed("Esse post não é seu -- só o autor pode editar.");
          return;
        }
        setTitle(existing.title);
        setBodyMarkdown(existing.bodyMarkdown);
        setExcerpt(existing.excerpt);
        setCoverImageUrl(existing.coverImageUrl);
        setType(existing.type);
      })
      .catch(() => {
        if (!cancelled) setLookupFailed("Não foi possível carregar o post pra editar.");
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, draftKey, session]);

  const draft: PostDraft = useMemo(
    () => ({ title, bodyMarkdown, excerpt, coverImageUrl, type }),
    [title, bodyMarkdown, excerpt, coverImageUrl, type],
  );
  usePostDraftAutosave(draftKey, draft, { enabled: !loadingExisting });

  // data-router guard (App.tsx uses createBrowserRouter): leaving the
  // form with edits in it asks before losing them. Submitting the
  // form flags itself as an intentional navigation first.
  const blocker = useBlocker(() => Boolean(dirtyRef.current && !submittedRef.current));
  useEffect(() => {
    if (blocker.state === "blocked") setConfirmingLeave(true);
  }, [blocker.state]);

  function markDirty(): void {
    dirtyRef.current = true;
  }

  function restore(): void {
    if (!restoreDraft) return;
    setTitle(restoreDraft.title);
    setBodyMarkdown(restoreDraft.bodyMarkdown);
    setExcerpt(restoreDraft.excerpt);
    setCoverImageUrl(restoreDraft.coverImageUrl);
    setType(restoreDraft.type);
    markDirty();
    setRestoreDraft(null);
  }

  function discardDraft(): void {
    clearPostDraft(draftKey);
    setRestoreDraft(null);
  }

  // Import fills the same fields the author would have typed; the
  // material lands in the editor for review, never straight to
  // published -- server-side the endpoint doesn't create the post at
  // all (see importAdapter.ts on why attribution lives in the body).
  function applyImport(article: ImportedPost): void {
    setTitle(article.title);
    setBodyMarkdown(article.bodyMarkdown);
    setExcerpt(article.excerpt ?? "");
    setCoverImageUrl(article.coverImageUrl ?? "");
    markDirty();
    setImportedFrom(article.provider);
    setImportError(null);
    setImportUrl("");
  }

  async function handleImport(): Promise<void> {
    if (!importUrl.trim()) return;
    setImportError(null);
    setImporting(true);
    try {
      applyImport(await api.importPost(importUrl.trim()));
    } catch (err) {
      // The API's 400 messages name the problem (unsupported site, body
      // too large) in English; keep them -- they're at least precise.
      setImportError(err instanceof Error ? err.message : "Não foi possível importar esse link.");
    } finally {
      setImporting(false);
    }
  }

  function requestImport(): void {
    if (!importUrl.trim() || importing) return;
    setImportedFrom(null);
    // Never blow away typed content without an explicit yes.
    if (title.trim() || bodyMarkdown.trim()) setConfirmingImport(true);
    else void handleImport();
  }

  async function submit(status: "draft" | "published") {
    if (!title.trim() || !bodyMarkdown.trim()) {
      setError("Título e corpo são obrigatórios.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isEditing && id) {
        await api.updatePost(id, { title, bodyMarkdown, excerpt, coverImageUrl, status });
      } else {
        await api.createPost({ title, bodyMarkdown, excerpt, coverImageUrl, type, status });
      }
      clearPostDraft(draftKey);
      // post-api answers 202 and processes async: navigate now, the
      // profile list is the source of truth.
      submittedRef.current = true;
      dirtyRef.current = false;
      navigate("/perfil");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
      setSubmitting(false);
      submittedRef.current = false;
    }
  }

  async function remove(): Promise<void> {
    if (!id || deleting) return;
    setDeleting(true);
    try {
      // Same 202-as-command shape: the profile list removes it when
      // the worker gets to it, this just navigates.
      await api.deletePost(id);
      clearPostDraft(draftKey);
      submittedRef.current = true;
      dirtyRef.current = false;
      navigate("/perfil");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (loadingExisting) {
    return (
      <PageShell width="wide">
        <div role="status" aria-label="Carregando post" className="flex items-center gap-3 text-buteco-cream/60 text-sm">
          <Spinner size="sm" /> Carregando o post…
        </div>
      </PageShell>
    );
  }

  if (lookupFailed) {
    return (
      <PageShell width="wide">
        <EmptyState
          title="Não dá pra editar este post"
          description={lookupFailed}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate("/perfil")}>
              Voltar ao perfil
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide" className="pb-24">
      <h1 className="font-heading font-bold text-3xl mb-6">
        {isEditing ? (
          "Editar post"
        ) : (
          <>
            Escrever um <span className="text-gradient">post</span>
          </>
        )}
      </h1>

      {!isEditing && (
        <details className="glass-card p-4 group">
          <summary className="flex items-center gap-1.5 text-sm font-semibold text-buteco-cream/80 hover:text-buteco-cream transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="transition-transform duration-200 group-open:rotate-90" aria-hidden="true">
              ›
            </span>
            Importar de um link (Medium, dev.to, TabNews)
          </summary>
          <div className="flex flex-col gap-3 pt-4">
            <div className="flex gap-3 items-start">
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                type="url"
                placeholder="https://medium.com/@alguem/meu-artigo"
                className="flex-1"
              />
              <Button type="button" variant="secondary" loading={importing} onClick={requestImport} className="shrink-0">
                Importar
              </Button>
            </div>
            <p className="text-xs text-buteco-cream/50">
              O texto cai aqui no editor pra você revisar antes de publicar — e o crédito{" "}
              <em>"Retirado daqui do …"</em> entra no fim do post automaticamente.
            </p>
            {importedFrom && (
              <Banner tone="info">
                Importado do {IMPORT_PROVIDER_LABEL[importedFrom]}. Dá uma lida e ajusta o que precisar antes de publicar.
              </Banner>
            )}
            {importError && <Banner tone="error">{importError}</Banner>}
          </div>
        </details>
      )}

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("published");
        }}
      >
        {restoreDraft && (
          <Banner tone="info" title="Rascunho automático encontrado">
            <p>
              Salvo há {restoreDraft.savedAt ? Math.max(1, Math.round((Date.now() - restoreDraft.savedAt) / 60_000)) : 1} min.
              Preenche o que estava digitado.
            </p>
            <div className="flex gap-2 mt-2">
              <Button type="button" size="sm" onClick={restore}>
                Restaurar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={discardDraft}>
                Descartar
              </Button>
            </div>
          </Banner>
        )}

        <Field label="Título" counter={{ value: title.length, warnAt: 120 }}>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            required
            placeholder="De que se trata?"
            className="text-lg font-heading"
          />
        </Field>

        {!isEditing && (
          <Field label="Tipo">
            <div role="group" aria-label="Tipo do post" className="flex gap-2">
              <button type="button" onClick={() => { setType("article"); markDirty(); }} aria-pressed={type === "article"} className={segmentedClasses(type === "article")}>
                Artigo
              </button>
              <button type="button" onClick={() => { setType("course"); markDirty(); }} aria-pressed={type === "course"} className={segmentedClasses(type === "course")}>
                Curso
              </button>
            </div>
          </Field>
        )}

        <Field label="Resumo" hint="Aparece nos cartões da home" counter={{ value: excerpt.length, warnAt: 200 }}>
          <Textarea
            value={excerpt}
            onChange={(e) => {
              setExcerpt(e.target.value);
              markDirty();
            }}
            rows={2}
            placeholder="Resumo curto (opcional)"
            className="resize-y"
          />
        </Field>

        <Field label="Imagem de capa" hint="URL externa -- passa pelo proxy de imagem na Activity" counter={undefined}>
          <div className="flex gap-3 items-start">
            <Input
              value={coverImageUrl}
              onChange={(e) => {
                setCoverImageUrl(e.target.value);
                setCoverBroken(false);
                markDirty();
              }}
              type="url"
              placeholder="https://…"
              className="flex-1"
            />
            {coverImageUrl && !coverBroken && (
              <img
                src={resolveImageUrl(coverImageUrl)}
                alt="Prévia da capa"
                className="w-14 h-14 rounded-lg object-cover border border-buteco-amber/20 shrink-0"
                onError={() => setCoverBroken(true)}
              />
            )}
          </div>
          {coverImageUrl && coverBroken && (
            <Banner tone="error" className="mt-2">
              A imagem não carrega nessa URL. Confere o link -- ou publica assim mesmo (o leitor vê quebrado).
            </Banner>
          )}
        </Field>

        <Field label="Conteúdo">
          <MarkdownEditor value={bodyMarkdown} onChange={(next) => { setBodyMarkdown(next); markDirty(); }} />
        </Field>

        {error && <Banner tone="error">{error}</Banner>}

        {/* Sticky action bar: always reachable while the form scrolls,
            the delete sits away from the two usual buttons. */}
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-buteco-brown/95 border-t border-white/10 flex items-center gap-3">
          {isEditing && (
            <IconButton
              label="Apagar post"
              tone="danger"
              onClick={() => setConfirmingDelete(true)}
              className="border border-red-400/30 hover:border-red-400/60"
            >
              <Trash2 size={16} />
            </IconButton>
          )}
          <div className="ml-auto flex gap-3">
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => void submit("draft")}>
              Salvar rascunho
            </Button>
            <Button type="submit" loading={submitting}>
              Publicar
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmingImport}
        title="Trocar o que está no editor?"
        description="Importar substitui o título, o resumo, a capa e o conteúdo que estão preenchidos."
        confirmLabel="Importar e substituir"
        busy={importing}
        onConfirm={() => {
          setConfirmingImport(false);
          void handleImport();
        }}
        onCancel={() => setConfirmingImport(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Apagar este post?"
        description="O post sai do ar pra todo mundo. Não tem desfazer."
        confirmLabel="Apagar"
        danger
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingDelete(false)}
      />
      <ConfirmDialog
        open={confirmingLeave}
        title="Sair sem publicar?"
        description="Você alterou o post sem salvar. O rascunho automático do navegador guarda o que foi digitado, mas o servidor não."
        confirmLabel="Sair mesmo assim"
        danger
        onConfirm={() => {
          setConfirmingLeave(false);
          dirtyRef.current = false;
          blocker.proceed?.();
        }}
        onCancel={() => {
          setConfirmingLeave(false);
          blocker.reset?.();
        }}
      />
    </PageShell>
  );
}