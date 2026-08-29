import { boolean, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Better Auth's own tables -- field names/shape must match exactly
// what its Drizzle adapter expects (see better-auth's schema docs).
// Auth strategy today is email+password; account/verification stay
// generic so a Discord OAuth provider can be added later without a
// schema change.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  issuer: text("issuer"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// Engagement lives here, not in domain-api: likes/profile-views need
// an exact, immediate count back in the same response, which the
// 202-accept CQRS pipeline (Redis command -> domain-worker) cannot
// guarantee. These are post-api's first (and deliberately only)
// content-adjacent tables: post ids / profile ids are opaque text
// owned by domain-api's aggregate (posts author_id is a Better Auth
// user.id string), while the user columns DO reference this db's own
// Better Auth user table so account deletion cleans up after itself.
//
// No FK on post_id on purpose: posts belong to domain-api (see
// domainApiClient's header) -- an orphaned like row is harmless since
// every read joins against the published list, and referencing the
// other service's table would couple this DB to its writes.
export const postLikes = pgTable(
  "post_likes",
  {
    postId: text("post_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Leading (post_id) already serves the per-post count query; the
    // composite PK makes re-liking idempotent.
    primaryKey({ columns: [t.postId, t.userId] }),
    // "posts this user liked, newest first" (GET /posts/liked/by-me).
    index("post_likes_user_id_created_at_idx").on(t.userId, t.createdAt),
  ],
);

// One row per (viewed profile, viewer) pair -- distinctness IS the
// constraint, so "how many people have seen this profile" is a plain
// COUNT(*). Only logged-in viewers are ever recorded; anonymous
// visitors are deliberately untracked (see routes/users.ts).
export const profileViews = pgTable(
  "profile_views",
  {
    profileUserId: text("profile_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    viewerUserId: text("viewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firstViewedAt: timestamp("first_viewed_at").notNull().defaultNow(),
    lastViewedAt: timestamp("last_viewed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileUserId, t.viewerUserId] })],
);

// Announce dedup for the Discord webhook poller (lib/announcer.ts):
// posts can't change since domain posts are immutable once published,
// so a bare "already announced" id list is all idempotency needs. Same
// no-FK stance as post_likes -- a webhook post id whose post later
// vanished from domain-api is inert history.
export const announcedPosts = pgTable("announced_posts", {
  postId: text("post_id").primaryKey(),
  announcedAt: timestamp("announced_at").notNull().defaultNow(),
});
