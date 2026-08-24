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
      <h1 className="font-heading font-bold text-4xl mb-1 animate-fade-in-up">
        Posts <span className="text-gradient">recentes</span>
      </h1>
      <p className="text-buteco-cream/60 mb-10 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
        Artigos e cursos publicados pela comunidade
      </p>

      {error && <p className="text-red-400">{error}</p>}
      {posts === null && !error && <p className="text-buteco-cream/60">Carregando…</p>}
      {posts?.length === 0 && <p className="text-buteco-cream/60">Ainda não tem nada publicado — seja o primeiro.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
        {posts?.map((p, i) => <PostCard key={p.id} post={p} animationDelay={`${120 + i * 60}ms`} />)}
      </div>
    </div>
  );
}
