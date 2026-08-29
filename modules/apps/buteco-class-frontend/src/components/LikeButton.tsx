import { Heart } from "lucide-react";
import { useLike } from "../lib/useLike.js";
import { useSession } from "../lib/authClient.js";
import { cn } from "../lib/cn.js";

// Heart + count. interactive=true renders a real toggle (optimistic via
// useLike); without a session -- or with interactive=false -- it renders
// the same chip statically with the count the payload carried, no
// pointer affordances. On surfaces wrapped in a <Link> (PostCard) the
// click MUST preventDefault+stopPropagation so the card's navigation
// doesn't swallow it -- see the onClick below.
export default function LikeButton({
  post,
  interactive = true,
  className,
}: {
  post: Parameters<typeof useLike>[0];
  interactive?: boolean;
  className?: string;
}) {
  const { data: session } = useSession();
  const interactiveNow = interactive && Boolean(session);
  const { likeCount, likedByMe, toggle } = useLike(post);

  const visual = (
    <>
      <Heart size={16} fill={likedByMe ? "currentColor" : "none"} aria-hidden="true" />
      <span className="font-mono text-xs tabular-nums">{likeCount}</span>
      <span className="sr-only">{likedByMe ? "Você curtiu este post" : "Curtir este post"}</span>
    </>
  );

  if (!interactiveNow) {
    return (
      <span
        aria-label={likeCount === 1 ? "1 curtida" : `${likeCount} curtidas`}
        className={cn("inline-flex items-center gap-1.5 text-buteco-cream/50", className)}
      >
        {visual}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={likedByMe}
      aria-label={likedByMe ? "Remover curtida" : "Curtir"}
      onClick={(e) => {
        // The card is a react-router <Link>: a like click inside it must
        // not navigate (both events matter -- click bubbles and Link
        // follows the href on plain click).
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 cursor-pointer transition-colors",
        likedByMe ? "text-buteco-amber" : "text-buteco-cream/50 hover:text-buteco-amber",
        className,
      )}
    >
      {visual}
    </button>
  );
}