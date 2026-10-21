#!/usr/bin/env node
/**
 * Snapshot a real English division from Wikipedia + Wikidata into
 * `public/dataset/football.json`.
 *
 *   npm run data:fetch:wiki
 *   npm run data:fetch:wiki -- --page "National League North"
 *
 * Why Wikipedia and not API-Football for this pass: it needs no key, and it is
 * the only source that carries a full squad list for a tier-6 division. What it
 * is *not* is a licensed ratings feed, so the same rule as before applies —
 * names, numbers, positions and dates of birth are facts, ability is derived by
 * `abilityFor()` and labelled as derived in the UI.
 *
 * The licence boundary is the part that matters, and it is not the same for the
 * three kinds of media involved:
 *
 *   names, numbers, positions, birthdays   facts, no copyright
 *   player photographs                     Wikimedia Commons only: CC BY-SA / PD,
 *                                          attribution required, stored per player
 *   club crests                            uploaded to Wikipedia under "fair use",
 *                                          so they are deliberately *not* fetched;
 *                                          the generated shield is used instead
 *
 * Anything from Commons carries its licence and author into the snapshot, and the
 * footer renders the credit. A crest that we cannot licence is the one thing we
 * refuse to reproduce.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  clean,
  infoboxField,
  parseCapacity,
  parseClubs,
  parseSquad,
  plainText,
} from "./wikipedia-parse.mjs";

const WP = "https://en.wikipedia.org/w/api.php";
const WD = "https://www.wikidata.org/w/api.php";
const UA = "PyramidDesign/0.1 (open-data snapshot; https://github.com/)";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Tier 6: the division the game is actually about. The Premier League is a
// different product.
const PAGE = arg("page", "National League North");
const OUT = resolve(arg("out", "public/dataset/football.json"));
const CACHE = resolve(arg("cache", ".cache/wikipedia"));
const DRY_RUN = args.includes("--dry-run");
const DELAY = Number(arg("delay", 1200));

const CACHE_VERSION = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(key, produce) {
  const file = resolve(CACHE, `${key}.json`);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed.__v === CACHE_VERSION) return parsed.value;
  } catch {
    /* miss */
  }
  const value = await produce();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ __v: CACHE_VERSION, value }));
  return value;
}

async function api(base, params, attempt = 0) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({ ...params, format: "json" })) {
    url.searchParams.set(k, String(v));
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429) throw new Error("rate limited");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    if (attempt >= 6) throw error;
    // Wikipedia's anonymous limit is ~200 requests/minute but it throttles in
    // bursts; exponential backoff from 5s is the difference between a snapshot
    // that completes and one that dies halfway.
    const wait = Math.min(60_000, 5_000 * Math.pow(2, attempt));
    process.stderr.write(`\n  retry in ${Math.round(wait / 1000)}s (${error.message}) `);
    await sleep(wait);
    return api(base, params, attempt + 1);
  }
}

async function wikitext(page, attempt = 0) {
  const data = await api(WP, {
    action: "parse",
    page,
    prop: "wikitext",
    redirects: 1,
  });
  const text = data?.parse?.wikitext?.["*"];
  if (typeof text !== "string") {
    if (attempt >= 2) throw new Error(`no wikitext for ${page}`);
    await sleep(DELAY * 2);
    return wikitext(page, attempt + 1);
  }
  return text;
}

const POSITION_MAP = { GK: "GK", DF: "DF", MF: "MF", FW: "FW" };

function keyOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Batch-resolves article → Wikidata id + lead image.
 * Batched at 50 titles, the API's limit for anonymous queries — fewer requests
 * means less exposure to the throttle, which is the real constraint here.
 *
 * Results are keyed by the title that was *asked for* as well as the one that
 * came back. With `redirects=1` the API answers under the canonical title, so a
 * squad link to a redirect would otherwise miss its own data.
 *
 * One request per ~1.5s is inside the published anonymous limit, but Wikipedia
 * throttles bursts well below that, so the backoff has to be patient: a batch
 * that fails here is thirty seconds of work, not a page load.
 */
async function resolveArticles(names) {
  const out = new Map();
  const unique = [...new Set(names.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await cached(`pages-${keyOf(chunk.join("|"))}`, async () => {
      const res = await api(WP, {
        action: "query",
        titles: chunk.join("|"),
        prop: "pageprops|pageimages",
        ppprop: "wikibase_item",
        piprop: "name",
        redirects: 1,
      });
      const pages = res?.query?.pages ?? {};

      // canonical title → the string the caller passed in.
      const alias = new Map();
      for (const n of res?.query?.normalized ?? []) alias.set(n.to, n.from);
      for (const r of res?.query?.redirects ?? []) {
        alias.set(r.to, alias.get(r.from) ?? r.from);
      }

      return Object.values(pages).map((p) => ({
        title: p.title,
        requested: alias.get(p.title) ?? p.title,
        missing: Boolean(p.missing),
        qid: p.pageprops?.wikibase_item ?? null,
        image: p.pageimage ?? null,
      }));
    });
    for (const page of data) {
      // Index both spellings; a caller may hold either.
      out.set(page.requested, page);
      out.set(page.title, page);
    }
    process.stderr.write(".");
    await sleep(DELAY);
  }
  return out;
}

/** Date of birth and the Commons image, from Wikidata. 50 ids per request. */
async function resolveFacts(qids) {
  const out = new Map();
  const unique = [...new Set(qids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await cached(`facts-${keyOf(chunk.join("|"))}`, () =>
      api(WD, { action: "wbgetentities", ids: chunk.join("|"), props: "claims" }),
    );
    for (const [qid, entity] of Object.entries(data?.entities ?? {})) {
      const claims = entity.claims ?? {};
      const dod = claims.P570?.[0]?.mainsnak?.datavalue?.value?.time;
      const dob = claims.P569?.[0]?.mainsnak?.datavalue?.value?.time;
      // Every club the person is recorded as having played for. Used to reject a
      // name collision before it becomes a portrait of the wrong man.
      const clubs = (claims.P54 ?? [])
        .map((c) => c.mainsnak?.datavalue?.value?.id)
        .filter(Boolean);
      // Wikidata's occupation item for "association football player". A name that
      // resolves to an actor or a rugby player is a different human being, even
      // when the date of birth is perfectly plausible.
      const footballer = (claims.P106 ?? []).some(
        (c) => c.mainsnak?.datavalue?.value?.id === "Q937857",
      );
      out.set(qid, {
        born: dob ? dob.slice(1, 11) : null,
        died: dod ? dod.slice(1, 11) : null,
        clubs,
        footballer,
        image: claims.P18?.[0]?.mainsnak?.datavalue?.value ?? null,
      });
    }
    process.stderr.write("+");
    await sleep(DELAY);
  }
  return out;
}

/**
 * Commons licence for each image.
 *
 * This is the gate: an image whose licence cannot be read is dropped rather than
 * assumed free. Every kept image carries author and licence into the snapshot so
 * the UI can credit it.
 */
async function resolveLicences(files) {
  const out = new Map();
  const unique = [...new Set(files.filter(Boolean))].map((f) => `File:${f}`);
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const data = await cached(`lic-${keyOf(chunk.join("|"))}`, () =>
      api(WP, {
        action: "query",
        titles: chunk.join("|"),
        prop: "imageinfo",
        iiprop: "url|extmetadata",
      }),
    );
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata ?? {};
      const licence = meta.LicenseShortName?.value ?? null;
      const nonFree = meta.NonFree?.value === "true";
      const author = plainText(meta.Artist?.value ?? meta.Credit?.value ?? "");
      out.set(page.title.replace(/^File:/, ""), {
        url: info.url?.split("?")[0] ?? null,
        licence: licence ? clean(licence) : null,
        author: author || null,
        credit:
          licence && author
            ? `${author} / Wikimedia Commons, ${clean(licence)}`
            : licence
              ? `Wikimedia Commons, ${clean(licence)}`
              : null,
        usable: Boolean(info.url) && !nonFree && Boolean(licence),
      });
    }
    process.stderr.write("~");
    await sleep(DELAY);
  }
  return out;
}

/**
 * Reads one infobox field.
 *
 * Infobox values run to the end of the line and may contain wikilinks, so the
 * venue has to be cleaned before it reaches a card. The first version cut at the
 * first `|`, which truncated "The New Eyrie, [[Cardington, Bedfordshire|Cardington]]"
 * into an unclosed link.
 */
function ageFrom(born) {
  if (!born) return null;
  const [y, m, d] = born.split("-").map(Number);
  if (!y) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const hadBirthday =
    now.getUTCMonth() + 1 > m || (now.getUTCMonth() + 1 === m && now.getUTCDate() >= d);
  if (!hadBirthday) age -= 1;
  return age >= 15 && age <= 45 ? age : null;
}

async function main() {
  console.log(`Wikipedia snapshot: ${PAGE}`);

  const leagueText = await cached(`league-${PAGE.replace(/\W+/g, "-")}`, () => wikitext(PAGE));
  const clubs = parseClubs(leagueText);
  if (clubs.length < 10) {
    throw new Error(`Only found ${clubs.length} clubs on ${PAGE} — refusing to write.`);
  }
  console.log(`${clubs.length} clubs.`);

  const teams = [];
  const allNames = [];
  const files = [];
  for (const [index, club] of clubs.entries()) {
    process.stderr.write(`\n  ${index + 1}/${clubs.length} ${club.name} `);
    const text = await cached(`club-${club.target.replace(/\W+/g, "-")}`, () =>
      wikitext(club.target),
    );
    const squad = parseSquad(text);

    // The club's own Wikidata id, so a player's club history can be compared
    // against it rather than against a name string.
    const qid = await cached(`qid-${club.target.replace(/\W+/g, "-")}`, async () => {
      const res = await api(WP, {
        action: "query",
        titles: club.target,
        prop: "pageprops",
        ppprop: "wikibase_item",
        redirects: 1,
      });
      const page = Object.values(res?.query?.pages ?? {})[0];
      return page?.pageprops?.wikibase_item ?? null;
    });

    // Clubs with no squad section are skipped before the (expensive) name
    // resolution, so their players are never queried.
    if (squad.length < 11) {
      process.stderr.write(`— no squad section, skipping`);
      teams.push({ club, qid: null, squad, venue: null, capacity: null });
      await sleep(DELAY);
      continue;
    }

    // Club colours come from the infobox, but they are inconsistently present at
    // this level, so the generated kit remains the default.
    const venue = infoboxField(text, "ground");
    const capacity = parseCapacity(text);

    for (const player of squad) {
      // Only a linked name has an article to resolve; unlinked names are simply
      // real names with no Wikidata record, which is the common case at tier 6.
      if (player.target) allNames.push(player.target);
    }

    teams.push({ club, qid, squad, venue, capacity });
    await sleep(DELAY);
  }

  console.log(`\nResolving ${allNames.length} players against Wikipedia…`);
  const pages = await resolveArticles(allNames);

  const qids = [];
  for (const team of teams) {
    for (const player of team.squad) {
      // `pageimage` is only the lead portrait when the article *is* the player,
      // so lookup goes through the linked article target. A player whose name is
      // not a link has no article and therefore nothing to resolve.
      player.page = pages.get(player.target) ?? null;
      if (player.page?.qid) qids.push(player.page.qid);
    }
  }

  console.log(`\nFetching Wikidata facts for ${new Set(qids).size} players…`);
  const facts = await resolveFacts(qids);

  // Two identity gates, and they are not equally strong.
  //
  // The squad template links an exact article title, so a player who is linked is
  // the person the encyclopedia has an article about — that is a strong signal.
  // The occupation check is the one that still earns its keep: a name can resolve
  // through a redirect to an actor or a rugby player, and the tell is what
  // Wikidata says they do for a living.
  //
  // The club check is deliberately *not* applied to linked players. Wikidata's
  // club history for tier-6 footballers routinely stops several years and several
  // clubs ago, so absence of the current club says nothing about identity, and
  // treating it as evidence dropped 130 correct matches.
  let rejectedTrade = 0;
  for (const team of teams) {
    for (const player of team.squad) {
      player.facts = player.page?.qid ? facts.get(player.page.qid) ?? null : null;

      if (player.facts && player.facts.footballer === false) {
        rejectedTrade += 1;
        player.page = null;
        player.facts = null;
      }

      const image = player.facts?.image ?? player.page?.image ?? null;
      player.image = image;
      if (image) files.push(image);
    }
  }
  if (rejectedTrade) {
    console.log(`Rejected ${rejectedTrade} name match(es) where the person is not a footballer.`);
  }

  console.log(`\nChecking licences for ${new Set(files).size} images…`);
  const licences = await resolveLicences(files);

  let dropped = 0;
  for (const team of teams) {
    for (const player of team.squad) {
      const licence = player.image ? licences.get(player.image) : null;
      if (player.image && !licence?.usable) dropped += 1;
      player.photo = licence?.usable ? licence.url : null;
      player.credit = licence?.usable ? licence.credit : null;
      player.licence = licence?.usable ? licence.licence : null;
    }
  }

  const shortSquads = teams.filter((t) => t.squad.length < 11);
  // A club article with no squad section is a page-content gap, not a fetch
  // error, so it is dropped with a warning rather than failing the snapshot.
  // Fewer than 18 clubs, though, is not a league.
  const usable = teams.filter((t) => t.squad.length >= 11);
  if (shortSquads.length) {
    console.warn(
      `\nDropping ${shortSquads.length} club(s) with fewer than 11 players: ` +
        shortSquads.map((t) => `${t.club.name} (${t.squad.length})`).join(", "),
    );
  }
  if (usable.length < 18) {
    throw new Error(`Only ${usable.length} usable clubs — refusing to write a league.`);
  }

  // The fixture generator pairs clubs, so an odd division would silently lose one
  // at kick-off — in the game, long after this script has exited. Dropping it here
  // names the club instead.
  const even = usable.length % 2 === 0 ? usable : usable.slice(0, -1);
  if (even.length !== usable.length) {
    console.warn(
      `Dropping ${usable[usable.length - 1].club.name} to keep the division even ` +
        `(${even.length} clubs).`,
    );
  }

  const snapshot = {
    meta: {
      source: "wikipedia",
      leagueId: 0,
      leagueName: PAGE,
      season: new Date().getUTCFullYear(),
      fetchedAt: new Date().toISOString(),
      provider: "Wikipedia and Wikidata contributors",
      attribution:
        "Player names, positions and squad numbers from Wikipedia (CC BY-SA 4.0). " +
        "Photographs from Wikimedia Commons under the licence shown on each player.",
      licence: "CC BY-SA 4.0",
    },
    clubs: even.map((team) => ({
      team: { id: team.club.target, name: team.club.name, code: null, logo: null },
      venue: team.venue ? { name: team.venue, capacity: team.capacity } : null,
      squad: team.squad.map((p) => ({
        id: p.page?.qid ?? `${team.club.target}-${p.name.replace(/\W+/g, "-")}`,
        name: p.name,
        age: ageFrom(p.facts?.born),
        number: p.number,
        position: POSITION_MAP[p.position] ?? null,
        nationality: p.nationality,
        photo: p.photo ?? null,
        photoCredit: p.credit ?? null,
        photoLicence: p.licence ?? null,
      })),
    })),
  };

  const players = snapshot.clubs.reduce((sum, c) => sum + c.squad.length, 0);
  const photos = snapshot.clubs.reduce(
    (sum, c) => sum + c.squad.filter((p) => p.photo).length,
    0,
  );

  console.log(
    `\n${snapshot.clubs.length} clubs, ${players} players, ` +
      `${photos} with a cleared photograph (${dropped} dropped on licence grounds).`,
  );

  if (DRY_RUN) {
    console.log("Dry run — nothing written.");
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
