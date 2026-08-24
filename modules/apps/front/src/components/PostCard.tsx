import { Link } from "react-router";
import type { Post } from "../lib/api.js";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PostCard({ post }: { post: Post }) {
  return (
    <Link
      to={`/posts/${post.slug}`}
      className="block bg-buteco-brown-light/40 border border-buteco-amber/10 rounded-xl p-6 hover:border-buteco-amber/40 transition-colors"
    >
      <div className="flex items-center gap-2 mb-2 font-mono text-xs text-buteco-amber/70">
        <span className="uppercase tracking-wide">{post.type === "course" ? "Curso" : "Artigo"}</span>
        {post.status === "draft" && (
          <span className="px-2 py-0.5 rounded bg-buteco-amber/20 text-buteco-amber">rascunho</span>
        )}
        <span>·</span>
        <span>{formatDate(post.publishedAt ?? post.createdAt)}</span>
      </div>
      <h3 className="font-heading font-semibold text-xl text-buteco-cream mb-2">{post.title}</h3>
      {post.excerpt && <p className="text-buteco-cream/70 text-sm line-clamp-2">{post.excerpt}</p>}
    </Link>
  );
}
