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
      <h1 className="font-heading font-bold text-3xl text-buteco-amber mb-1">Posts recentes</h1>
      <p className="text-buteco-cream/60 mb-8">Artigos e cursos publicados pela comunidade</p>

      {error && <p className="text-red-400">{error}</p>}
      {posts === null && !error && <p className="text-buteco-cream/60">Carregando…</p>}
      {posts?.length === 0 && <p className="text-buteco-cream/60">Ainda não tem nada publicado — seja o primeiro.</p>}

      <div className="flex flex-col gap-4">{posts?.map((p) => <PostCard key={p.id} post={p} />)}</div>
    </div>
  );
}
