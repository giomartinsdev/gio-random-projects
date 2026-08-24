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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-3xl text-buteco-amber">{session.user.name}</h1>
          <p className="text-buteco-cream/60">{session.user.email}</p>
        </div>
        <Link to="/posts/novo">
          <Button>Novo post</Button>
        </Link>
      </div>

      <h2 className="font-heading font-semibold text-xl text-buteco-cream mb-4">Seus posts publicados</h2>
      <p className="text-buteco-cream/50 text-sm mb-4">
        Rascunhos não aparecem aqui ainda — só o que já foi publicado.
      </p>

      {posts === null && <p className="text-buteco-cream/60">Carregando…</p>}
      {posts?.length === 0 && <p className="text-buteco-cream/60">Você ainda não publicou nada.</p>}

      <div className="flex flex-col gap-4">{posts?.map((p) => <PostCard key={p.id} post={p} />)}</div>
    </div>
  );
}
