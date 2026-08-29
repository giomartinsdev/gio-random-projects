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
  // Engagement fields post-api adds to every read. Optional in the type
  // because a pre-deploy cached payload (or the editor's listPostsCached
  // TTL window) can legitimately lack them -- read with `?? 0` / `=== true`.
  likeCount?: number;
  likedByMe?: boolean;
};

// Public profile identity from GET /users/:id -- the API never returns
// email here, keep it that way in the client shape too.
export type PublicUser = {
  id: string;
  name: string;
  image: string | null;
  createdAt: string;
};

export type ProfileData = {
  user: PublicUser;
  // Distinct logged-in visitors; anonymous visits are not counted.
  viewCount: number;
};

export type LikeState = { likeCount: number; likedByMe: boolean };

export type ViewAck = { viewCount: number; counted: boolean };

// Draft material from POST /posts/import -- NOT a persisted post; the
// author reviews it in the editor and publishes through createPost.
// bodyMarkdown already ends with the "Retirado daqui do …" footer.
export type ImportedPost = {
  provider: "dev.to" | "tabnews" | "medium";
  title: string;
  bodyMarkdown: string;
  excerpt?: string;
  coverImageUrl?: string;
  originalUrl: string;
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
  // Server-side substring search (title/excerpt/body) over published
  // posts; the server escapes wildcards, the UI passes the text raw.
  searchPosts: (q: string) =>
    request<{ posts: Post[] }>(`/posts?q=${encodeURIComponent(q)}`),
  // One author's posts for profile pages. The server includes your
  // drafts when the calling session is the same author and filters
  // them out for everyone else -- nobody else ever sees a draft here.
  listByAuthor: (id: string) =>
    request<{ posts: Post[] }>(`/posts/by-author/${encodeURIComponent(id)}`),
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
  // Server-side fetch of a Medium/dev.to/TabNews link, normalized to
  // markdown. 400 on unsupported sites, 502 when the source failed.
  importPost: (url: string) =>
    request<ImportedPost>("/posts/import", { method: "POST", body: JSON.stringify({ url }) }),
  // Upload a post image (cover or inline). Straight to httpRequest with
  // json:false -- multipart must set its own boundary. The server stores
  // the bytes in MinIO and the returned public URL is what the post
  // references.
  uploadImage: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return httpRequest<{ url: string }>(BASE_URL, "/images/upload", { method: "POST", body: form, json: false, voidStatuses: [202, 204] });
  },
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
  likePost: (id: string) =>
    request<LikeState>(`/posts/${encodeURIComponent(id)}/like`, { method: "POST" }),
  // Unlike is tolerant server-side (200 even if never liked / post gone)
  // -- callers can treat any 200 here as settled.
  unlikePost: (id: string) =>
    request<LikeState>(`/posts/${encodeURIComponent(id)}/like`, { method: "DELETE" }),
  // Liked published posts, newest like first. 401 without a session.
  listLikedPosts: () => request<{ posts: Post[] }>("/posts/liked/by-me"),
  // Public identity + view count (never includes email).
  getUser: (id: string) => request<ProfileData>(`/users/${encodeURIComponent(id)}`),
  // Registers this viewer's visit (fire-and-forget for callers); only
  // counted with a session, self-views come back counted:false.
  viewProfile: (id: string) =>
    request<ViewAck>(`/users/${encodeURIComponent(id)}/view`, { method: "POST" }),
  feedUrl: `${BASE_URL}/feed.xml`,
};
