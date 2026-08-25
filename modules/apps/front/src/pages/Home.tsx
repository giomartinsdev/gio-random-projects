import { useEffect, useState } from "react";
import { api, type Post } from "../lib/api.js";
import PostCard from "../components/PostCard.js";

export default function Home() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPosts()
      .then((res) => {
        const sorted = [...res.posts].sort(
          (a, b) => new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime(),
        );
        setPosts(sorted);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
          </svg>
          RSS
        </a>
      </div>
      <div className="mb-10" />

      {error && <p className="text-red-400">{error}</p>}
      {posts === null && !error && <p className="text-buteco-cream/60">Carregando…</p>}
      {posts?.length === 0 && <p className="text-buteco-cream/60">Ainda não tem nada publicado — seja o primeiro.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
        {posts?.map((p, i) => <PostCard key={p.id} post={p} animationDelay={`${120 + i * 60}ms`} />)}
      </div>
    </div>
  );
}
