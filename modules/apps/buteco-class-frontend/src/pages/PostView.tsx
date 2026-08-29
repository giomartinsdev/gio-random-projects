import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { ArrowLeft, PencilLine } from "lucide-react";
import { api, type Post } from "../lib/api.js";
import { useSession } from "../lib/authClient.js";
import MarkdownContent from "../components/MarkdownContent.js";
import { resolveImageUrl } from "../lib/discordActivity.js";
import { EmptyState, PageShell, Badge, Skeleton } from "../components/ui/index.js";
import { readingTimeLabel } from "../lib/readingTime.js";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function PostView() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const { data: session } = useSession();

  useEffect(() => {
    if (!slug) return;
    api
      .getPost(slug)
      .then(setPost)
      .catch(() => setPost(null));
  }, [slug]);

  if (post === undefined) {
    return (
      <PageShell width="prose">
        <div role="status" aria-label="Carregando post" className="flex flex-col gap-4 animate-fade-in-up">
          <Skeleton className="aspect-[16/9] rounded-2xl" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-4 w-40" />
          <div className="mt-6 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (post === null) {
    return (
      <PageShell width="content">
        <EmptyState
          title="Esse post não existe"
          description="Ou ainda não foi publicado -- rascunhos só são visíveis pra quem escreve."
          action={
            <Link to="/" className="text-buteco-amber hover:underline text-sm">
              Voltar pro início
            </Link>
          }
        />
      </PageShell>
    );
  }

  const isAuthor = session?.user.id === post.authorId;

  return (
    <article className="animate-fade-in-up">
      <PageShell width="prose">
        {/* A cover the proxy can't serve disappears instead of rendering
            the broken-image glyph. Keyed by URL so a later-good cover
            self-heals when navigating between posts. */}
        {post.coverImageUrl && brokenSrc !== post.coverImageUrl && (
          <div className="glass-card overflow-hidden mb-8">
            <img
              src={resolveImageUrl(post.coverImageUrl)}
              alt=""
              onError={() => setBrokenSrc(post.coverImageUrl ?? null)}
              className="w-full aspect-[16/9] object-cover"
            />
          </div>
        )}

        <div className="mb-10">
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            <Badge tone="amber">{post.type === "course" ? "Curso" : "Artigo"}</Badge>
            <span className="font-mono text-xs text-buteco-cream/50">
              {formatDate(post.publishedAt ?? post.createdAt)} · {readingTimeLabel(post.bodyMarkdown)}
            </span>
          </div>
          <h1 className="font-heading font-bold text-4xl text-buteco-cream leading-tight mb-3">{post.title}</h1>
          {isAuthor && (
            <Link
              to={`/posts/${post.id}/editar`}
              className="inline-flex items-center gap-1.5 text-sm text-buteco-cream/60 hover:text-buteco-amber transition-colors"
            >
              <PencilLine size={14} />
              Editar este post
            </Link>
          )}
        </div>

        <MarkdownContent content={post.bodyMarkdown} />

        <div className="mt-12 pt-6 border-t border-white/5">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-buteco-cream/50 hover:text-buteco-amber transition-colors">
            <ArrowLeft size={14} />
            Início
          </Link>
        </div>
      </PageShell>
    </article>
  );
}