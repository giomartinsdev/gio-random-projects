import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/app.js";
import { createAuth, type Auth } from "../../src/lib/auth.js";
import { createDomainApiClient } from "../../src/lib/domainApiClient.js";
import { startTestDb } from "../testDb.js";
import { startFakeDomainApi } from "../fakeDomainApi.js";

const DOMAIN_API_KEY = "test-domain-api-key";

let stopDb: () => Promise<void>;
let stopDomainApi: () => Promise<void>;
let auth: Auth;
let app: App;

// Engagement identifies people by Better Auth user id in the path, so
// signUp returns both the bearer header and the created user's id.
async function signUp(email: string, name = "Test Dev") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", name }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  const token = res.headers.get("set-auth-token");
  if (!token) throw new Error("sign-up did not return a bearer token");
  return { authHeader: `Bearer ${token}`, userId: body.user.id as string };
}

// A published post owned by the given (or a fresh) account.
async function publish(creator?: { authHeader: string }, givenTitle?: string): Promise<{ id: string; slug: string }> {
  const author = creator ?? (await signUp(`eng-author-${crypto.randomUUID()}@example.com`));
  const title = givenTitle ?? `Publicado engajado ${crypto.randomUUID()}`;
  await app.request("/posts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: author.authHeader },
    body: JSON.stringify({ title, bodyMarkdown: "conteudo", status: "published" }),
  });
  const list = await (await app.request("/posts")).json();
  const created = list.posts.find((p: { title: string }) => p.title === title) as { id: string; slug: string };
  return created;
}

// Like-state round-trips: { status, body } with body already parsed.
async function likeRequest(postId: string, authHeader?: string) {
  const res = await app.request(`/posts/${postId}/like`, {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
  return { status: res.status, body: (await res.json()) as { likeCount: number; likedByMe: boolean } };
}

async function unlikeRequest(postId: string, authHeader?: string) {
  const res = await app.request(`/posts/${postId}/like`, {
    method: "DELETE",
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
  return { status: res.status, body: (await res.json()) as { likeCount: number; likedByMe: boolean } };
}

beforeAll(async () => {
  const dbStarted = await startTestDb();
  stopDb = dbStarted.stop;
  auth = createAuth(dbStarted.db, "test-secret-do-not-use-in-production-min-32-chars");

  const fakeDomainApi = startFakeDomainApi(DOMAIN_API_KEY);
  stopDomainApi = fakeDomainApi.stop;
  const domainApi = createDomainApiClient(fakeDomainApi.url, DOMAIN_API_KEY);

  app = createApp(auth, domainApi, ["http://localhost:5173"], dbStarted.db);
}, 60_000);

afterAll(async () => {
  await stopDb();
  await stopDomainApi();
});

describe("likes", () => {
  it("likes idempotently, counts publicly, unlikes", async () => {
    const author = await signUp("eng-lifecycle-author@example.com");
    const fan = await signUp("eng-lifecycle-fan@example.com");
    const post = await publish(author);

    const first = await likeRequest(post.id, fan.authHeader);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ likeCount: 1, likedByMe: true });

    // Re-liking the same post must not double-count.
    const again = await likeRequest(post.id, fan.authHeader);
    expect(again.body).toEqual({ likeCount: 1, likedByMe: true });

    const third = await signUp("eng-lifecycle-third@example.com");
    expect((await likeRequest(post.id, third.authHeader)).body).toEqual({ likeCount: 2, likedByMe: true });

    const unlike = await unlikeRequest(post.id, fan.authHeader);
    expect(unlike.status).toBe(200);
    expect(unlike.body).toEqual({ likeCount: 1, likedByMe: false });

    // Unlike is tolerant: repeated or on a never-liked post.
    const unlikeAgain = await unlikeRequest(post.id, third.authHeader);
    expect(unlikeAgain.status).toBe(200);
    expect(unlikeAgain.body).toEqual({ likeCount: 0, likedByMe: false });
  });

  it("rejects likes without a bearer token (negative)", async () => {
    const res = await app.request("/posts/00000000-0000-0000-0000-000000000000/like", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with zero count when unliking a post id domain-api does not know (edge)", async () => {
    const fan = await signUp("eng-unlike-unknown@example.com");
    const res = await unlikeRequest("00000000-0000-0000-0000-000000000000", fan.authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ likeCount: 0, likedByMe: false });
  });

  it("enriches the published list and the by-slug read with likeCount/likedByMe for the viewer (positive)", async () => {
    const fan = await signUp("eng-read-fan@example.com");
    const other = await signUp("eng-read-other@example.com");
    const post = await publish();

    await likeRequest(post.id, fan.authHeader);

    const enriched = await app.request("/posts", { headers: { authorization: fan.authHeader } });
    const row = (await enriched.json()).posts.find((p: { id: string }) => p.id === post.id);
    expect(row.likeCount).toBe(1);
    expect(row.likedByMe).toBe(true);

    const anonList = await (await app.request("/posts")).json();
    const anonRow = anonList.posts.find((p: { id: string }) => p.id === post.id);
    expect(anonRow.likeCount).toBe(1);
    expect(anonRow.likedByMe).toBe(false);

    // GET /posts/:slug returns the post object itself, not a wrapper.
    const single = (await (await app.request(`/posts/${post.slug}`)).json()) as { likedByMe: boolean };
    expect(single.likedByMe).toBe(false);

    const fanSingle = (await (
      await app.request(`/posts/${post.slug}`, { headers: { authorization: fan.authHeader } })
    ).json()) as { likedByMe: boolean };
    expect(fanSingle.likedByMe).toBe(true);
  });
});

describe("GET /posts/liked/by-me", () => {
  it("lists liked posts newest-like first and drops unliked entries from the public timeline", async () => {
    const fan = await signUp("eng-liked-me@example.com");
    const first = await publish();
    const second = await publish();

    await likeRequest(first.id, fan.authHeader);
    await likeRequest(second.id, fan.authHeader);

    const liked = await app.request("/posts/liked/by-me", { headers: { authorization: fan.authHeader } });
    expect(liked.status).toBe(200);
    expect((await liked.json()).posts.map((p: { id: string }) => p.id)).toEqual([second.id, first.id]);

    await app.request(`/posts/${second.id}/like`, { method: "DELETE", headers: { authorization: fan.authHeader } });
    const afterUnlike = await app.request("/posts/liked/by-me", { headers: { authorization: fan.authHeader } });
    expect((await afterUnlike.json()).posts.map((p: { id: string }) => p.id)).toEqual([first.id]);
  });

  it("is 401 without a session (negative)", async () => {
    const res = await app.request("/posts/liked/by-me");
    expect(res.status).toBe(401);
  });
});

describe("GET /users/:id + POST /users/:id/view", () => {
  it("serves the public identity without email and counts one row per viewer", async () => {
    const owner = await signUp("eng-profile-owner@example.com", "Vis Alvo");
    const visitor = await signUp("eng-profile-visitor@example.com");
    const fresh = await publish(owner);

    expect(fresh.id).toBeTruthy(); // sanity: the owner actually published

    const get = await app.request(`/users/${owner.userId}`);
    expect(get.status).toBe(200);
    const profile = await get.json();
    expect(profile.user).toEqual({ id: owner.userId, name: "Vis Alvo", image: null, createdAt: expect.any(String) });
    expect(Object.keys(profile.user)).not.toContain("email");
    expect(profile.viewCount).toBe(0);

    const view = await app.request(`/users/${owner.userId}/view`, {
      method: "POST",
      headers: { authorization: visitor.authHeader },
    });
    expect(view.status).toBe(200);
    expect(await view.json()).toEqual({ viewCount: 1, counted: true });

    // Repeat visit from the same viewer: still exactly one row.
    const viewAgain = await app.request(`/users/${owner.userId}/view`, {
      method: "POST",
      headers: { authorization: visitor.authHeader },
    });
    expect(await viewAgain.json()).toEqual({ viewCount: 1, counted: true });

    const secondVisitor = await signUp("eng-profile-second@example.com");
    await app.request(`/users/${owner.userId}/view`, {
      method: "POST",
      headers: { authorization: secondVisitor.authHeader },
    });

    // The owner visiting their own profile is never recorded.
    const self = await app.request(`/users/${owner.userId}/view`, {
      method: "POST",
      headers: { authorization: owner.authHeader },
    });
    expect(await self.json()).toEqual({ viewCount: 2, counted: false });

    const final = await (await app.request(`/users/${owner.userId}`)).json();
    expect(final.viewCount).toBe(2);
  });

  it("401s an anonymous view and 404s unknown ids (negative)", async () => {
    const anonView = await app.request("/users/someone/view", { method: "POST" });
    expect(anonView.status).toBe(401);

    const unknownGet = await app.request("/users/00000000-0000-0000-0000-000000000000");
    expect(unknownGet.status).toBe(404);

    const known = await signUp("eng-profile-known@example.com");
    const unknownView = await app.request("/users/00000000-0000-0000-0000-000000000000/view", {
      method: "POST",
      headers: { authorization: known.authHeader },
    });
    expect(unknownView.status).toBe(404);
  });
});