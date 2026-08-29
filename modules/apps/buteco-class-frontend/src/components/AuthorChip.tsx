import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type PublicUser } from "../lib/api.js";
import { resolveImageUrl } from "../lib/discordActivity.js";
import { cn } from "../lib/cn.js";

// Post payloads carry only author_id -- every chip needs one GET
// /users/:id, and a feed of a dozen cards would fire a dozen identical
// requests. Module-level promise cache survives route remounts (a
// profile page's own fetch warms the byline chips it links to) and
// doesn't expire: names/avatars only change on the next page load, and
// a failed read isn't cached so a later chip can retry.
const cache = new Map<string, Promise<PublicUser>>();

function fetchUser(id: string): Promise<PublicUser> {
  let p = cache.get(id);
  if (!p) {
    p = api
      .getUser(id)
      .then((res) => res.user)
      .catch((err) => {
        cache.delete(id); // don't pin a failure for the session
        throw err;
      });
    cache.set(id, p);
  }
  return p;
}

// Byline identity for a post: avatar (or initial), display name, whole
// chip links to the person's public profile.
export default function AuthorChip({ userId, className }: { userId: string; className?: string }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [brokenAvatar, setBrokenAvatar] = useState(false);

  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch(() => {
        /* chip stays on the fallback initial -- a profile read failing
           never breaks the post it sits in */
      });
  }, [userId]);

  const initial = (user?.name ?? "?").charAt(0).toUpperCase();

  return (
    <Link to={`/perfil/${userId}`} className={cn("inline-flex items-center gap-2 group/author w-fit", className)} title="Ver perfil">
      {user?.image && !brokenAvatar ? (
        <img
          src={resolveImageUrl(user.image)}
          alt=""
          loading="lazy"
          onError={() => setBrokenAvatar(true)}
          className="w-6 h-6 rounded-full object-cover shrink-0"
        />
      ) : (
        <span className="w-6 h-6 rounded-full bg-buteco-amber/15 text-buteco-amber grid place-items-center font-heading font-bold text-[0.7rem] shrink-0">
          {initial}
        </span>
      )}
      <span className="text-sm text-buteco-cream/60 group-hover/author:text-buteco-amber transition-colors">{user?.name ?? "…"}</span>
    </Link>
  );
}