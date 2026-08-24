import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import ReactMarkdown from "react-markdown";
import { api, type Post } from "../lib/api.js";
import { useSession } from "../lib/authClient.js";

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
    <article>
      <div className="mb-6">
        <span className="font-mono text-xs uppercase tracking-wide text-buteco-amber/70">
          {post.type === "course" ? "Curso" : "Artigo"}
        </span>
        <h1 className="font-heading font-bold text-4xl text-buteco-cream mt-2 mb-3">{post.title}</h1>
        {isAuthor && (
          <Link
            to={`/posts/${post.id}/editar`}
            className="inline-block text-sm text-buteco-amber hover:underline"
          >
            Editar este post
          </Link>
        )}
      </div>
      <div className="prose prose-invert prose-amber max-w-none font-body text-buteco-cream/90">
        <ReactMarkdown>{post.bodyMarkdown}</ReactMarkdown>
      </div>
    </article>
  );
}
