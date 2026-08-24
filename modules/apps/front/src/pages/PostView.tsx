import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api, type Post } from "../lib/api.js";
import { useSession } from "../lib/authClient.js";
import MarkdownContent from "../components/MarkdownContent.js";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function PostView() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const { data: session } = useSession();

  useEffect(() => {
    if (!slug) return;
    api
      .getPost(slug)
      .then(setPost)
      .catch(() => setPost(null));
  }, [slug]);

  if (post === undefined) return <p className="text-buteco-cream/60">Carregando…</p>;
  if (post === null) {
    return (
      <div className="text-center py-20">
        <p className="text-buteco-cream/60 mb-4">Esse post não existe (ou ainda não foi publicado).</p>
        <Link to="/" className="text-buteco-amber hover:underline">
          Voltar pro início
        </Link>
      </div>
    );
  }

  const isAuthor = session?.user.id === post.authorId;

  return (
    <article className="max-w-2xl mx-auto animate-fade-in-up">
      {post.coverImageUrl && (
        <div className="glass-card overflow-hidden mb-8 -mx-6 sm:mx-0">
          <img src={post.coverImageUrl} alt="" className="w-full max-h-96 object-cover" />
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center gap-2 font-mono text-xs text-buteco-amber/70">
          <span className="uppercase tracking-wide">{post.type === "course" ? "Curso" : "Artigo"}</span>
          <span>·</span>
          <span>{formatDate(post.publishedAt ?? post.createdAt)}</span>
        </div>
        <h1 className="font-heading font-bold text-4xl text-buteco-cream mt-3 mb-3 leading-tight">{post.title}</h1>
        {isAuthor && (
          <Link
            to={`/posts/${post.id}/editar`}
            className="inline-flex items-center gap-1 text-sm text-buteco-amber hover:text-buteco-amber-light hover:underline transition-colors"
          >
            ✏️ Editar este post
          </Link>
        )}
      </div>

      <MarkdownContent content={post.bodyMarkdown} />
    </article>
  );
}
