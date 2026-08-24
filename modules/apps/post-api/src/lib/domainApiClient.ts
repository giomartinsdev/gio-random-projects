// post-api owns no post storage of its own -- it's a thin
// logic+auth layer in front of domain-api/domain-worker's existing
// CQRS pipeline. Reads hit domain-api directly (synchronous, backed
// by Postgres); writes publish a command and come back 202 Accepted,
// applied asynchronously by domain-worker -- same contract any other
// caller of domain-api gets, nothing post-api-specific about it.
export type DomainPost = {
  id: string;
  author_id: string;
  title: string;
  slug: string;
  body_markdown: string;
  excerpt: string;
  cover_image_url: string;
  type: "article" | "course";
  status: "draft" | "published";
  source: "native" | "imported";
  source_url: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type Accepted = { command_id: string; status: "accepted" };

export class DomainApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainApiError {
  constructor() {
    super(404, "not found");
  }
}

export function createDomainApiClient(baseUrl: string, apiKey: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, "content-type": "application/json", "x-api-key": apiKey },
    });
    if (res.status === 404) throw new NotFoundError();
    if (!res.ok) {
      const body = await res.text();
      throw new DomainApiError(res.status, `domain-api ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    listPublished: () => request<{ posts: DomainPost[] }>("/posts"),
    getBySlug: (slug: string) => request<DomainPost>(`/posts/slug/${encodeURIComponent(slug)}`),
    getById: (id: string) => request<DomainPost>(`/posts/id/${encodeURIComponent(id)}`),
    create: (input: {
      author_id: string;
      title: string;
      body_markdown: string;
      excerpt?: string;
      cover_image_url?: string;
      type?: string;
      status?: string;
    }) => request<Accepted>("/posts", { method: "POST", body: JSON.stringify(input) }),
    update: (
      id: string,
      input: {
        author_id: string;
        title?: string;
        body_markdown?: string;
        excerpt?: string;
        cover_image_url?: string;
        status?: string;
      },
    ) => request<Accepted>(`/posts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    remove: (id: string, authorId: string) =>
      request<Accepted>(`/posts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ author_id: authorId }),
      }),
  };
}

export type DomainApiClient = ReturnType<typeof createDomainApiClient>;
