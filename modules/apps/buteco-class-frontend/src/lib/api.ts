import { request as httpRequest } from "./http.js";

const BASE_URL = import.meta.env.VITE_POST_API_URL as string;

export type Post = {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  bodyMarkdown: string;
  excerpt: string;
  coverImageUrl: string;
  type: "article" | "course";
  status: "draft" | "published";
  source: "native" | "imported";
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

// Thin shim over the shared http client with this API's contract:
// 202/204 envelopes are discarded (the command was accepted, that's
// all the caller cares about).
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return httpRequest<T>(BASE_URL, path, { ...init, voidStatuses: [202, 204] });
}

// Module-level for listPostsCached -- survives route remounts so
// re-entering the editor inside the TTL doesn't refetch.
let listCache: { at: number; posts: Post[] } | null = null;
let listInFlight: Promise<{ posts: Post[] }> | null = null;

export const api = {
  listPosts: () => request<{ posts: Post[] }>("/posts"),
  // 30s module cache + in-flight dedup. Only for the editor's prefill:
  // /posts/:slug returns published-only, so finding the author's own
  // draft needs the LIST -- re-fetching it per keystroke-free page
  // load is what this avoids. Editing flow survives a stale entry
  // (PATCH server-side is authoritative).
  listPostsCached: (maxAgeMs = 30_000): Promise<{ posts: Post[] }> => {
    if (listCache && Date.now() - listCache.at < maxAgeMs) return Promise.resolve({ posts: listCache.posts });
    if (!listInFlight) {
      listInFlight = request<{ posts: Post[] }>("/posts")
        .then((res) => {
          listCache = { at: Date.now(), posts: res.posts };
          return res;
        })
        .finally(() => {
          listInFlight = null;
        });
    }
    return listInFlight;
  },
  getPost: (slug: string) => request<Post>(`/posts/${encodeURIComponent(slug)}`),
  createPost: (input: {
    title: string;
    bodyMarkdown: string;
    excerpt?: string;
    coverImageUrl?: string;
    type?: "article" | "course";
    status?: "draft" | "published";
  }) => request<{ command_id: string; status: string }>("/posts", { method: "POST", body: JSON.stringify(input) }),
  updatePost: (
    id: string,
    input: { title?: string; bodyMarkdown?: string; excerpt?: string; coverImageUrl?: string; status?: string },
  ) =>
    request<{ command_id: string; status: string }>(`/posts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deletePost: (id: string) =>
    request<{ command_id: string; status: string }>(`/posts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  feedUrl: `${BASE_URL}/feed.xml`,
};
