import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PenLine, Rss } from "lucide-react";
import { api, type Post } from "../lib/api.js";
import PostCard from "../components/PostCard.js";
import { EmptyState, ErrorState, PageShell, Skeleton } from "../components/ui/index.js";

function loadPosts(): Promise<Post[]> {
  return api.listPosts().then((res) =>
    [...res.posts].sort(
      (a, b) => new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime(),
    ),
  );
}

export default function Home() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setError(null);
    setPosts(null);
    loadPosts()
      .then(setPosts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Não foi possível carregar os posts."));
  }

  useEffect(reload, []);

  return (
    <PageShell width="content">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-4xl mb-1 animate-fade-in-up">
            Posts <span className="text-gradient">recentes</span>
          </h1>
          <p className="text-buteco-cream/60 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
            Artigos e cursos publicados pela comunidade
          </p>
        </div>
        <a
          href={api.feedUrl}
          target="_blank"
          rel="noreferrer"
          title="Assinar por RSS"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-heading font-semibold text-buteco-cream/60 border border-white/10 hover:border-buteco-amber/40 hover:text-buteco-amber transition-colors animate-fade-in-up shrink-0"
          style={{ animationDelay: "80ms" }}
        >
          <Rss size={14} />
          RSS
        </a>
      </div>
      <div className="mb-10" />

      {error && <ErrorState title="Não foi possível carregar os posts" message={error} onRetry={reload} />}
      {posts === null && !error && (
        <div role="status" aria-label="Carregando posts" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="glass-card overflow-hidden p-0 h-64">
              <Skeleton className="h-full w-full rounded-none" />
            </div>
          ))}
        </div>
      )}
      {posts?.length === 0 && (
        <EmptyState
          icon={<PenLine size={22} />}
          title="Ainda não tem nada publicado"
          description="O primeiro artigo ou curso da comunidade começa aqui."
          action={
            <Link to="/posts/novo" className="text-sm font-heading font-semibold text-buteco-amber hover:text-buteco-amber-light transition-colors">
              Escrever o primeiro post
            </Link>
          }
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch">
        {posts?.map((p, i) => (
          // The most recent post spans two columns as the edition's
          // front page; everything else tiles 2-across / 3-across.
          <div key={p.id} className={i === 0 ? "sm:col-span-2" : undefined}>
            <PostCard post={p} animationDelay={`${120 + Math.min(i, 8) * 60}ms`} />
          </div>
        ))}
      </div>
    </PageShell>
  );
}