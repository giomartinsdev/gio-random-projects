import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { Post } from "../lib/api.js";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// animationDelay is applied to this same rounded/clipped element rather
// than an outer wrapper div -- nesting two independently-transformed
// (entrance animation + hover translate) rounded/overflow-hidden layers
// causes a visible hairline seam artifact in Chrome above/below the card.
export default function PostCard({ post, animationDelay }: { post: Post; animationDelay?: string }) {
  const style: CSSProperties | undefined = animationDelay ? { animationDelay } : undefined;

  return (
    <Link
      to={`/posts/${post.slug}`}
      style={style}
      className="group glass-card overflow-hidden animate-fade-in-up hover:bg-white/10 hover:border-buteco-amber/30 hover:-translate-y-0.5 transition-all"
    >
      {post.coverImageUrl && (
        <div className="h-40 overflow-hidden">
          <img
            src={post.coverImageUrl}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      )}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-2 font-mono text-xs text-buteco-amber/70">
          <span className="uppercase tracking-wide">{post.type === "course" ? "Curso" : "Artigo"}</span>
          {post.status === "draft" && (
            <span className="px-2 py-0.5 rounded bg-buteco-amber/20 text-buteco-amber">rascunho</span>
          )}
          <span>·</span>
          <span>{formatDate(post.publishedAt ?? post.createdAt)}</span>
        </div>
        <h3 className="font-heading font-semibold text-xl text-buteco-cream mb-2 group-hover:text-buteco-amber transition-colors">
          {post.title}
        </h3>
        {post.excerpt && <p className="text-buteco-cream/60 text-sm line-clamp-2">{post.excerpt}</p>}
      </div>
    </Link>
  );
}
