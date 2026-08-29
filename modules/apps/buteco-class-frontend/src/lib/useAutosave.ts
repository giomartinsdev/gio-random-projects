import { useEffect, useRef } from "react";

export type PostDraft = {
  title: string;
  bodyMarkdown: string;
  excerpt: string;
  coverImageUrl: string;
  type: "article" | "course";
};

export function postDraftKey(postId: string | null | undefined): string {
  return postId ? `buteco.draft.post.${postId}` : "buteco.draft.post.new";
}

// Null (not {}) when there's nothing usable: a partial/corrupt record
// would overwrite an in-progress form with undefineds.
export function loadPostDraft(key: string): (PostDraft & { savedAt: number }) | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.bodyMarkdown !== "string" && typeof parsed.title !== "string") return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      bodyMarkdown: typeof parsed.bodyMarkdown === "string" ? parsed.bodyMarkdown : "",
      excerpt: typeof parsed.excerpt === "string" ? parsed.excerpt : "",
      coverImageUrl: typeof parsed.coverImageUrl === "string" ? parsed.coverImageUrl : "",
      type: parsed.type === "course" ? "course" : "article",
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearPostDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best effort, like everything touching localStorage here.
  }
}

// Debounced localStorage autosave for the post editor. The first run
// (and the run right after re-enabling once the existing post arrives)
// is deliberately skipped: flushing a just-loaded form to storage
// would restore "empty" over a real draft or stamp savedAt with no
// edit behind it.
export function usePostDraftAutosave(
  key: string,
  value: PostDraft,
  options: { enabled?: boolean; delayMs?: number } = {},
): void {
  const { enabled = true, delayMs = 800 } = options;
  const firstRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      // Re-arm the skip: the load completing after this effect means
      // the next change to run is the prefill, not an edit.
      firstRef.current = true;
      return;
    }
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
      } catch {
        // Storage full/blocked -- autosave is best-effort.
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, enabled, delayMs]);
}