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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listPosts: () => request<{ posts: Post[] }>("/posts"),
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
