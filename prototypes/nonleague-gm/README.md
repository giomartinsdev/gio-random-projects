# Pyramid — playable prototype

A playable slice of an English football pyramid management game: take a fictional
non-league club from the sixth tier to the Premier League.

It exists to answer one question — **is the loop fun?** — before spending money on
art, backend or a store listing. Everything here is clean-room: invented clubs,
invented players, own engine. No licensed or third-party material.

Read [`RESEARCH.md`](./RESEARCH.md) for the product teardown and UK market map
that this prototype comes out of.

**The design deliverable is not this prototype.** Open [`ui.pen`](./ui.pen) in
Pen.app for the design system and thirteen screens (six desktop, four mobile,
plus the league trio) plus the five strategy boards. [`DESIGN.md`](./DESIGN.md) is
the written companion: tokens, components, per-screen rationale, the table grid
rule, the 2D match model, the friend-league rules, roadmap and the decisions still
open. The React app below is the *engine* proof — the `.pen` is what the product
should look like.

## Run it

```bash
cd prototypes/nonleague-gm
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm test             # 127 tests: engine + friend league + pitch model + UI
npm run typecheck
npm run build
npx tsx src/engine/calibrate.ts        # match model vs. real football stats
npx tsx src/engine/economics-check.ts  # one season of income and costs
npx tsx src/engine/outcome-check.ts    # champion vs. mid-table vs. bottom
```

## What you can do

- **Dashboard** — your next fixture, both sides' attack/defence, pick a mentality,
  then **Watch match** to drop into the live 2D pitch. A league strip at the top
  shows how many friends have locked in.
- **League** — the friend league hub: your pick, who is still to play, the friend
  table, head-to-head, honours and the caretaker rule. Locking in resolves the
  matchday for all six managers and archives the friend derbies.
- **Match** — a 2D pitch with 22 player tokens and a real football: five panels,
  a shadow, a trail, and a net at each end to put it in. The ball is carried,
  passed, shot and goes into the net on the goal's minute, then play restarts
  from the centre. A running clock, 1×/2×/4× speed, pause and skip-to-full-time.
  Goals, stats and commentary are driven by the same match result, so what you
  watch is what the table records.
- **Squad** — 20 players, best XI marked, sortable, with morale.
- **Table** — live league table with promotion, play-off and relegation zones.
- **Transfers** — a seeded free-agent market and a stadium upgrade.
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
  components/       presentation only
  App.tsx           screens and wiring
```

**Engine rules that are load-bearing:**

1. *Determinism.* Every random draw comes from a PRNG seeded by the career, so the
   same save always produces the same next match. Without this you can never tell
   whether your tactic worked or you got a different dice roll.
2. *Legibility.* Two numbers per side (attack, defence) drive the match. The
   dashboard shows them side by side, so a result is explainable.
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

Server persistence, real-time sync, live ops, final art, club creation and badges.
The prototype is a fun-check, not a product. The friend league runs entirely on
one device: your five rivals' picks are simulated deterministically, and the rules
in `friendLeague.ts` are what a server would run. See `RESEARCH.md` §7 for what to
do next and in what order.

**Known limitation of the prototype's league:** the engine simulates one division,
and friend clubs are re-seated by identity across seasons, so promotion and
relegation are not modelled for friends. The `.pen` canon (a tiered pyramid, with
Tom's Netherby above Gio's Ashcombe) is the target model; the engine's
`friendStandings` already ranks by tier, so the missing piece is the pyramid
itself, not the league rules.

The `.pen` design is a set of static screens; the React app is a separate,
deliberately simpler visual implementation. Porting the `.pen` styling into the
app proper is the next engineering task, not this one. What *is* shared is the
model: the app's pitch and the mockup's pitch describe the same match.
