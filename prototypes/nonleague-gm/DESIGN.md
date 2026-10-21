# Pyramid — Design System & Product Dossier

Companion to `ui.pen`. Open the file in Pen.app to browse the canvas; this document is the written spec so the decisions survive outside the app.

There is also a **playable React prototype** (`prototypes/nonleague-gm`) that implements this spec. The canvas and the prototype have converged on identity and broadcast; the remaining difference is motion, which only the prototype can run. Where the two disagree, this document says which one is the decision and which one has not been redrawn yet.

The canvas is laid out in five bands, top to bottom:

| Band | Contains |
| --- | --- |
| Cover | Title, positioning, contents |
| 01 — The system | Foundations, component library |
| 02 — The friend league | Hub, lobby, rivals — the multiplayer heart |
| 03 — The product | Desktop: hub, live match, squad, table, transfers |
| 04 — The phone | Mobile: matchday, full time, squad, league |
| 05 — The argument | Positioning map, ideas, roadmap, core loop, decisions |

Thirteen screens: six desktop, four mobile, plus the three league screens that are the product's actual hook. The three league frames come before the single-player screens in reading order for a reason — a reviewer who only looks at the hub sees a competent management game; a reviewer who sees the friend league understands why it gets played on a Monday.

**The thesis in one sentence:** a management game that looks like a broadcast and reads like a programme, wrapped around the only feature that makes a £6.99 football game a habit — six friends, one table, one champion.

---

## 1. The idea being designed

A football management game for the English pyramid. You take a club nobody has heard of and try to climb. But the thing you actually play is a **league of friends**: six people, six clubs, one shared season, one champion among you. The design has to do three jobs that normally fight each other:

1. **Read like a matchday programme.** Printed, editorial, confident. Condensed display type, hairlines, chalk on grass.
2. **Behave like a data product.** Tabular numbers that never jitter, dense tables, a five-minute session on a phone.
3. **Feel like a group chat.** The reason you open it on a Monday is not your club — it is that Dan lost to an AI team and Priya went top. The UI has to make other people present without a chat box.

Every decision below is downstream of that tension.

## 2. Art direction

**"Floodlit broadcast, printed programme."** Dark first, because a management game is played at night, on a phone, in bed. Paper tones carry the editorial voice. One accent — a floodlight lime — is used as a measurement, not as decoration.

The direction changed once, and the change is worth recording. The first pass was *programme only*: a fanzine that got funded, with the dashboard as its centre of gravity. It read as a well-made admin tool. A football game is not judged on its tables — it is judged on whether the eleven look like people and whether a goal lands like a goal. So the programme voice stayed (display type, mono data, paper restraint) and the **broadcast** layer was added on top:

| Layer | What it is | Where it shows |
| --- | --- | --- |
| Identity | A face per player, a badge per club, a kit that is contrast-checked | Header, hub, squad grid, goal graphic, transfer market |
| Broadcast | Score bug, live ticker, momentum strip, goal lower-third, camera lean | Match screen |
| Programme | Condensed display type, mono figures, hairline rules, print restraint | Everywhere else |
| Strategy | The same dark ground, one lime accent, no card soup | League, table, transfers |

**Anti-references:** Football Manager (spreadsheet grey), Top Eleven (cartoon 3D), the dark-blue SaaS dashboard every sports app defaults to. The EA FC reference is deliberate and narrow: it is the *presentation grammar* — a score bug, a card, a goal graphic — not its gloss, its gradients-for-their-own-sake, or its monetisation.

**The one-line test:** if a screen could be a page in an admin tool with the colours changed, it is wrong. A face, a badge or a scoreline has to be doing the work.

## 3. Foundations

### Colour

Three ramps, 23 tokens, all named in `ui.pen` as variables.

| Ramp | Tokens | Use |
| --- | --- | --- |
| Ink | `ink-950` → `ink-600` | Backgrounds and surfaces. 950 is the page, 900 is a card, 800 is a raised control. |
| Paper | `paper-50` → `paper-500` | Editorial panels, programme screens, print-style records. |
| Signal | `lime-300/400/500`, `rust-400/500`, `sky-400` | Lime = action, progress, promotion. Rust = danger, relegation, money leaving. Sky = neutral information. |

Chalk (`#EDF3EC`) is the text colour, in three opacities: 100% headings and figures, 80% body, 60% labels and secondary data. Text is never pure white — it would break the paper feel.

There is no 40% step. It was in the first draft and it failed: 40% chalk on `ink-900` measures 3.52:1, under the 4.5:1 WCAG AA floor for the 8–9px mono labels it was carrying. The three-step ramp is the fix, and `chalk-faint` was lightened from `#5C7266` to `#7C8F83` (3.52:1 → 5.31:1 on `ink-900`, 4.54:1 on `ink-800`).

**Contrast is a build check, not a taste call.** Every text node in `ui.pen` is verified by walking its ancestor fill chain, compositing alpha over `ink-950`, and comparing against AA (4.5:1 normal, 3:1 for ≥24px or ≥18.66px bold). Current state: 1,423 text nodes across all 25 frames, 0 failures (excluding the 22 pitch shirt numbers, which the exception below describes). The React prototype is audited the same way in the browser, live, including during a match: 0 failures on Hub, League, Squad, Table, Transfers and the match frames.

The checker has one deliberate exception. A shirt number in the 2D match sits on top of a sibling ellipse (the shirt), not on a container fill, so a pure ancestor walk sees the pitch underneath and reports a false failure. The audit therefore accepts a same-parent ellipse that geometrically contains the text and stops there. All 22 numbers are verified to sit inside their shirt ellipse, and the two real ratios are ink-900 on lime-400 = 14.07:1 and on paper-200 = 14.18:1.

A second, subtler blind spot: text inside a component instance is invisible to a plain `Get` walk, so nav labels were audited once as if they did not exist. One screen had the "Match" tab painted in ink on a transparent background — an invisible tab — and every audit passed. Overrides now get their own check across all eight desktop navs: exactly one active tab, ink on lime for the active one, 60% chalk everywhere else. The same audit caught two mobile tab bars where the League tab had been duplicated from Home — right icon slot, wrong glyph, wrong label — and a third where two tabs were highlighted at once.

**Rule:** lime never fills more than ~5% of a screen. On the hub it appears on the primary button, the current league position, positive numbers, the carrier's ring and the scoring side of a goal. Nowhere else.

### Kits and shirt numbers

A generated kit is a hue plus two tones, and the tones are not free choices. A club's hue is hashed from its id (so a club keeps its colours forever), the shirt is `hsl(h 50% 27%)` and the trim `hsl(h 68% 68%)`. That pair is the only lightness combination tried where **both** pairings clear 4.5:1 across all 360 hues: chalk on the shirt, and ink on the trim. At 50%/30% the pale hues failed ink-on-trim; at 45%/72% the saturated blues failed chalk-on-shirt. The pair is a contrast constraint that happens to look like a kit, which is the right order.

The shirt number does not assume one ink. `readableOn(colour)` returns ink or chalk by measured relative luminance, because a fixed chalk number measured 1.95:1 on the pale trim of the away kit. Every number on the pitch, on a card and in the header now uses it.

### Type and motion budget

Motion is presentation, not decoration, and it has a budget:

| Motion | Where | Why | Cost |
| --- | --- | --- | --- |
| Digit pop | Score changes | The eye must find the score before the ticker | 180ms, transform only |
| Lower-third slam | Goal | Names the scorer while the net is still shaking | 380ms, once per goal |
| Confetti | Goal, your side only | Reward with a ceiling; opponent goals get the graphic, not the celebration | 1.4s, ≤28 pieces |
| Camera lean | Match, continuous | ±4px tied to ball x; sells depth without a 3D pitch | free, transform |
| Card rise | Squad, market | Establishes reading order down a grid | 260ms, staggered 24ms |
| Sweep | Primary button hover | Confirms the one action on screen is live | 600ms, hover only |
| Glow pulse | Active nav, live dot | State, not emphasis | 2.4s loop |

Every one of them is disabled under `prefers-reduced-motion: reduce`, and none of them are load-bearing: the score is in the DOM, the goal is in the text, the ball position is the model. A player with motion off gets the same information one frame sooner.

### Typography

| Role | Face | Why |
| --- | --- | --- |
| Display | Barlow Condensed 600/700 | Matchday programme voice. Tight, tall, uppercase for headlines, negative tracking at large sizes. |
| UI | Instrument Sans 400/500/600 | Body copy and labels. Optimised small, humanist, not corporate. |
| Data | JetBrains Mono 400/600 | Every number. Tabular, so league tables and scorelines never shift. |

Scale: 236/148/96 display, 68/62/54/46/40/34/30/24/22 section headings, 16/15/13/12.5/12/11.5/11/10.5 body, 13/11.5/10.5/9.5/9 data. Nine pixels is the floor, and it is only used for mono labels carrying no decision — never for a number you have to read to act.

Data text is *always* mono, *always* right-aligned in tables, *always* tabular. This is the single rule that makes the product feel engineered rather than themed.

#### The table rule (learned the hard way)

The first build of the league table was ragged: columns wandered row by row, numbers jittered, the header did not line up with the body. The cause was `text` nodes defaulting to `textGrowth: "auto"`, which ignores `width` and sizes to content — so every row negotiated its own column widths.

A table is only a table if **the header and every row are the same grid**:

1. One width per column, declared identically on the header cell and on all body cells of that column.
2. `textGrowth: "fixed-width"` on every cell, always. Without it the width is a suggestion.
3. One uniform gap on the row frame (`10px` in the league table), so column x-positions are the running sum of widths plus a constant, not the sum plus drifting gaps. Never mix gaps.
4. Exactly one `fill_container` cell per row — usually Club or Player name. Everything else is fixed. Two flexible cells and the columns re-negotiate.
5. Numbers right-aligned (`textAlign: "right"`), labels left. A right-aligned number in a fixed column is what makes a stat column readable down its length.

The league table's grid, as built: `Pos 44 · Club fill · S0–S3 44 each · S4–S5 52 each · GD 56 · Pts 60 · Form 104`, with 20px side padding and a 10px row gap. Squad and transfers follow the same pattern with their own columns. A build check compares the child signature (name, x, width, textGrowth, textAlign) of every row in a table against the header; any deviation is a bug, not a style choice.

### Spacing, radius, elevation

- **Spacing:** 4px base — 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius:** 8 controls, 14 cards, 18 major cards, 24 sheets, 999 pills.
- **Elevation:** one shadow only, a lime-tinted floodlight behind the active surface. Everything else is separated by 1px hairlines at 8% chalk. No drop shadows anywhere.

## 4. Components

Fifteen reusable components, instanced across the twelve `.pen` screen frames and the six React screens. Defined in `ui.pen` (Components / Library) so a change propagates. The canvas and the prototype now carry the same set: the badge, the face and the player card exist in both.

| Component | Notes |
| --- | --- |
| `Button / Primary` | Lime pill, ink label, arrow icon. One per screen. |
| `Button / Ghost` | Hairline outline, chalk label. Secondary actions. |
| `Button / Icon` | 40px circle, ink-800. Notifications, more, close. |
| `Pill / Status` | Dot + mono caps. Used for "IN PLAY", "MATCHDAY 32". |
| `Card / Base` | Card shell with a hairline header. All panels derive from it. |
| `Badge / Club` | Shield from the club's own colours + pattern + initials; a licensed crest replaces it. 52px base, instanced 44 → 22px. |
| `Player / Face` | Deterministic portrait from the player id; a licensed cut-out replaces it through the same component. 56px base, instanced 80, 60, 30 and 26px. |
| `Player / Card` | Rating, real position, face, name, six attributes. Gold/silver/bronze by ability. 172px base, stretched by its grid column. |
| `Score Bug` | Two badges, two codes, score. Anchors the match frame. |
| `Goal Graphic` | Lower-third: GOAL, scorer's face, name, minute, crest. |
| `Stat Tile` | Label + value. Top bar money, week, board confidence. |
| `Form Pip` | 14px result chip, W/D/L with three states at 2px gap. |
| `Tab` | Icon + label pill, filled when active. |
| `Meter` | Two-value comparison bar with numeric ends. Match preview. |

**Navigation:** six tabs in the React prototype and in the canvas — Hub, League, Match, Squad, Table, Transfers — with the active tab underlined in lime and a lime-tinted glow, not filled. The `.pen` desktop frames carry the same order and the same words as the prototype. The phone tab bar is five tabs (Hub, League, Squad, Table, Transfers) because Match is entered from the fixture, not from the bar; it follows the same vocabulary and keeps League second.

**Crests:** the `.pen` rounded square with a stripe and a three-letter code was a placeholder and has been superseded. A club now gets a **shield** built from its own two colours with one of five patterns (band, stripes, halves, chevron, hoops), a trim edge and its initials — and a real crest image when the dataset provides one. The component takes both, so a screen never knows which world it is in. All 40+ badge instances on the canvas are painted per club.

**Faces:** the single highest-leverage piece of the game-feel direction. `appearanceOf(playerId, age)` derives skin, shade, hair colour, one of seven hair styles, one of five beards, brow shape, head width, eye colour and a small quirk, all from a hash of the id — so the same man has the same face on the hub, in the card grid, on the pitch and in the goal graphic, across reloads and devices. Age changes the look (veterans lose the hairline and keep the beard), which is the cheapest way to make a squad feel like it has a history. A licensed photo wins whenever one exists, and the drawing is the fallback rather than the only source.

## 5. Screens

### Desktop (1440×1024)

**02 — Hub (was: Dashboard).** The default state, rebuilt as a fixture rather than a dashboard. A floodlit hero tinted by *both* clubs' colours: next fixture, both badges at 64px, both key players' faces, position and squad rating on each side, attack/defence chips between them, then one physical **Kick off** button, "Simulate season", and a single attack-v-defence meter. Under it, a meta strip: form pips, squad rating and size, gate price and capacity, balance. Then the four key men as player cards, the mentality selector (the three options are glyph-coded ◤ ◆ ◥ so the choice reads at a glance), and the last result with faces on the goalscorers.

Why this order: the fixture is the only thing you can act on, so it is the largest object. The result sits directly beneath it because that is the consequence of the last action. Mentality comes after the result, because you change it *because* of what happened. What changed from the dashboard version is hierarchy, not information — the same numbers now have a face and a fixture around them.

**06 — Match, live.** The screen the game is sold on, framed as a broadcast. A **score bug** with both badges, three-letter codes, the score (digits animate on change), the clock, a 1H/2H/FT flag and a momentum strip that leans toward whoever is on top. A crowd-noise band behind the pitch, a camera that leans a few pixels with the ball, mown stripes, full markings — touchlines, halfway, centre circle and spot, both penalty and six-yard boxes, penalty spots, D-arcs, corner arcs — and a **meshed net** behind each goal line so a goal is a ball crossing a line into a net, not a ball stopping on grass.

Twenty-two player tokens at 22×26: shadow, head, shoulders, mono shirt number. The number's ink is chosen from the shirt colour (ink on a pale trim, chalk on a dark shirt) because a fixed ink measured 1.95:1 on the away shirt. The carrier gets a lime ring and a chevron; the ball is an inline SVG football with a centre pentagon and five rim panels, a shadow that shrinks and fades as it lifts, and a trail.

On a goal minute: the net flashes, a **GOAL** slam appears, and a full-width lower-third names the scorer with his face, his crest and the minute — driven by `frame.celebration`, i.e. by the ball being physically inside the net, so it cannot fire early or be missed. Below the pitch: a live ticker ("ASH passing", "UPP shooting"), possession and territory bars counted from the model rather than faked, and a commentary feed. Every Ashcombe goal is lime; the opponent's is neutral, because the accent measures *your* side.

**03 — Squad.** A grid of player cards, because a squad is a set of people. Each card: ability as the largest figure, real position (RB, CAM, ST — not just DF), face, name, six attributes, gold/silver/bronze frame by ability, and a club-colour wash keyed to the badge. Selecting a card opens an inspector at poster size: a large portrait, attribute bars, a development block with the ceiling, wage, value, morale. The sortable list view is one toggle away for wage comparison. Both views exist in the prototype; the canvas draws the grid with the toggle in the header, because the grid is the argument.

**04 — Table.** The editorial screen, and the one where "clean" was the whole brief. Badges in the club column, a fixed column rhythm, mono tabular figures right-aligned, one lime row, zone markers as a hairline on the left edge (lime promotion, faint lime play-offs, rust relegation) rather than tinted cells so it survives being read on a phone in a pub. A legend and a swipe hint close it.

**05 — Transfers.** The market as cards rather than rows: face, rating, real position, six attributes, fee and wage, with a disabled/`Too dear` state that explains itself. A balance readout sits in the header because the decision is always "can I". The stadium upgrade is the same screen's second act.

### The friend league screens

**02 — League hub.** The screen the game is actually sold on. Header carries the league name, the invite code and the window state (matchday, manager count, deadline). Left: your pick — one segmented control, because mentality *is* the ready signal — and two actions, "Lock in & play matchday" and "Close window (auto-sim)". Right: a readiness list naming who has picked and who has not. Below: the friend table (tier, then position), head-to-head against each rival, honours, and the caretaker rule spelled out.

Why your own row is highlighted in the friend table rather than the division table: at this point in the product the question you open the app with is "where am I against my friends", not "where is my club". The division table is one tap away and stays neutral.

**03 — League lobby.** Pre-season, six of eight seats filled. Every claimed club keeps its squad, balance and history; open seats become AI clubs if nobody takes them. The right rail is the invite card — code, copy, WhatsApp/SMS/email — plus house rules the commissioner set (window length, pace, mentality-only line-ups, transfer scope, takeover approval). The invite-first-season-free model is stated here in one line, not buried in a store page.

**04 — League rivals.** The rivalry, not the division. A table of P/W/D/L/GF/GA/PTS plus the last meeting and its scoreline, limited to managers. Rivals you have played rank above rivals you have not, because a head-to-head table that opens with five blank rows tells you nothing. A foot line states the rule: only matches between managers count.

### Mobile (390×844)

**07 — Matchday.** Thumb-reachable: the crest, the next fixture with both badges, one full-width **Kick off** button, mentality as a three-way glyph control, form, then the table around you. Everything above the fold is either context or the action. On the phone the fixture hero drops the two key-player faces first (they are the widest object) and keeps the badges and the button; the faces return on the full-time reward screen.

**08 — Full Time.** Score at 96px — the largest type in the product, on purpose. Stats as split bars, goal events, player of the match, then Continue. This is the reward screen; it should feel like a result, not a report. It shows the same 2–1 over Uppermill as the live screen, with the numbers reconciled to 58/42, 11/7, 5/3, 1.6/0.9 so a player moving from desktop to phone never sees two different matches.

**09 — Squad (phone).** A two-column grid of player cards, because a face at 56px is still legible and a list of twenty rows on a phone is a scroll tax. The list toggle survives for wage comparison. The card is the unit at both sizes: the earlier "one line per player, no cards, no avatars" rule was correct for a dossier and wrong for this product — a squad screen without faces is the exact dashboard feeling the direction moved away from.

**13 — Mobile League.** The async window on a phone, which is the only place it matters: pick a mentality, see "4/6 ready", leave. The header states managers, matchday and readiness in one mono line; the fixture is the largest object after it. Reactions are pre-set chips, not a text field. A league that needs a keyboard to be fun has already lost.

**Mobile rules:** 44px minimum touch targets, bottom tab bar (never a hamburger), content padding 20px, no horizontal scroll anywhere, one primary action per screen. The live match on a phone is a reduced pitch in landscape or a possession-and-momentum view in portrait — the token model survives, the 1012px pitch does not.

### The 2D match model

The pitch view in the React prototype (`src/engine/pitch.ts`) is not a video and not a canned loop. It is a pure function of the match result and the clock:

`samplePitch({ result, minute, seed }) → 22 tokens + ball + trail`

**The ball is a script, and the players follow it.** One deterministic script of *beats* — kick-off, carry, pass, shot, restart — is built per `(result, seed)` and cached; the clock interpolates it. Each beat owns an explicit `from` and `to` point taken from formation anchors, so the ball's path cannot be circular with the players' positions. This is the inversion that made the picture work: the ball is not something the players happen to nudge, and the players are not a decoration around a roaming dot.

- **Continuity by construction.** A beat starts wherever the previous one ended; only a genuinely dead ball (kick-off, restart, a shot squeezed in behind a goal) may set an explicit start, and those beats carry `dead: true` so the renderer cuts rather than glides across them.
- **Players are derived from the ball, and only from the ball.** Every token is its own formation anchor plus a small, role-weighted lean toward the ball; nobody is ever pinned to it. That single rule is what makes the whole picture continuous: if the ball does not jump, no player can jump either. Pinning the carrier — and releasing him when possession was re-attributed — produced a 180px token hop in a single 70ms frame while the ball glided smoothly, and it was only found by measuring token deltas in the browser.
- **Duration comes from distance.** The ball has one speed (`PASS_SPEED`), so a pass of forty metres takes longer than a square ball of five. A fixed beat length is what made every move look equally laboured and every short pass look frozen.
- **Goals have a time budget.** The minutes between one goal and the next are split between the celebration, the restart, the build-up and the shot *in proportion to the gap*: two goals a minute apart get a place-kick, two goals ten minutes apart get a move. The ball crosses the line on the scorer's minute, then settles into the net — a shot is modelled in two phases (to the line, then into the mesh) so "the ball is in the goal" and "the scoreboard changed" are the same instant.
- **The ball is a football.** Inline SVG, fifteen pixels: a radial sheen, a centre pentagon and five rim panels, a dark outline. A ground shadow shrinks and fades as the ball lifts, it rides up to 13px and scales 1.35× at the top of a lofted pass, and a ghost trail samples where it just was.
- **Goals look like goals.** The goal mouth is drawn behind the line with a crossed mesh net; a lime glow and a "Goal — Ashcombe" pill fire at the scoring end only; the ball rests in the net until the restart.
- Every movement is a seeded drift, so the same minute always renders the same frame. Replaying a match replays it identically, which matters when the result is what you are trying to explain.
- A collision pass separates tokens in token-ellipse space (radii 0.034 × 0.058 of the pitch), so two players never occupy the same pixel. The lean is deliberately small (0.03 for the keeper, 0.05 at the back, 0.08 further forward) — a strong pull drags five teammates onto the same square metre and the separation pass then has to shove them apart in one frame, which is a visible hop.
- The UI ticks half a match minute every 70ms, so ninety minutes play out in about twelve seconds, with 1×, 2× and 4× speeds, pause, and skip-to-full-time. The pitch is the same at every speed; only the clock moves.

### The friend league (the multiplayer heart)

The single-player career is the tutorial. The product is six friends in one division.

**The model.** A friend league is an overlay on a normal division: six humans claim six clubs, the remaining twelve (or fourteen) are AI. Nothing about the table is invented — the friends are simply the clubs with a person behind them. The league is stored separately from the career save (`pyramid.league.v1`), so a league can outlive a career, be rejoined, or be restored after a wipe.

**The window, not a schedule.** There is no kick-off time. A matchday opens with a deadline (default 24h). Each manager submits one mentality, and submitting *is* the ready signal — there is no separate "ready" button to forget. Three outcomes:

| State | Who acts | What happens |
|---|---|---|
| All six have picked | the league | resolves immediately, deadline ignored |
| Deadline passes | the league | non-submitters are auto-simmed at balanced, matchday advances for everyone |
| One manager stops playing | the caretaker rule | after 3 consecutive misses the club goes `idle`; a new manager (or a returning one) can take it over, resetting the miss count |

Results stay hidden until the window locks. That is the whole fairness argument: nobody can read the week's scores and then choose a shape. It also means the honest failure mode — a friend who is away — costs that friend a matchday, not the group's season.

**The league is people, not a division.** Clubs are promoted and relegated across seasons, so the friend table cannot be a division table. The friend standings rank by tier first, then position: finishing 3rd in tier 5 beats winning tier 6. A champion is whoever ends highest up the pyramid, and honours record tier alongside it so a past win cannot be devalued by later relegation.

**Head-to-head is private.** Only matches where both clubs belong to managers are archived (`recordMatchday`). A 6–0 win over an AI club is worth three points in the division and nothing in the friend rivalry. The H2H sidebar ranks played rivals by points won against them and puts never-met rivals last, so the table reads as a story rather than an alphabetical list.

**No free-text chat at launch.** Result-day talk is a small set of pre-set reactions ("robbery", "bottle job", "xG FC") attached to a result. This is a deliberate scope cut: free text in a game with a PEGI 3 rating means moderation cost, reporting flows and liability that a £6.99 one-off cannot carry. Pre-set reactions deliver the Monday-morning ritual at zero risk.

**What the server would cost.** A league of six writing one pick and reading one result per matchday is six small writes and a fan-out read — a single Postgres row per member per matchday plus a results table. At 12,000 sales with, say, 40% of buyers in an active league, the load is about 5,000 leagues × 38 matchdays × 6 members ≈ 1.1M rows per season. That is a commodity database, not a real-time game server: no websockets required if the client polls the window state when opened. This is why multiplayer can ship as part of a one-off purchase rather than a subscription.

**Open decision:** the first season of a league is free to create and join, with subsequent seasons gated behind the owner's purchase. It keeps acquisition frictionless, but it is the one place where multiplayer could be monetised without splitting the friend group.

### Real clubs, real players — and the wall

The game can run two worlds, and it must be able to tell you which one you are in.

**The invented world still exists, and it is the fallback.** Twenty clubs, invented names, generated faces, generated badges, generated kits. No licence, no attribution, no takedown risk. It is what you get when the snapshot is absent, malformed or unreachable, and it is not a placeholder — it has to be good enough to sell on its own. Every screenshot in this dossier was drawn in it, before the real snapshot existed.

**The open snapshot is what ships.** `scripts/fetch-wikipedia.mjs` reads the National League North member clubs, each club's `{{Fs player}}` squad template, and Wikidata for dates of birth and photographs, then writes `public/dataset/football.json`. That file is committed, so a clean install starts on 22 real clubs and 519 real players. It needs no key, which makes it the path a designer can actually run. The fetch is split into `fetch-wikipedia.mjs` (network, cache, throttling) and `wikipedia-parse.mjs` (pure string transforms), because every real-data defect so far has been a parser bug — a wikilink split at its pipe, a loan club read as a player — and those need no HTTP request to reproduce.

**The licence boundary is not one line, it is three.** This is the part worth being precise about, because "it's on Wikipedia" is not a licence:

- **Names, numbers, positions, birthdays** are facts and carry no copyright.
- **Photographs** come from Wikimedia Commons only, under CC BY-SA, CC0 or public domain, with the author and licence stored per player. The credit travels with the portrait (`Player.photoCredit`) and renders as both a footer line and the image's `title` — a requirement, not a courtesy.
- **Club crests are fair use on Wikipedia and are never fetched.** A real badge is a trademark licensed club by club; reproducing it because a fan uploaded it is not a licence. The generated shield is therefore not a stopgap, it is the correct answer at this price point.

**Identity is the design problem, not the fetching.** A squad list gives a name, not a person. The fetcher's first version attached a 43-year-old artist's portrait to a defender. The fix is three gates: resolve through the squad template's article link rather than the display name, refuse to look up an unlinked bare name at all, and require Wikidata to record the person as a footballer. Each gate exists because of a specific wrong answer, and the fetcher reports its rejections instead of hiding them.

**Ratings are derived, and the derivation is visible.** Neither provider returns a 1–99 ability. `abilityFor(rank, squadSize, age, baseline)` maps squad order, age and the division's baseline into a rating — first-choice keeper is better than fourth-choice, a 34-year-old is discounted against a 24-year-old, a tier-6 squad sits below a tier-5 one. It is a heuristic, it is documented in the code, and the README says so. Pretending a real player has an official rating would be the dishonest version of the same feature.

**The fallback is total.** `loadDataset()` returns `null` on 404, on malformed JSON, or with no network. Every screen then renders the invented world, and a toast says which world is loaded. The game never half-loads: a real crest with a generated face, or twenty real names with invented ratings, is a licensing and a quality bug at once. The refusal is the feature — the fetchers drop a club with fewer than eleven players, drop a division that falls below eighteen, and drop a club to keep the count even, each with a warning naming the club.

**What a real-data mode still needs before shipping:** a licence for crests and player likeness in each territory, and a commercial football API if the data must be current rather than a curated snapshot. None of that is a design problem, and none of it should block a launch built on the invented world or on the open snapshot.

### Data, tests and what "verified" means here

The engine is a pure module and it is tested as one: 175 tests across 13 files, the interesting ones being the invariants rather than the examples.

- **Simulation is calibrated, not asserted.** 44.9% home / 22.8% draw / 32.4% away, 2.89 goals a game, measured over a large sample. A test that checked one scoreline would pass while the league fell apart.
- **The ball model has its own tests.** Continuity between beats, dead-ball flags, pass distance versus duration, the goal crossing the line on the scorer's minute, and no token moving more than a few pixels in a frame — the last one is the regression test for the 180px hop.
- **The friend league is a state machine with a feature file.** `friendLeague.feature` writes the window, readiness, caretaker and archive rules as Gherkin; `friendLeague.ts` implements them; the tests run the feature.
- **Identity is deterministic by contract.** `appearanceOf(id)` must return the same face on every screen and every reload — tested by comparing the same player's face across three call sites.
- **The licensed path is tested without a key.** A fixture snapshot is fed through `fromSnapshot` and asserted on positions, keeper guarding, derived wages and values; `loadDataset` is asserted to return `null` for 404, for malformed JSON, for an offline network, and for a single-page host that answers the missing file with `index.html` and a 200.

`tsc --noEmit` and `vite build` are part of the check, and so is a browser audit of the rendered DOM: overflow at 390px, tap targets under 44px, and the contrast walk over live text. Layout claims in this document are arithmetic or DOM measurements, never a glance at a screenshot.

## 6. The loop the UI serves

`Read → Choose → Play → React → Advance`, five steps, one decision per turn.

The UI exists to make that loop faster, or to make the next turn mean more. Concretely:

- **Read:** table, form and money are visible on one screen, no navigation.
- **Choose:** mentality and lineup are one tap each.
- **Play:** pressing Kick off drops you onto the pitch and the 90 minutes run in about twelve seconds at 1× — or four at 4×, or zero if you skip. The match is a thing you watch, not a spinner.
- **React:** the board, the dressing room and the press produce consequences in plain language.
- **Advance:** a week passes, the table moves, the fixture card updates.

**Test:** if a player cannot finish a season in two hours on a phone, the loop is too slow.

**Multiplayer variant:** `Read → Pick → Lock → React → Talk`. The same five beats with the play step replaced by a decision everyone has to make before anyone sees anything. It is slower per turn and enormously stickier per season, which is why the league screen exists at all: it is the retention system, not a mode.

## 7. Ideas worth building

Three systems, in order, that would make this a game rather than a simulator.

**01 — The club has a memory.** Every season writes into an almanac: the 4–0 in October, the striker who left for £40k and came back to haunt you. Commentary and news are generated *from that record*, so the feed is about your club and not generic filler. Rivalries grow from results, not from a table.

**02 — Crisis is the game.** Non-league football runs on volunteers, a chairman with a day job and a pitch that floods. A bad November is a cashflow problem that costs you your best defender, not a losing streak. Board confidence splits across money, league position and mood. A winding-up order is a real fail state.

**03 — The 92 is the ladder.** Seven tiers, one continuous save, twenty seasons deep. Promotion is not a reset: same club, bigger stand, better scouts. Clubs and players come from a consistent clean-room canon.

## 8. Where it goes

| Phase | What | Cost | When |
| --- | --- | --- | --- |
| Now | Playtest with 10–20 UK players (non-league Discords, FPL communities), organised as 3–4 friend leagues of six. Measure seasons completed *per league*, not sign-ups. Kill criterion: under 30% of leagues reach season two. | £0 | Weeks 1–4 |
| Next | Vertical slice: 40 fictional clubs, six divisions, canon bible, club creation, final art and sound — plus the league server: accounts, invites, window resolution. | £8–12k | Months 2–4 |
| Then | Launch premium at £6.99 — iOS, Android, Steam, one codebase. | £25–40k | Month 6 |

**Model:** £6.99 once, no ads, no energy timers, no loot boxes. Cosmetic kits and a level editor later if the base sells. Break-even ≈ 3,600 copies; year-one target 12,000.

**Regulatory position:** PEGI 3. No paid random items means no ASA loot-box disclosure obligation and no gambling-adjacent mechanics to defend. This is a design constraint, not an afterthought — it is why the model is premium.

**What could kill it:** licensing (avoided by design — no real clubs, players or badges), depth (FM has thirty years of data; we compete on tone and time-to-fun), retention (season must finish under two hours), reviews (one bad launch build is fatal on Steam).

## 9. Decisions needed

1. **Premium or free?** Premium keeps the design honest and avoids loot-box regulation. F2P buys reach and demands live ops. Multiplayer makes this sharper: a friend group is only as monetisable as its least-committed member.
2. **Phone or desktop first?** The mockups work at 390px. If the phone is the product, every screen must survive one thumb. The async window argues for phone-first more strongly than the single-player game did.
3. **How deep is the canon?** 40 clubs and 600 players is a weekend. Six divisions is a month. Decide before anyone draws a badge. A friend league needs at least one full division of canon on day one.
4. **Who plays it first?** Ten non-league supporters will tell you the truth in an hour. A thousand wishlists will not. Better: five friend groups of six, because that is the unit the product is actually sold in.
5. **One division or the whole pyramid at launch?** One division gets a friend league shipping months earlier. The pyramid is the promise, but it doubles the canon and the promotion logic. The rules are written for either.
6. **League size and window length.** Six friends in an 18–20 club division, 24h windows, three matchdays a week. More friends means more waiting; a shorter window means more auto-sims. This is tuning, not architecture, but it decides whether a league survives its first month.

## 10. The seeded state

All screens show one moment of one save: **Ashcombe Rovers, National League North, season 2026, 31 of 34 games played, 9th on 43 points.** The live match is the same save on matchday 32, at home to Uppermill County.

The numbers are internally consistent, not invented per screen:

- 18 clubs, 34-round season, 31 played each. That is 279 matches. Wins 202 = losses 202, draws 154 (even), goals for 747 = goals against 747. Goal differences sum to zero.
- Ashcombe: 11W 10D 10L, 43–42, +1, 43 pts. 7th (Netherby, 46) is the last play-off place, so the gap is 3 points with 3 games left — which is what the table screen's "race" card claims.
- The hub's last result is the 1–2 win at Thornbury. The next fixture is Uppermill at home, and that is the match the live screen and the phone's full-time screen show: 2–1 at 74', 2–1 at full time. Goals 46' Pryce (UPP), 56' Sutcliffe (ASH), 69' Underwood (ASH); possession 58/42, shots 11/7, on target 5/3, xG 1.6/0.9. Every screen quotes the same four stat pairs and the same three scorers.
- The win takes Ashcombe to 46 points from 32 games, one clear of Marchwood — which is what the full-time reward line says. The table still shows the pre-match state.
- Finances on the hub balance: gate £182,400 + prize £46,000 − wages £198,600 − running £31,200 = −£1,400.
- Player season stats never exceed the team's 31 games.

One deliberate divergence: the mockup uses an **18-club division (34 rounds)** so the whole table fits one desktop screen with room for the side rail. The prototype engine seeds **20 clubs (38 rounds)**. Pick one at implementation — 20 is the better game, 18 is the better poster. Everything else in this dossier scales either way.

The friend league adds a second divergence worth naming: the mockup's canon is a **pyramid**, with friends in different divisions (Tom's Netherby 7th in tier 5, Callum's Bramhope relegated from tier 6). The prototype simulates a single division with six friends inside it. Both are legitimate launch scopes — one division is a much cheaper first season and still delivers "champion of your friends" — but the pyramid version is what the friend table's tier-first ranking exists to serve, so the rules are already written for the bigger game.

**Consistency is a fixture, not a number.** The first version of these screens quoted the Thornbury win three times but showed Uppermill as the next fixture, because the match screen had been drawn against the wrong opponent. A dossier that a reviewer can audit has to agree on *which match is happening* before it agrees on the stats. The rule now: one fixture, named once, and every screen either shows it live, its full-time state, or the pre-match state explicitly labelled as such.

If any single figure changes, the rest has to be re-derived. That is the cost of showing a real state instead of lorem ipsum, and it is worth it: a reviewer can audit the table in ten seconds and trust the rest.

## 11. Known limits of this dossier

- **The friend league is modelled, not networked.** `friendLeague.ts` encodes the window, readiness, caretaker, archive and friend-champion rules and is tested; the app runs five simulated rivals on one device. There is no server, no account, no real invite link. The `.pen` lobby states the invite model the product would use.
- **Only one division is simulated.** Friend clubs are re-seated by identity each season, so a friend cannot actually be promoted out of your division in the prototype. `friendStandings` already ranks by tier, which is why the `.pen` canon can show Tom's Netherby above Gio's Ashcombe — the pyramid is the missing engine piece, not the league rule.
- **The `.pen` trails the prototype on motion only.** The canvas now carries the identity layer — shield badges painted per club, deterministic portraits on the squad rows, the inspector, both fixture sides on the hub and the scorer's lower-third, and the player card grid on both the desktop and phone squad screens. What it cannot carry is the animation: the live match is a vector still with the ball, the 22 tokens and the meshed goals, while the beat-script ball, the digit animation and the confetti live in React. `.pen` has no timeline, so a moving pitch there would have to be a shader or a sequence of frames — neither is worth it before the loop is validated.
- The face has one drawing with per-instance overrides for skin, hair, beard and shirt. The prototype's seven hair styles, five beards and quirks are not all drawn on the canvas; the canvas shows the range, the prototype owns the variation.
- **The open world is proven end to end; the licensed one is not.** `data:fetch:open` has been run against the live APIs and produces 22 National League North clubs, 519 real players and 61 Commons portraits, and the running app has been walked through hub → squad → table → match on that snapshot. The API-Football path still has no key in this environment, so it is proven only against a fixture snapshot; a first real fetch could see field names drift.
- **Real crests are absent by licence, not by omission.** Wikipedia hosts club badges under fair use, so the open fetcher never downloads them and a real division plays in generated shields. Everything else about the identity layer — names, numbers, positions, ages, portraits — is real.
- **Photos are a minority of the squad.** 61 of 519 players have a Commons portrait. The rest fall back to the drawn face, which is why that fallback has to be good enough to sit next to a photograph in the same grid rather than reading as missing data.
- Screens show one state each. Error, empty and loading states are specified in copy but not drawn.
- No dark/light paper mode yet. The programme palette exists in tokens but the screens are all floodlit.
- The 2D match is deliberately legible, not realistic. Eleven tokens per side, no off-ball runs, no goalkeeper animation, no fouls. It communicates *shape and momentum*; it is not a simulation renderer. Anything more is a month of work that a playtest cannot yet justify.
