import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Post } from "../lib/api.js";
import { useSession } from "../lib/authClient.js";
import PostCard from "../components/PostCard.js";
import Button from "../components/Button.js";

// post-api's GET /posts only ever returns published posts (domain-api
// has no "list my drafts too" endpoint yet) -- this profile can only
// show this author's PUBLISHED posts, not drafts still in progress.
// Flagging in the UI rather than pretending drafts would show up here.
export default function Profile() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    if (!session) return;
    api.listPosts().then((res) => {
      setPosts(res.posts.filter((p) => p.authorId === session.user.id));
    });
  }, [session]);

  if (!session) return null;

  return (
    <div>
      <div className="glass-card glow-amber p-8 flex items-center justify-between mb-10 flex-wrap gap-4 animate-fade-in-up">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-buteco-amber/15 text-buteco-amber flex items-center justify-center font-heading font-bold text-2xl shrink-0">
            {session.user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="font-heading font-bold text-2xl text-buteco-cream">{session.user.name}</h1>
            <p className="text-buteco-cream/50 text-sm">{session.user.email}</p>
          </div>
        </div>
        <Link to="/posts/novo">
          <Button>+ Novo post</Button>
        </Link>
      </div>

      <h2 className="font-heading font-semibold text-xl text-buteco-cream mb-1">Seus posts publicados</h2>
      <p className="text-buteco-cream/50 text-sm mb-6">
        Rascunhos não aparecem aqui ainda — só o que já foi publicado.
      </p>

      {posts === null && <p className="text-buteco-cream/60">Carregando…</p>}
      {posts?.length === 0 && <p className="text-buteco-cream/60">Você ainda não publicou nada.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
        {posts?.map((p, i) => <PostCard key={p.id} post={p} animationDelay={`${i * 60}ms`} />)}
      </div>
    </div>
  );
}
