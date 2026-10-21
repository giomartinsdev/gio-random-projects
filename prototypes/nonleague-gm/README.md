# Pyramid — playable prototype

A playable slice of an English football pyramid management game: take a non-league
club from the sixth tier to the Premier League.

It exists to answer one question — **is the loop fun?** — before spending money on
art, backend or a store listing. The engine, the match model and the design are all
clean-room; the artwork is generated. Clubs, badges and faces come from **either**
an invented world (the default, no licence required) **or** a real one loaded from a
licensed data provider — see [Real clubs and real players](#real-clubs-and-real-players).

Read [`RESEARCH.md`](./RESEARCH.md) for the product teardown and UK market map
that this prototype comes out of.

**Two artefacts, one product.** [`ui.pen`](./ui.pen) is the design system and thirteen
screens (six desktop, four mobile, plus the league trio) plus the five strategy boards;
[`DESIGN.md`](./DESIGN.md) is the written companion: tokens, components, per-screen
rationale, the table grid rule, the 2D match model, the friend-league rules, the
licensed-data model, roadmap and the decisions still open.

The React app below implements that system and both artefacts now carry the same
identity and broadcast layers: **identity** (deterministic portraits, shield badges,
player cards) and **broadcast** (the score bug, the goal lower-third, the meshed goals).
The only layer the `.pen` does not carry is motion — the beat-script ball, the animated
digits and the confetti only exist in the running app.

Run the prototype to judge the loop; open the `.pen` to judge the system.

## Run it

```bash
cd prototypes/nonleague-gm
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm test             # 175 tests: engine + friend league + pitch model + identity + parsers + UI
npm run typecheck
npm run build
./node_modules/.bin/vite-node src/engine/calibrate.ts        # match model vs. real football stats
./node_modules/.bin/vite-node src/engine/economics-check.ts  # one season of income and costs
./node_modules/.bin/vite-node src/engine/outcome-check.ts    # champion vs. mid-table vs. bottom
```

The calibration scripts are run with `vite-node` because it is already in the
dependency tree; `tsx` is not installed, and adding a second TS runner to read the
same numbers would be a dependency for no benefit.

## What you can do

- **Hub** — the matchday, built like a broadcast fixture rather than a dashboard:
  both badges, both key players' faces, form, gate, and one unmissable **Kick off**.
  Pick a mentality, or rewatch the last match.
- **League** — the friend league hub: your pick, who is still to play, the friend
  table, head-to-head, honours and the caretaker rule. Locking in resolves the
  matchday for all six managers and archives the friend derbies.
- **Match** — presented as a broadcast: a score bug with both badges, a running
  clock, a momentum strip, a live ticker, and a goal sequence with the scorer's
  face. On the pitch: 22 player tokens and a real football — five panels, a shadow,
  a trail, a net at each end. The ball is carried, passed, shot and goes into the
  net on the goal's minute, then play restarts from the centre. 1×/2×/4× speed,
  pause or skip. Goals, stats and commentary come from the same match result, so
  what you watch is what the table records.
- **Squad** — a grid of player cards: face, rating, real position (RB/CAM/ST), six
  attributes, gold/silver/bronze by ability. Tap a card for the full inspector; the
  sortable list view is still one toggle away.
- **Table** — live league table with badges, promotion, play-off and relegation zones.
- **Transfers** — a seeded free-agent market, as cards rather than rows, and a
  stadium upgrade.
- **Season** — play 38 matchweeks, then end the season: promotion, relegation,
  prize money, and a new fixture list. The save persists in `localStorage`.

## How it is built

```
src/
  engine/           pure TypeScript, no React, no DOM
    types.ts        the whole data model
    rng.ts          seeded PRNG + Poisson draw
    squad.ts        XI selection and attack/defence strength
    match.ts        the match model
    pitch.ts        the 2D view: 22 tokens + ball for a given minute
    league.ts       fixtures, table, promotion/relegation
    friendLeague.ts the multiplayer model: windows, caretakers, friend table
    economy.ts      attendance, gate, wages, commercial, prize money
    board.ts        confidence and dismissal
    career.ts       the career aggregate: create, advance, sign, upgrade, season
    commands.ts     the single mutation entry point
    data.ts         fictional clubs and players
    identity.ts     deterministic faces, badges, attributes, shirt numbers
    dataset.ts      real-data adapter (API-Football or Wikipedia snapshot → game model)
  components/
    Header.tsx      club bar: badge, captain's face, balance/week/board
    Dashboard.tsx   the matchday hub
    MatchScreen.tsx the broadcast: score bug, ticker, goal graphic, pitch
    Squad.tsx       card grid + inspector, with a list toggle
    Identity.tsx    PlayerFace and ClubCrest — drawn or licensed, same API
    PlayerCard.tsx  the player card and the compact row
    LeagueScreen.tsx the friend league hub
  scripts/
    fetch-dataset.mjs    API-Football snapshot (licensed, needs a key)
    fetch-wikipedia.mjs  Wikipedia/Wikidata snapshot (open, no key)
    wikipedia-parse.mjs  the pure parsers, tested without a network
  App.tsx           screens and wiring
```

**Engine rules that are load-bearing:**

1. *Determinism.* Every random draw comes from a PRNG seeded by the career, so the
   same save always produces the same next match. Without this you can never tell
   whether your tactic worked or you got a different dice roll.
2. *Legibility.* Two numbers per side (attack, defence) drive the match. The
   hub shows them side by side, so a result is explainable.
3. *Calibration.* The Poisson model is fitted to real football, and the numbers are
   checked by a script rather than assumed:

   | Fixture | Home | Draw | Away | Goals/game |
   |---|---|---|---|---|
   | even | 44.9% | 22.8% | 32.4% | 2.89 |
   | 10 pts stronger | 58.5% | 20.5% | 21.1% | 3.05 |
   | 20 pts stronger | 74.3% | 16.2% | 9.6% | 3.15 |
   | 30 pts stronger | 89.3% | 8.1% | 2.6% | 3.32 |

   Real English league football: ~45/25/30 and ~2.7 goals.

4. *Honest friction.* A mid-table season runs at roughly −£18k; a title win brings
   ~£328k and promotion; a bottom finish loses ~£43k. Money is tight on purpose —
   otherwise the decisions have no weight.
5. *The view is the result.* `pitch.ts` is a pure function of the match result and
   the clock: `samplePitch({ result, minute, seed })`. No random drift per frame, no
   recorded animation. Replaying a match at the same minute produces the same frame,
   so a goal you watched at 69' still happened at 69' when the table updates.
   Underneath, the match is a script of beats — kick-off, carry, pass, shot,
   restart — with the ball's path decided first and the players placed around it.
   Duration comes from distance, so the ball travels at one readable speed instead
   of every pass taking the same fixed slice of clock, and a goal's celebration,
   restart, build-up and shot share the minutes available before the next goal.
   Player tokens are separated in token-ellipse space so they never overlap, and
   no token is ever pinned to the ball: each is its own anchor plus a small lean
   toward it. So the ball cannot drift off a carrier's boot, and a player cannot
   hop while the ball glides — which is what the browser check found (180px in a
   single frame, invisible to every test that only measured the ball).

## Real clubs and real players

The game ships with an invented world, and that is the default. It also runs on a real
league, because the difference between "a management sim" and "a football game" is
whether the badge and the face are real.

There are two ways to get there, and they are not equivalent.

**The open path.** No key, no signup: `npm run data:fetch:open` reads the National
League North (tier 6 — the division this product is actually about) from Wikipedia and
Wikidata and writes `public/dataset/football.json`.

```bash
npm run data:fetch:open            # National League North, 22 clubs, ~520 players
npm run data:check:open            # same, but writes nothing
```

What it can and cannot give you is set by copyright, not by the API:

| | Source | Licence | Ships? |
|---|---|---|---|
| Names, numbers, positions, birthdays | Wikipedia article text | facts — no copyright | yes |
| Squad lists for a tier-6 division | `{{Fs player}}` templates | CC BY-SA 4.0 | yes |
| Player photographs | Wikimedia Commons | CC BY-SA / CC0 / PD, per file | yes, with credit |
| Club crests | uploaded to Wikipedia | **fair use — not reusable** | **no** |

That last row is the whole reason the default look still draws a shield. A real crest
is a trademark licensed club by club; reproducing it because a fan uploaded it to
Wikipedia under fair use is not a licence. So the fetcher reads the crest field to
know it exists and then deliberately does not download it.

**The licensed path.** API-Football sells squads, badges and official photos, and
requires a key:

```bash
cp .env.example .env             # paste your key
npm run data:fetch               # National League (43) 2025 by default
npm run data:fetch -- --league 40 --season 2025   # or any league/season
```

Both paths write the same snapshot shape, and `parseSnapshot` accepts both, so no
screen knows which one it is looking at. A save records `source: "licensed"` and keeps
the real division from being regenerated at the end of a season.

**Why a snapshot and not a live call.** An API key in a browser bundle is a published
key: every visitor spends your quota and anyone can read it. The key is read only by
`scripts/fetch-dataset.mjs` (server-side, from `API_FOOTBALL_KEY`), cached per
endpoint under `.cache/`, and never prefixed with `VITE_`. The app fetches a static
file, so it stays fast, works offline, and costs nothing to serve.

**Attribution is not optional.** CC BY-SA requires the author to be named wherever the
work appears, so the credit travels *with the player* (`Player.photoCredit`) rather
than sitting in one site-wide notice. It renders as a footer line, and as the `title`
on the photograph itself, so a squad grid of twenty faces does not become a wall of
captions. The footer reads:

> Names and squads: Wikipedia (CC BY-SA 4.0) · portraits: Wikimedia Commons, credited per player

**What no provider sells: ratings.** Neither source returns a 1–99 ability. The number
on each card is derived from squad order and age against the division's baseline
(`abilityFor` in `dataset.ts`), which is documented in the code and in the UI. It is a
shape, not an official number — passing off a guess as a licensed rating would be the
one dishonest thing in the whole model.

**Identity is the hard part, not the fetching.** A squad list gives you a name; it does
not tell you *which* Josh Wardle that is. The first version of the fetcher attached a
43-year-old artist's portrait to a defender, because it resolved players by bare name.
Three things fix that, and each one exists because of a real wrong answer:

- The squad template's **article link** is the identity, not the display name —
  `Billy Waters (footballer, born 1994)`, not `Billy Waters`.
- An unlinked name gets **no lookup at all**. A bare name is not an article title, and
  querying one invites the collision.
- A resolved person must be a **footballer** (Wikidata `P106`), which drops the actor,
  the rugby player and the artist who share a name with a squad member.

The fetcher reports each rejection rather than quietly dropping them, so a name that
stops resolving is visible in the build log.

**Degradation.** No key, no file, bad JSON, offline, or a single-page host that
rewrites the missing file to the app shell: every case falls back to the invented
pyramid. That last one is the one that bites in production — the response is a
`200` with HTML, so the adapter checks the content type, not just the status. A data
source is an upgrade, never a precondition for playing. The tests cover all five
failure modes.

## The look

Three things make it read as a game rather than a dashboard, and all three are
structural rather than cosmetic:

1. **A face per person.** `appearanceOf(playerId, age)` derives skin, hair, beard,
   brows, build and eye colour from the player id, so the same man has the same face
   on the hub, in the squad grid, on the pitch and in a goal graphic. Deterministic,
   reload-stable, and legal: it is a drawing, not a likeness. A licensed portrait
   replaces it whenever one exists, through the same component.
2. **A badge per club.** `ClubCrest` draws a shield from the club's own colours with a
   pattern (band, stripes, halves, chevron, hoops) and its initials. Real crests are
   artwork and artwork is licensed; a generated shield is not.
3. **A broadcast frame around the match.** Score bug, live ticker, momentum strip,
   goal lower-third with the scorer's face, a camera that leans with the ball, and
   net flash + confetti on the goal's minute — all driven by the same
   `samplePitch()` frame the pitch is drawn from.

Motion is decorative and guarded by `motion-safe` / `prefers-reduced-motion`: card
entrances, the kick-off sweep, score digits popping, the goal slam. Nothing animated
carries information, so a reduced-motion player loses no state.

**Colour is contrast-checked, not tuned by eye.** The generated kit palette
(`hsl(h 50% 27%)` / `hsl(h 68% 68%)`) is the pair of lightness values at which chalk on
the shirt *and* ink on the shirt number clear 4.5:1 for all 360 hues. The first palette
put an 8px white number on a lime shirt at 1.95:1 — measured in the browser, then
fixed in the generator so no club can ever be given a kit its numbers disappear into.
Shirt numbers pick ink or chalk from the shirt colour with the same rule the crest uses.

## Testing

Tests were written before the implementation, covering positive, negative and edge
cases (`src/engine/engine.feature` and `src/ui.feature` are the readable spec).

Deliberately covered edge cases that naive implementations get wrong:

- a table missing clubs throws instead of silently ranking fewer teams;
- the top tier promotes nobody and the bottom tier relegates nobody;
- attendance is capped by capacity and floored at a hard core of support;
- a paid signing is refused when the balance cannot cover the fee, but a free
  agent is allowed even in debt;
- advancing past the end of a season is rejected rather than running on;
- a matchweek plays ten fixtures, and the result panel shows *your* match — this
  was a real bug caught by playing it in a browser, not by the tests;
- the PRNG combines seed and cursor with 32-bit integer ops only, because the
  obvious `seed + cursor * constant` overflows `Number.MAX_SAFE_INTEGER` and
  collapses every career onto the same random stream;
- the match screen labels the matchday that was just played, not `week + 1` —
  advancing already moved the career forward, so the obvious label was off by one.

The friend league has its own 25 tests and a Gherkin spec
(`src/engine/friendLeague.feature`). The rules they pin down are the ones a
multiplayer game is actually judged on:

- a matchday cannot resolve while an active manager has not picked, but a missed
  deadline never holds the league hostage — the no-show's club is simulated and
  their miss is counted;
- submitting a pick *is* the readiness signal, so nobody can watch the results and
  then change shape;
- three consecutive misses hand the club to a caretaker, and a takeover resets the
  count;
- only friend-vs-friend results are archived, and re-recording a matchday cannot
  count the same derby twice;
- clubs freeze once a season has kicked off;
- the friend champion is the highest tier, then the highest position — a division
  title does not beat a promotion.

The league UI adds seven more: the hub lists six managers and the derived invite
code, locking in plays the matchday *and* advances the window, the archive keeps
only that week's derbies, the resolved window and the archive land in one state
update (two setters raced and silently dropped the results), and the league
survives a reload.

The identity layer adds 22 tests (`src/engine/identity.test.ts`): the same player
always gets the same face and different players do not; a veteran's look ages; shirt
numbers are unique across a squad; the six card attributes average back to the one
real rating and are shaped by position; badges are stable and pattern-valid; a
licensed snapshot keeps names, crests, portraits and venues; a squad that arrives
without positions still produces a playable XI; an odd number of clubs drops one
instead of throwing at startup; and a missing file / malformed JSON / offline network
all fall back to the invented world instead of breaking the game.

The UI adds three more: every squad player has a face and the *identical* player
draws the identical face on two screens; every club has a badge, on the hub and in
the table; and a goal shows a graphic naming the scorer with his face and his crest —
driven by the ball being in the net, not by a timer.

The 2D pitch has its own 24 tests across two files. The first eight cover
the shape: 22 tokens always, all inside the pitch, the same seed and minute always
give the same frame, players actually move, no two tokens overlap, shirt numbers
are distinct, and positions clamp at the touchline. The other sixteen cover the ball
as a football, and they are the ones that changed the design:

- the ball is at the feet of the man carrying it, and that man is the one marked
  as having it;
- a pass travels between two players and leaves the ground while it does;
- on the minute of a goal the ball is inside the correct net, and on the minute
  *before* it has not yet crossed the line;
- every goal in a crowded match — including a pair a minute apart — lands in the
  right net on its own minute;
- a dead ball (kick-off, restart, a shot with no build-up behind it) is placed,
  not rolled, and is flagged so the renderer cuts instead of gliding;
- the ball never teleports between two consecutive frames, and never moves more
  than a third of the pitch in the renderer's half-minute tick;
- no two-minute window of the match is motionless;
- no player token jumps more than a tenth of the pitch between renderer ticks —
  the ball being smooth does not mean the players are;
- the ball stays inside the pitch, including inside the net.

## Not built (on purpose)

Server persistence, real-time sync, live ops, hand-drawn final art, club creation,
and licensed likenesses bundled in the build (the adapter loads yours instead).
The prototype is a fun-check, not a product. The friend league runs entirely on
one device: your five rivals' picks are simulated deterministically, and the rules
in `friendLeague.ts` are what a server would run. See `RESEARCH.md` §7 for what to
do next and in what order.

**Not built for a real pyramid:** a real snapshot is a *single* division, so promotion
and relegation move your club's tier label but do not load last season's league above
you. Doing that properly means snapshotting a pyramid, not a league, and matching
competition ids across seasons — a data problem, not an engine one. The invented world
already has a pyramid (`divisions: 5`), which is why the default is still the invented
one.

**What the open snapshot cannot give you is a crest.** Club badges are trademarks and
the copies on Wikipedia are fair use, so a real division currently plays in generated
shields. That is a licensing wall, not an unfinished feature: a real crest needs a
licence from the club, which is exactly what a commercial build would buy.

**Known limitation of the prototype's league:** the engine simulates one division,
and friend clubs are re-seated by identity across seasons, so promotion and
relegation are not modelled for friends. The `.pen` canon (a tiered pyramid, with
Tom's Netherby above Gio's Ashcombe) is the target model; the engine's
`friendStandings` already ranks by tier, so the missing piece is the pyramid
itself, not the league rules.

The `.pen` design is a set of static screens; the React app runs them. Both now carry
the identity and broadcast layers — `PlayerFace`, `ClubCrest`, `PlayerCard`, the score
bug and the goal lower-third are drawn on the canvas as well as implemented, with the
same component boundaries (`AeTny`, `d3LrVm`, `St4gn`). What the canvas cannot carry is
motion; the beat-script ball, the animated score digits and the confetti only exist in
the app. What is shared is the model: the app's pitch and the mockup's pitch describe
the same match.
