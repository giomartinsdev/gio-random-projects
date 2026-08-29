import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { postLikes, profileViews, user } from "../db/schema.js";

// All engagement persistence (see schema.ts for why this lives in
// post-api's own Postgres instead of domain-api's CQRS pipeline).
// Likes are synchronous by necessity: the client toggles a heart and
// needs the new count in the same response.

export type LikeState = { likeCount: number; likedByMe: boolean };

// One batched query for a whole list of posts -- never N+1. Anonymous
// viewers (viewerId null) still get counts, just without likedByMe.
export async function likeCountsFor(db: Db, postIds: string[], viewerId: string | null): Promise<Map<string, LikeState>> {
  const byPost = new Map<string, LikeState>();
  if (postIds.length === 0) return byPost;

  const rows = await db
    .select({
      postId: postLikes.postId,
      likeCount: sql<number>`count(*)::int`,
      likedByMe: sql<boolean>`coalesce(bool_or(${postLikes.userId} = ${viewerId ?? ""}), false)`,
    })
    .from(postLikes)
    .where(inArray(postLikes.postId, postIds))
    .groupBy(postLikes.postId);

  for (const row of rows) {
    byPost.set(row.postId, { likeCount: row.likeCount, likedByMe: Boolean(row.likedByMe) });
  }
  return byPost;
}

export async function setLike(db: Db, postId: string, userId: string, liked: boolean): Promise<void> {
  if (liked) {
    await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
    return;
  }
  await db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));
}

// Newest like first -- the profile's "Curtidas" tab reads like a feed.
export async function listLikedPostIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ postId: postLikes.postId })
    .from(postLikes)
    .where(eq(postLikes.userId, userId))
    .orderBy(desc(postLikes.createdAt));
  return rows.map((r) => r.postId);
}

// Identity only -- profile pages are publicly reachable, so email and
// any Better Auth internals stay out of the payload entirely.
export type PublicUser = {
  id: string;
  name: string;
  image: string | null;
  createdAt: string;
};

export async function getPublicUser(db: Db, id: string): Promise<PublicUser | null> {
  const rows = await db
    .select({ id: user.id, name: user.name, image: user.image, createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, createdAt: row.createdAt.toISOString() };
}

// Self-views never count (the schema's PK enforces per-viewer
// distinctness; this guard keeps your own visits out of the table so
// a profile owner doesn't inflate their own number by refreshes).
export async function recordProfileView(
  db: Db,
  profileUserId: string,
  viewerUserId: string,
): Promise<{ viewCount: number; counted: boolean }> {
  if (profileUserId === viewerUserId) {
    return { viewCount: await profileViewCount(db, profileUserId), counted: false };
  }
  await db
    .insert(profileViews)
    .values({ profileUserId, viewerUserId })
    .onConflictDoUpdate({
      target: [profileViews.profileUserId, profileViews.viewerUserId],
      set: { lastViewedAt: new Date() },
    });
  return { viewCount: await profileViewCount(db, profileUserId), counted: true };
}

export async function profileViewCount(db: Db, profileUserId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(profileViews)
    .where(eq(profileViews.profileUserId, profileUserId));
  return rows[0]?.count ?? 0;
}