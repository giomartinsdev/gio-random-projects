import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Eye, GraduationCap, Heart, History, MonitorPlay, PencilLine } from "lucide-react";
import { api, type Post, type ProfileData } from "../lib/api.js";
import { useSession } from "../lib/authClient.js";
import { classroomApi, type Room } from "../lib/classroomApi.js";
import PostCard from "../components/PostCard.js";
import { resolveImageUrl } from "../lib/discordActivity.js";
import {
  Badge,
  EmptyState,
  PageShell,
  Skeleton,
  Tabs,
  buttonClasses,
  type TabDef,
} from "../components/ui/index.js";

function publishedSort(a: Post, b: Post): number {
  const da = new Date(a.publishedAt ?? a.createdAt).getTime();
  const db = new Date(b.publishedAt ?? b.createdAt).getTime();
  return db - da;
}

// One page, two modes: /perfil (own, ProtectedRoute-guarded) and
// /perfil/:id (public, anyone). The target id decides -- someone can
// land on their own id's URL too and get the exact same page.
export default function Profile() {
  const { id: routeId } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const targetId = routeId ?? session?.user.id ?? null;
  const isOwn = Boolean(session && targetId && session.user.id === targetId);

  const [profile, setProfile] = useState<ProfileData | null | undefined>(undefined); // undefined = loading
  const [profileMissing, setProfileMissing] = useState(false);

  // Own identity renders from the session the moment it's there; the
  // explicit fetch only brings viewCount (and confirms the id exists).
  // Public mode has no session shortcut -- always the fetch.
  useEffect(() => {
    if (!targetId) return;
    setProfile(undefined);
    setProfileMissing(false);
    api
      .getUser(targetId)
      .then(setProfile)
      .catch(() => setProfileMissing(true));
  }, [targetId]);

  // A logged-in visitor opening someone else's profile registers the
  // view (post-api counts one row per viewer). Fire-and-forget; the ack
  // viewCount is fresher than the one the GET returned before.
  useEffect(() => {
    if (!session?.user || !targetId || isOwn) return;
    api
      .viewProfile(targetId)
      .then((ack) => setProfile((p) => (p ? { ...p, viewCount: ack.viewCount } : p)))
      .catch(() => {});
  }, [session?.user, targetId, isOwn]);

  if (profileMissing) {
    return (
      <PageShell width="content">
        <EmptyState
          title="Perfil não encontrado"
          description="Essa pessoa não existe (ou saiu da comunidade)."
          action={
            <Link to="/" className="text-buteco-amber hover:underline text-sm">
              Voltar pro início
            </Link>
          }
        />
      </PageShell>
    );
  }

  const displayName = isOwn ? session?.user.name : profile?.user.name;
  const image = isOwn ? session?.user.image : profile?.user.image;
  const viewCount = profile?.viewCount ?? 0; // 0 while loading; the public header shows nothing until then

  return (
    <PageShell width="content">
      {/* Header */}
      {profile === undefined && !isOwn ? (
        <div className="glass-card p-8 flex items-center gap-4 mb-8 animate-fade-in-up" role="status" aria-label="Carregando perfil">
          <div className="w-14 h-14 rounded-full bg-white/5 shrink-0" />
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-white/10" />
            <div className="h-3 w-24 rounded bg-white/5" />
          </div>
        </div>
      ) : (
        <header className="glass-card glow-amber p-8 flex items-center justify-between mb-10 flex-wrap gap-4 animate-fade-in-up">
          <div className="flex items-center gap-4 min-w-0">
            {image ? (
              <img
                src={resolveImageUrl(image)}
                alt=""
                className="w-14 h-14 rounded-full object-cover shrink-0"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-buteco-amber/15 text-buteco-amber flex items-center justify-center font-heading font-bold text-2xl shrink-0">
                {(displayName ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-heading font-bold text-2xl text-buteco-cream truncate">{displayName ?? "…"}</h1>
              {isOwn && <p className="text-buteco-cream/50 text-sm truncate">{session?.user.email}</p>}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <Badge tone="neutral" title={`Visitantes logados distintos — visitas anônimas não são contadas${isOwn ? "" : " e as suas próprias não entram"}`}>
                  <span className="inline-flex items-center gap-1">
                    <Eye size={12} aria-hidden="true" />
                    {viewLabel(viewCount, isOwn)}
                  </span>
                </Badge>
                <span className="text-xs text-buteco-cream/40">
                  {memberSinceLabel(profile) ? `membro desde ${memberSinceLabel(profile)}` : ""}
                </span>
              </div>
            </div>
          </div>
          {isOwn && (
            <Link to="/posts/novo" className={buttonClasses()}>
              + Novo post
            </Link>
          )}
        </header>
      )}

      <ProfileTabs targetId={targetId} isOwn={isOwn} />
    </PageShell>
  );
}

function viewLabel(count: number, own: boolean): string {
  const whose = own ? "seu perfil" : "este perfil";
  return count === 1 ? `1 pessoa viu ${whose}` : `${count} pessoas viram ${whose}`;
}

function memberSinceLabel(profile: ProfileData | null | undefined): string | null {
  if (!profile) return null;
  return new Date(profile.user.createdAt).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

// Tabs + the three lists, split out so the header's identity/loading
// lifecycle stays readable.
type OwnTab = "posts" | "curtidas" | "aulas";
function ProfileTabs({ targetId, isOwn }: { targetId: string | null; isOwn: boolean }) {
  const [active, setActive] = useState<OwnTab>("posts");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [liked, setLiked] = useState<Post[] | null>(null);
  const [likedError, setLikedError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomsBlocked, setRoomsBlocked] = useState(false);

  const { data: session } = useSession();

  useEffect(() => {
    if (!targetId) return;
    api
      .listPosts()
      .then((res) => setPosts(res.posts.filter((p) => p.authorId === targetId).sort(publishedSort)))
      .catch(() => setPosts([]));
  }, [targetId]);

  // Own-only tab, fetched the first time it's opened.
  useEffect(() => {
    if (!isOwn || active !== "curtidas" || liked !== null) return;
    api
      .listLikedPosts()
      .then((res) => setLiked(res.posts))
      .catch(() => setLikedError("Não foi possível carregar suas curtidas."));
  }, [isOwn, active, liked]);

  const [roomsFetched, setRoomsFetched] = useState(false);
  useEffect(() => {
    if (!targetId || active !== "aulas" || roomsFetched) return;
    if (!isOwn && !session) {
      // listRooms is session-only (401 anonymous) -- don't fire a
      // request destined to fail, the tab says what's true instead.
      setRoomsBlocked(true);
      return;
    }
    setRoomsFetched(true);
    classroomApi
      .listRooms()
      .then((res) => setRooms(res.rooms.filter((r) => r.hostId === targetId)))
      .catch(() => setRoomsBlocked(true));
  }, [targetId, active, roomsFetched, isOwn, session]);

  if (!targetId) return null;

  const tabs: TabDef<OwnTab>[] = isOwn
    ? [
        { id: "posts", label: "Posts", count: posts?.length ?? 0 },
        { id: "curtidas", label: "Curtidas", count: liked?.length ?? 0 },
        { id: "aulas", label: "Aulas", count: rooms?.length ?? 0 },
      ]
    : [
        { id: "posts", label: "Posts", count: posts?.length ?? 0 },
        { id: "aulas", label: "Aulas", count: rooms?.length ?? 0 },
      ];

  return (
    <section>
      {isOwn && (
        <p className="text-buteco-cream/50 text-sm mb-5">
          Rascunhos não aparecem aqui ainda — só o que já foi publicado.
        </p>
      )}

      <Tabs label="Seções do perfil" tabs={tabs} active={active} onChange={setActive} className="mb-6" />

      {active === "posts" && (
        <div>
          {posts === null ? (
            <div role="status" aria-label="Carregando posts" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-44 rounded-2xl" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              icon={<PencilLine size={20} />}
              title={isOwn ? "Você ainda não publicou nada" : "Nada publicado ainda"}
              description={isOwn ? "Escreva o primeiro post da sua jornada aqui." : "Quando essa pessoa publicar algo, aparece aqui."}
              action={
                isOwn ? (
                  <Link to="/posts/novo" className={buttonClasses({ variant: "secondary" })}>
                    + Novo post
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
              {posts.map((p, i) => (
                <PostCard key={p.id} post={p} animationDelay={`${i * 60}ms`} />
              ))}
            </div>
          )}
        </div>
      )}

      {active === "curtidas" && isOwn && (
        <div>
          {likedError ? (
            <p className="text-buteco-cream/60 text-sm py-8 text-center">{likedError}</p>
          ) : liked === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : liked.length === 0 ? (
            <EmptyState
              icon={<Heart size={20} />}
              title="Nenhuma curtida ainda"
              description="Os posts que você curtir aparecem aqui."
              action={
                <Link to="/" className={buttonClasses({ variant: "secondary" })}>
                  Explorar posts
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
              {liked.map((p, i) => (
                <PostCard key={p.id} post={p} animationDelay={`${i * 60}ms`} />
              ))}
            </div>
          )}
        </div>
      )}

      {active === "aulas" && (
        <div>
          {roomsBlocked ? (
            <EmptyState
              icon={<GraduationCap size={20} />}
              title={isOwn ? "Não deu pra listar as aulas" : "Só para quem está logado"}
              description={
                isOwn
                  ? "Tente recarregar a página."
                  : "As aulas que essa pessoa hospedou ficam visíveis para quem entra com a conta."
              }
              action={
                !isOwn && !session ? (
                  <Link to="/login" className={buttonClasses({ variant: "secondary" })}>
                    Entrar
                  </Link>
                ) : undefined
              }
            />
          ) : rooms === null ? (
            <div role="status" aria-label="Carregando aulas" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState
              icon={<MonitorPlay size={20} />}
              title={isOwn ? "Você ainda não hospedou aulas" : "Nenhuma aula hospedada (ainda)"}
              description={
                isOwn
                  ? "Abra uma sala na aba Aulas e ela aparece aqui."
                  : "As aulas ao vivo que essa pessoa abrir aparecem aqui."
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {rooms.map((r) => {
                const closed = r.status === "closed";
                return (
                  <Link
                    key={r.id}
                    to={`/aulas/${r.id}`}
                    className={`group glass-card shadow-card p-5 hover:-translate-y-0.5 transition-all ${
                      closed ? "opacity-60 hover:border-white/20" : "hover:border-buteco-amber/30"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <Badge tone={closed ? "muted" : "live"}>{closed ? "Encerrada" : "Ao vivo"}</Badge>
                      <span className="font-mono text-xs text-buteco-cream/40">
                        {new Date(r.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <h3 className="font-heading font-semibold text-lg group-hover:text-buteco-amber transition-colors truncate">
                      {r.title}
                    </h3>
                    <p className="text-buteco-cream/50 text-xs mt-1 flex items-center gap-1.5">
                      {closed ? (
                        <>
                          <History size={13} aria-hidden="true" /> leitura do histórico
                        </>
                      ) : (
                        <>
                          <MonitorPlay size={13} aria-hidden="true" /> transmitindo agora
                        </>
                      )}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}