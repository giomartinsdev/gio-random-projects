#!/usr/bin/env node
/**
 * Snapshot a real league from API-Football into `public/dataset/football.json`.
 *
 * The browser must never hold an API key: anything shipped to a client is public,
 * and every visitor would spend the owner's quota. So the key lives here, in the
 * build environment, and runs once.
 *
 *   API_FOOTBALL_KEY=xxxx npm run data:fetch
 *   API_FOOTBALL_KEY=xxxx npm run data:fetch -- --league 43 --season 2025
 *
 * Docs: https://www.api-football.com/documentation-v3
 *
 * The script is deliberately boring: one request per team, cached on disk, and
 * rate-limited. A partial failure leaves the previous file intact rather than
 * writing a half-league that would make the game unplayable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API = "https://v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// 43 = National League (England, tier 5). A lower-league manager game should
// ship with the division it is actually about, not the Premier League.
const LEAGUE = Number(arg("league", 43));
const SEASON = Number(arg("season", 2025));
const OUT = resolve(arg("out", "public/dataset/football.json"));
const CACHE = resolve(".cache/api-football");
// `--dry-run` fetches, validates and reports without writing the file. It exists
// so a key can be tested against the live API without overwriting a good snapshot.
const DRY_RUN = args.includes("--dry-run");

if (!KEY) {
  console.error(
    "API_FOOTBALL_KEY is not set.\n" +
      "Get a key at https://dashboard.api-football.com/ then:\n" +
      "  API_FOOTBALL_KEY=... npm run data:fetch",
  );
  process.exit(1);
}

async function get(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const response = await fetch(url, {
    headers: {
      "x-apisports-key": KEY,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status}`);
  }

  const body = await response.json();
  // API-Football reports errors in the body with HTTP 200 and a `results: 0`
  // payload, so a status check alone would happily write an empty league.
  const errors = body.errors;
  const hasErrors = Array.isArray(errors)
    ? errors.length > 0
    : Object.keys(errors ?? {}).length > 0;
  if (hasErrors) {
    throw new Error(`${path} → ${JSON.stringify(errors)}`);
  }
  return body.response;
}

async function cached(name, produce) {
  const file = resolve(CACHE, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const value = await produce();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2));
    return value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Fetching league ${LEAGUE}, season ${SEASON}…`);

  const teams = await cached(`teams-${LEAGUE}-${SEASON}`, () =>
    get("/teams", { league: LEAGUE, season: SEASON }),
  );

  const meta = await cached(`league-${LEAGUE}`, () => get("/leagues", { id: LEAGUE }));
  const name = meta[0]?.league?.name ?? `League ${LEAGUE}`;

  console.log(`${teams.length} clubs in ${name}.`);

  const out = [];
  for (const [index, entry] of teams.entries()) {
    const team = entry.team;
    process.stdout.write(`  ${index + 1}/${teams.length} ${team.name}\r`);

    const [squads, venues] = await Promise.all([
      cached(`squad-${team.id}`, () => get("/players/squads", { team: team.id })),
      cached(`venue-${team.id}`, () => get("/teams", { id: team.id })),
    ]);

    out.push({
      team: {
        id: team.id,
        name: team.name,
        code: team.code ?? null,
        logo: team.logo ?? null,
        founded: team.founded ?? null,
      },
      venue: venues[0]?.venue
        ? {
            name: venues[0].venue.name ?? null,
            capacity: venues[0].venue.capacity ?? null,
            city: venues[0].venue.city ?? null,
          }
        : null,
      squad: (squads[0]?.players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        age: p.age ?? null,
        number: p.number ?? null,
        position: p.position ?? null,
        photo: p.photo ?? null,
      })),
    });

    // The free tier is rate-limited. One request pair per second keeps a full
    // division inside the window without hammering the provider.
    await sleep(Number(arg("delay", 1100)));
  }

  const snapshot = {
    meta: {
      source: "api-football",
      leagueId: LEAGUE,
      leagueName: name,
      season: SEASON,
      fetchedAt: new Date().toISOString(),
      provider: "API-Football (api-football.com)",
    },
    teams: out,
  };

  const missing = out.filter((t) => t.squad.length < 11);
  if (missing.length) {
    console.error(
      `\nRefusing to write: ${missing.length} club(s) returned fewer than 11 players: ` +
        missing.map((t) => t.team.name).join(", "),
    );
    process.exit(1);
  }

  const players = out.reduce((sum, t) => sum + t.squad.length, 0);
  const photos = out.reduce(
    (sum, t) => sum + t.squad.filter((p) => p.photo).length,
    0,
  );

  if (DRY_RUN) {
    console.log(
      `\nDry run OK: ${out.length} clubs, ${players} players ` +
        `(${photos} with a photo), zero short squads. Nothing written.`,
    );
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2));
  console.log(
    `\nWrote ${out.length} clubs, ${players} players → ${OUT}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
