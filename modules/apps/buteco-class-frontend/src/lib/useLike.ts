import { useEffect, useRef, useState } from "react";
import { api, type Post } from "./api.js";
import { useSession } from "./authClient.js";

export type LikeInit = Pick<Post, "id" | "likeCount" | "likedByMe">;

// One like button's state. Optimistic: the click flips the local state
// immediately; on server error we revert to the last known server
// values. Clicks while a write is in flight are coalesced away (the
// write is fast; a like button that queues state deltas needs real
// contention before that complexity pays for itself).
//
// Server values are adopted ONLY on mount / post-id change -- a parent
// refetch mid-flight clobbering an in-flight optimistic flip is the
// trade-off, and no parent here refetches a list the user is actively
// clicking inside.
export function useLike(post: LikeInit) {
  const { data: session } = useSession();
  const [init] = useState(post); // bound to the first mount's payload
  const [state, setState] = useState({ likeCount: init.likeCount ?? 0, likedByMe: init.likedByMe === true });
  // Last confirmed server state -- the revert anchor.
  const [server, setServer] = useState(state);
  const inFlight = useRef(false);

  // Changing posts is the one mutation that must re-bind: callers key
  // their like row by post id where it can happen, this catches the rest.
  const lastId = useRef(post.id);
  useEffect(() => {
    if (lastId.current === post.id) return;
    lastId.current = post.id;
    if (inFlight.current) return;
    setState({ likeCount: post.likeCount ?? 0, likedByMe: post.likedByMe === true });
    setServer({ likeCount: post.likeCount ?? 0, likedByMe: post.likedByMe === true });
  }, [post.id, post.likeCount, post.likedByMe]);

  // No-op without a session: the button renders static in that case and
  // never calls this, the guard is just a second line of defense.
  async function toggle() {
    if (!session || inFlight.current) return;
    const next = { likeCount: state.likedByMe ? state.likeCount - 1 : state.likeCount + 1, likedByMe: !state.likedByMe };
    setState(next);
    inFlight.current = true;
    try {
      const res = state.likedByMe ? await api.unlikePost(post.id) : await api.likePost(post.id);
      const confirmed = { likeCount: res.likeCount ?? next.likeCount, likedByMe: res.likedByMe === true };
      setServer(confirmed);
      setState(confirmed);
    } catch {
      setState(server);
    } finally {
      inFlight.current = false;
    }
  }

  return { ...state, toggle };
}