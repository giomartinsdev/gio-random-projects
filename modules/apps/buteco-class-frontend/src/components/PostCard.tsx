import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { Post } from "../lib/api.js";
import { resolveImageUrl } from "../lib/discordActivity.js";
import { readingTimeLabel } from "../lib/readingTime.js";
import { Badge } from "./ui/index.js";

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
  const date = formatDate(post.publishedAt ?? post.createdAt);

  return (
    <Link
      to={`/posts/${post.slug}`}
      style={style}
      className="group glass-card overflow-hidden shadow-card animate-fade-in-up hover:bg-white/10 hover:border-buteco-amber/30 hover:-translate-y-0.5 transition-all"
    >
      {post.coverImageUrl && (
        <div className="aspect-[16/10] overflow-hidden">
          <img
            src={resolveImageUrl(post.coverImageUrl)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      )}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <Badge tone="amber">{post.type === "course" ? "Curso" : "Artigo"}</Badge>
          {post.status === "draft" && <Badge tone="neutral">Rascunho</Badge>}
          <span className="font-mono text-xs text-buteco-cream/50">
            {date} · {readingTimeLabel(post.bodyMarkdown)}
          </span>
        </div>
        <h3 className="font-heading font-semibold text-xl text-buteco-cream mb-2 group-hover:text-buteco-amber transition-colors">
          {post.title}
        </h3>
        {post.excerpt && <p className="text-buteco-cream/60 text-sm line-clamp-3">{post.excerpt}</p>}
      </div>
    </Link>
  );
}