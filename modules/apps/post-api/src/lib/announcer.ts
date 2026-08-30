import { inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { announcedPosts } from "../db/schema.js";
import type { DomainApiClient } from "./domainApiClient.js";
import { logger } from "../logger.js";

// Discord announcer: a poller (not a write hook) because the one
// component that KNOWS a post just got published -- domain-api's CQRS
// worker -- is deliberately out of reach (untouched Go service on the
// other side of a 202-accept contract). Polling the published list
// every interval is the same trade-off the RSS feed already makes;
// the webhook call itself is once per NEW post thanks to
// announced_posts below.
//
// Freshness window: only posts published in the last 24h are
// considered, so a backlog older than that never noisily bursts (and
// a first-ever deploy doesn't spam the channel with years of posts).
// Per-cycle cap bounds the blast radius of a single buggy batch.
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_CYCLE = 3;

export function createPostAnnouncer(deps: {
  db: Db;
  domainApi: DomainApiClient;
  webhookUrl: string;
  siteUrl: string;
}) {
  // One sweep: list published, keep fresh ones, drop already-announced,
  // announce up to MAX_PER_CYCLE oldest-first (chronological in the
  // channel). A post is marked announced ONLY after Discord accepted
  // it -- a webhook outage means the row is never written and the next
  // sweep retries the same post.
  async function announceOnce(now = Date.now()): Promise<number> {
    const published = (await deps.domainApi.listPublished()).posts
      .filter((p) => p.published_at !== null && now - Date.parse(p.published_at) < FRESH_WINDOW_MS)
      .sort((a, b) => Date.parse(a.published_at ?? "") - Date.parse(b.published_at ?? ""));

    const announcedIds =
      published.length === 0
        ? new Set<string>()
        : new Set(
            (
              await deps.db
                .select({ postId: announcedPosts.postId })
                .from(announcedPosts)
                .where(
                  inArray(
                    announcedPosts.postId,
                    published.map((p) => p.id),
                  ),
                )
            ).map((r) => r.postId),
          );

    let sent = 0;
    for (const post of published) {
      if (sent >= MAX_PER_CYCLE) break;
      if (announcedIds.has(post.id)) continue;

      const res = await fetch(deps.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: `📰 **${post.title}**\n${deps.siteUrl}/posts/${post.slug}` }),
      }).catch(() => undefined);
      if (!res || !res.ok) {
        logger.warn({ status: res?.status, post: post.id }, "discord announce failed; will retry next sweep");
        continue;
      }
      await deps.db.insert(announcedPosts).values({ postId: post.id }).onConflictDoNothing();
      sent += 1;
    }
    return sent;
  }

  // First sweep after a short delay (let the container finish booting
  // and domain-api come up), then the fixed cadence. unref() keeps a
  // stray interval from holding the process open in tests.
  function start(intervalMs: number, firstDelayMs = 30_000): void {
    const first = setTimeout(() => {
      void announceOnce().catch((err) => logger.warn({ err }, "post announcer sweep failed"));
    }, firstDelayMs);
    first.unref();
    const timer = setInterval(() => {
      void announceOnce().catch((err) => logger.warn({ err }, "post announcer sweep failed"));
    }, intervalMs);
    timer.unref();
  }

  return { announceOnce, start };
}

export type PostAnnouncer = ReturnType<typeof createPostAnnouncer>;