import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { ClubCrest, PlayerFace } from "@/components/Identity";
import { ballTrail, samplePitch, TOTAL_MINUTES } from "@/engine/pitch";
import type { Career, Club, MatchResult, Player, Scorer } from "@/engine/types";

interface Props {
  career: Career;
  result: MatchResult;
  onExit: () => void;
}

const TICK_MS = 70;

/**
 * Match minutes per clock tick.
 *
 * One minute per tick was the old model, and it is why the ball looked wrong:
 * a pass lasts under a minute of match time, so it began and ended between two
 * frames and the ball appeared to jump the length of the pitch. Half a minute
 * gives every pass and shot at least a few frames, and the whole match still
 * runs in about thirteen seconds at 1×.
 */
const MINUTES_PER_TICK = 0.5;

/**
 * The live match, presented as a broadcast.
 *
 * The pitch is still a pure function of `samplePitch(result, minute, seed)` — the
 * picture cannot disagree with the scoreline because both come from the same
 * MatchResult. What changed is the frame around it: a score bug with real badges,
 * a goal sequence with the scorer's face, and a touchline camera that reacts.
 *
 * Everything animated here is derived from the model, not sampled separately.
 * A goal celebration appears because the ball is in the net, not because a timer
 * said so.
 */
export function MatchScreen({ career, result, onExit }: Props) {
  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);

  const home = career.clubs[result.homeId];
  const away = career.clubs[result.awayId];
  const seed = useMemo(() => hashSeed(result), [result]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setMinute((m) => {
        if (m >= TOTAL_MINUTES) {
          setPlaying(false);
          return TOTAL_MINUTES;
        }
        return Math.min(TOTAL_MINUTES, m + MINUTES_PER_TICK);
      });
    }, TICK_MS / speed);
    return () => window.clearInterval(id);
  }, [playing, speed]);

  const frame = useMemo(() => samplePitch({ result, minute, seed }), [result, minute, seed]);
  const trail = useMemo(() => ballTrail({ result, minute, seed }), [result, minute, seed]);

  const score = scoreAt(result, minute);
  const finished = minute >= TOTAL_MINUTES;
  const clock = Math.min(TOTAL_MINUTES, Math.floor(minute));
  const events = result.events.filter((e) => e.minute <= minute);

  const possession = useMemo(() => possessionSoFar(result, minute, seed), [result, minute, seed]);
  const territory = useMemo(() => territorySoFar(result, minute, seed), [result, minute, seed]);

  const goal = useMemo(
    () => goalOnScreen(result, frame, minute, home, away),
    [result, frame, minute, home, away],
  );

  return (
    <div className="space-y-4" data-testid="match-screen">
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-pitch-950">
        {/* Stadium: a crowd band behind the pitch, then the floodlit surface. */}
        <div className="crowd pointer-events-none absolute inset-x-0 top-0 h-28 opacity-[0.18]" aria-hidden />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent"
          aria-hidden
        />

        {/* Broadcast control strip. */}
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className={clsx(
                  "absolute inline-flex h-full w-full rounded-full",
                  finished ? "bg-chalk/30" : "animate-ping bg-flare/70",
                )}
              />
              <span
                className={clsx(
                  "relative inline-flex h-2 w-2 rounded-full",
                  finished ? "bg-chalk/40" : "bg-flare",
                )}
              />
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-flare">
              {finished ? "Full time" : "Live"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-chalk/50">
              Matchday {career.week}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                aria-label={`Speed ${s}x`}
                className={clsx(
                  "rounded-md px-2 py-1 font-mono text-[11px] tabular-nums transition",
                  speed === s ? "bg-flare/15 text-flare" : "text-chalk/55 hover:text-chalk",
                )}
              >
                {s}×
              </button>
            ))}
            <button
              onClick={() => setPlaying((p) => !p)}
              className="ml-1 rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-chalk/60 hover:border-white/25 hover:text-chalk"
              aria-label={playing ? "Pause" : "Resume"}
            >
              {playing ? "❙❙" : "▶"}
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setMinute(TOTAL_MINUTES);
              }}
              className="ml-1 rounded-md border border-white/10 px-2.5 py-1 font-mono text-[11px] text-chalk/60 hover:border-white/25 hover:text-chalk"
            >
              Skip to full time
            </button>
          </div>
        </div>

        {/* Score bug. In a broadcast it is the anchor of the whole frame. */}
        <div className="relative px-4 pb-3">
          <ScoreBug
            home={home}
            away={away}
            homeGoals={score.home}
            awayGoals={score.away}
            minute={clock}
            finished={finished}
            momentum={frame.momentum}
          />
        </div>

        <Pitch
          home={home}
          away={away}
          frame={frame}
          trail={trail}
          homeGoals={score.home}
          awayGoals={score.away}
          minute={clock}
        />

        <GoalOverlay goal={goal} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-4">
          <Ticker frame={frame} home={home} away={away} minute={clock} goal={goal} finished={finished} score={score} />
          <div className="grid gap-3 sm:grid-cols-2">
            <StatBlock label="Possession" a={`${possession.home}%`} b={`${possession.away}%`} split={possession.home} home={home} away={away} />
            <StatBlock label="Territory" a={`${territory.home}%`} b={`${territory.away}%`} split={territory.home} home={home} away={away} />
          </div>
        </div>

        <aside className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
              <h2 className="label">Commentary</h2>
              <span className="font-mono text-[10px] tabular-nums text-chalk/50">{clock}′</span>
            </div>
            <ol className="max-h-[280px] divide-y divide-white/[0.04] overflow-y-auto" data-testid="commentary">
              {events
                .slice()
                .reverse()
                .map((event, index) => (
                  <li key={index} className="flex gap-3 px-4 py-2">
                    <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-chalk/50">
                      {event.minute}′
                    </span>
                    <span
                      className={clsx(
                        "text-[12.5px] leading-snug",
                        event.kind === "goal" ? "font-semibold text-flare" : "text-chalk/60",
                      )}
                    >
                      {event.text}
                    </span>
                  </li>
                ))}
            </ol>
          </section>

          {finished && (
            <button className="cta w-full" onClick={onExit}>
              Back to the hub
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The score bug.
 *
 * Badges, codes, score and clock in one bar — the shape every viewer already
 * knows how to read. The digit is keyed on its value so it animates when it
 * changes, which is the cheapest possible "this is live" signal.
 */
function ScoreBug({
  home,
  away,
  homeGoals,
  awayGoals,
  minute,
  finished,
  momentum,
}: {
  home: Club;
  away: Club;
  homeGoals: number;
  awayGoals: number;
  minute: number;
  finished: boolean;
  momentum: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/45 backdrop-blur-md">
      <div className="flex items-stretch">
        <TeamSide club={home} align="left" />

        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <span className="display w-7 text-center text-3xl leading-none tabular-nums sm:text-4xl" data-testid="live-score" key={`h${homeGoals}`}>
            <span className="animate-digit inline-block">{homeGoals}</span>
          </span>
          <span className="font-mono text-sm text-chalk/50">–</span>
          <span className="display w-7 text-center text-3xl leading-none tabular-nums sm:text-4xl" key={`a${awayGoals}`}>
            <span className="animate-digit inline-block">{awayGoals}</span>
          </span>
        </div>

        <TeamSide club={away} align="right" />

        <div className="flex shrink-0 flex-col items-center justify-center border-l border-white/10 px-3">
          <span
            className="font-mono text-[13px] font-bold tabular-nums text-chalk/85"
            data-testid="match-clock"
            aria-live="off"
          >
            {String(minute).padStart(2, "0")}′
          </span>
          <span className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-chalk/50">
            {finished ? "FT" : minute >= 45 ? "2H" : "1H"}
          </span>
        </div>
      </div>

      {/* Momentum: a thin strip under the bug, leaning toward whoever is on top. */}
      <div className="relative h-[3px] bg-white/[0.06]">
        <div
          className="absolute inset-y-0 bg-flare/70 transition-[left,width] duration-200 ease-linear"
          style={{
            left: `${50 + Math.min(0, momentum) * 50}%`,
            width: `${50 + Math.abs(momentum) * 50}%`,
          }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" aria-hidden />
      </div>
    </div>
  );
}

function TeamSide({ club, align }: { club: Club; align: "left" | "right" }) {
  return (
    <div
      className={clsx(
        "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 sm:gap-2 sm:px-3",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <ClubCrest
        clubId={club.id}
        name={club.name}
        colors={club.colors}
        short={club.short}
        crestUrl={club.crestUrl}
        className="h-7 w-7 shrink-0 sm:h-8 sm:w-8"
      />
      <div className="min-w-0">
        {/* A phone cannot hold two club names and a score. It holds the codes. */}
        <p className="display truncate text-[13px] leading-none tracking-wide sm:hidden">{club.short}</p>
        <p className="hidden truncate text-sm font-semibold leading-tight sm:block">{club.name}</p>
        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.16em] text-chalk/55 sm:text-[9px]">
          {align === "left" ? "Home" : "Away"}
        </p>
      </div>
    </div>
  );
}

/**
 * The pitch.
 *
 * Absolutely-positioned tokens, so the geometry is exactly what `samplePitch`
 * returned — no canvas, no layout rounding between the model and the picture.
 * `data-x` / `data-y` are on every token so a test can prove no player ever
 * leaves the grass.
 *
 * New here: a camera that nudges toward the ball by a few pixels, crowd haze at
 * the top, and a carrier marker drawn as a chevron rather than a ring so the man
 * on the ball is identifiable at thumbnail size.
 */
function Pitch({
  home,
  away,
  frame,
  trail,
  homeGoals,
  awayGoals,
  minute,
}: {
  home: Club;
  away: Club;
  frame: ReturnType<typeof samplePitch>;
  trail: ReturnType<typeof ballTrail>;
  homeGoals: number;
  awayGoals: number;
  minute: number;
}) {
  const camX = (frame.ball.x - 0.5) * -12;
  const camY = (frame.ball.y - 0.5) * -8;

  return (
    <div className="px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        className="pitch relative w-full overflow-hidden rounded-xl ring-1 ring-black/60"
        data-testid="pitch"
        data-celebration={frame.celebration ? "true" : "false"}
        style={{ aspectRatio: "956 / 664" }}
      >
        <div
          className="absolute inset-0 transition-transform duration-300 ease-out"
          style={{ transform: `translate3d(${camX}px, ${camY}px, 0) scale(1.02)` }}
        >
          {/* Mown stripes, so the surface reads as grass rather than a green box. */}
          <div className="absolute inset-0 flex" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={clsx("h-full flex-1", i % 2 === 0 ? "bg-white/[0.022]" : "bg-transparent")}
              />
            ))}
          </div>

          <PitchMarkings />

          {/* Ghost trail: where the ball just was, fading with age. */}
          {trail.map((p, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                width: 6 - i * 1.4,
                height: 6 - i * 1.4,
                opacity: 0.22 - i * 0.06,
                filter: "blur(0.4px)",
              }}
              aria-hidden
            />
          ))}

          {frame.players.map((player) => (
            <span
              key={player.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[70ms] ease-linear"
              style={{ left: `${player.x * 100}%`, top: `${player.y * 100}%` }}
              data-testid="pitch-player"
              data-side={player.side}
              data-number={player.number}
              data-ball={player.hasBall ? "true" : "false"}
              data-x={player.x.toFixed(4)}
              data-y={player.y.toFixed(4)}
            >
              <PlayerToken
                number={player.number}
                colour={player.side === "home" ? home.colors : away.colors}
                home={player.side === "home"}
                carrier={player.hasBall}
              />
            </span>
          ))}

          <Ball ball={frame.ball} lift={frame.lift} phase={frame.phase} dead={frame.dead} />
        </div>

        <GoalFlash frame={frame} home={home} away={away} />

        {/* Lower third: what the ball is doing, and the shape. */}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div className="rounded-lg border border-white/10 bg-pitch-950/85 px-2.5 py-1.5 backdrop-blur">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-chalk/50">
              {minute}′ · {home.short} {homeGoals}–{awayGoals} {away.short}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-tight text-chalk/75">
              {captionFor(frame, home, away)}
            </p>
          </div>
          <div className="hidden rounded-lg border border-flare/25 bg-pitch-950/85 px-2.5 py-1.5 backdrop-blur sm:block">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-flare/80">4–2–3–1</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The goal, as a broadcast graphic.
 *
 * Full-width lower third, the scorer's face, his name and the minute. It is
 * driven by `frame.celebration` — the minutes the ball is physically in the net —
 * so it cannot appear for a goal that has not happened yet, and it cannot be
 * missed for one that has.
 */
function GoalOverlay({ goal }: { goal: { scorer: Scorer; club: Club; player?: Player } | null }) {
  if (!goal) return null;
  const { scorer, club, player } = goal;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 motion-safe:animate-slide-left"
      role="status"
      data-testid="goal-overlay"
      data-club={club.id}
      data-scorer={scorer.playerId}
    >
      <div
        className="flex items-center gap-3 border-t border-white/15 px-3 py-2.5 backdrop-blur-md sm:px-5"
        style={{
          background: `linear-gradient(90deg, ${club.colors.primary}f2 0%, ${club.colors.primary}b3 45%, rgba(6,18,13,.92) 100%)`,
        }}
      >
        <span className="display shrink-0 text-2xl leading-none text-chalk/90 sm:text-3xl">Goal</span>
        <span className="h-8 w-px bg-white/25" aria-hidden />
        <span className="relative">
          <PlayerFace
            playerId={scorer.playerId}
            age={player?.age}
            name={scorer.playerName}
            photoUrl={player?.photoUrl}
            photoCredit={player?.photoCredit}
            colors={club.colors}
            number={player?.number}
            className="h-11 w-11 shrink-0 rounded-lg ring-1 ring-white/30"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight sm:text-base">{scorer.playerName}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/60">
            {club.short} · {scorer.minute}′
          </p>
        </div>
        <ClubCrest
          clubId={club.id}
          name={club.name}
          colors={club.colors}
          short={club.short}
          crestUrl={club.crestUrl}
          className="h-9 w-9 shrink-0 opacity-80"
        />
        {/* Confetti: four paper strips, CSS only. */}
        <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="animate-confetti absolute top-0 h-2 w-1 rounded-sm"
              style={{
                left: `${8 + i * 15}%`,
                background: i % 2 === 0 ? "#c8f751" : "#e8f2ea",
                animationDelay: `${i * 70}ms`,
                ["--drift" as string]: `${(i % 2 === 0 ? 1 : -1) * (10 + i * 6)}px`,
              }}
            />
          ))}
        </span>
      </div>
      <span className="sr-only">
        Goal for {club.name}, scored by {scorer.playerName} in the {scorer.minute}th minute.
      </span>
    </div>
  );
}

/**
 * The ball.
 *
 * A white disc with black panels is the only shape the eye accepts as a football,
 * so that is literally what this draws: an inline SVG with a centre pentagon and
 * five rim panels, clipped to the sphere. `lift` moves it up the screen and grows
 * it slightly while the shadow stays on the grass and shrinks — the cheap, correct
 * way to read height in a top-down view.
 */
function Ball({
  ball,
  lift,
  phase,
  dead,
}: {
  ball: { x: number; y: number };
  lift: number;
  phase: ReturnType<typeof samplePitch>["phase"];
  dead: boolean;
}) {
  // A placed ball is picked up and replaced, not rolled across the pitch. Rather
  // than hide it — it is still on the spot — the transition is cut for that one
  // frame, so it snaps instead of gliding the length of the field.
  const transition = dead ? "none" : undefined;
  const size = 15;
  const shadowScale = 1 - lift * 0.45;
  const spin = Math.round((ball.x * 720 + ball.y * 160) % 360);

  return (
    <>
      <span
        className="pointer-events-none absolute z-[9] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-black/50 blur-[1.5px] transition-[left,top,width,height,opacity] duration-[70ms] ease-linear"
        style={{
          left: `${ball.x * 100}%`,
          top: `${ball.y * 100}%`,
          width: size * shadowScale,
          height: size * 0.55 * shadowScale,
          opacity: 0.42 - lift * 0.18,
          transition,
        }}
        aria-hidden
      />
      <span
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-[left,top,transform] duration-[70ms] ease-linear"
        style={{
          left: `${ball.x * 100}%`,
          top: `${ball.y * 100}%`,
          width: size,
          height: size,
          transform: `translate(-50%, -50%) translateY(${-lift * 13}px) scale(${1 + lift * 0.35})`,
          transition,
        }}
        data-testid="pitch-ball"
        data-x={ball.x.toFixed(4)}
        data-y={ball.y.toFixed(4)}
        data-lift={lift.toFixed(2)}
        data-phase={phase}
      >
        <svg
          viewBox="0 0 32 32"
          className="h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,.55)]"
          aria-hidden
          style={{ transform: `rotate(${spin}deg)` }}
        >
          <defs>
            <radialGradient id="ball-sheen" cx="34%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#f0f3ea" />
              <stop offset="100%" stopColor="#93a394" />
            </radialGradient>
            <clipPath id="ball-clip">
              <circle cx="16" cy="16" r="14.6" />
            </clipPath>
          </defs>
          <circle cx="16" cy="16" r="14.6" fill="url(#ball-sheen)" />
          <g clipPath="url(#ball-clip)" fill="#0b1a12">
            {/* Centre pentagon. */}
            <path d="M16 10.2 20.3 13.3 18.7 18.4h-5.4L11.7 13.3Z" />
            {/* Five panels around it, as on a real 32-panel ball. */}
            <path d="M16 2.2 18.9 6.4 15.9 9.4 12.8 6.4Z" />
            <path d="M29.1 11.8 25.4 15.7 21.9 13.4 22.6 8.8Z" />
            <path d="M27.4 26.4 22.5 26.7 20.9 22.2 24.9 19Z" />
            <path d="M4.6 26.4 3.1 21.4 7.1 19 11.1 22.2 9.5 26.7Z" />
            <path d="M2.9 11.8 9.4 8.8 10.1 13.4 6.6 15.7Z" />
          </g>
          <circle
            cx="16"
            cy="16"
            r="14.6"
            fill="none"
            stroke="#07120c"
            strokeOpacity="0.55"
            strokeWidth="1.1"
          />
        </svg>
      </span>
    </>
  );
}

/** The net flashes when the ball is in it. Keyed on the score so it restarts. */
function GoalFlash({
  frame,
  home,
  away,
}: {
  frame: ReturnType<typeof samplePitch>;
  home: Club;
  away: Club;
}) {
  if (!frame.celebration) return null;

  const scoringSide = frame.possession;
  const club = scoringSide === "home" ? home : away;
  const atRight = scoringSide === "home";

  return (
    <>
      <span
        className="pointer-events-none absolute top-1/2 z-[11] h-[18%] w-[10%] -translate-y-1/2 rounded-full blur-2xl motion-safe:animate-glow"
        style={{
          ...(atRight ? { right: "1%" } : { left: "1%" }),
          background: `${club.colors.secondary}66`,
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
        role="status"
        data-testid="goal-flash"
      >
        <span className="motion-safe:animate-slam rounded-full border border-flare/45 bg-pitch-950/90 px-4 py-1.5 backdrop-blur">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.26em] text-flare">
            Goal
          </span>
        </span>
      </div>
    </>
  );
}

function PlayerToken({
  number,
  colour,
  home,
  carrier,
}: {
  number: number;
  colour: { primary: string; secondary: string };
  home: boolean;
  carrier: boolean;
}) {
  // A player seen from above: head, shoulders, number. Small enough to sit 22
  // on a pitch, structured enough to read as a person rather than a dot.
  const shirt = home ? colour.secondary : colour.primary;

  return (
    <span className="relative block h-[26px] w-[22px]">
      {carrier && (
        <>
          <span
            className="absolute -inset-1.5 rounded-full border border-flare/60 bg-flare/10"
            aria-hidden
          />
          <span
            className="absolute -top-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-flare"
            aria-hidden
          />
        </>
      )}
      <span
        className="absolute left-1/2 top-0 h-[9px] w-[9px] -translate-x-1/2 rounded-full border"
        style={{
          background: "#0a1b13",
          borderColor: home ? colour.secondary : colour.primary,
        }}
        aria-hidden
      />
      <span
        className="absolute bottom-0 left-1/2 grid h-[16px] w-[20px] -translate-x-1/2 place-items-center rounded-[45%] font-mono text-[8px] font-bold leading-none"
        style={{
          background: shirt,
          // The number has to survive both a pale trim and a dark shirt, so the
          // ink is chosen from the shirt rather than assumed.
          color: readableOn(shirt),
          boxShadow: "0 1px 2px rgba(0,0,0,0.45)",
        }}
        data-testid="shirt-number"
      >
        {number}
      </span>
    </span>
  );
}

/**
 * Black on a light shirt, paper on a dark one — the same decision the crest
 * makes, applied to the 2D token.
 */
function readableOn(colour: string): string {
  const hex = colour.trim();
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(hex);
  if (hsl) {
    return Number(hsl[3]) >= 46 ? "#06120d" : "#e8f2ea";
  }
  const rgb = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!rgb) return "#06120d";
  const n = parseInt(rgb[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#06120d" : "#e8f2ea";
}

function PitchMarkings() {
  const line = "border-white/25";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={clsx("absolute inset-[4.5%] border", line)} />
      <div className={clsx("absolute inset-y-[4.5%] left-1/2 w-px", "bg-white/25")} />
      <div
        className={clsx(
          "absolute left-1/2 top-1/2 h-[25%] w-[17%] -translate-x-1/2 -translate-y-1/2 rounded-full border",
          line,
        )}
      />
      <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
      {/* Penalty areas and six-yard boxes. */}
      <div className={clsx("absolute left-[4.5%] top-1/2 h-[60%] w-[15%] -translate-y-1/2 border-y border-r", line)} />
      <div className={clsx("absolute left-[4.5%] top-1/2 h-[27%] w-[5%] -translate-y-1/2 border-y border-r", line)} />
      <div className={clsx("absolute right-[4.5%] top-1/2 h-[60%] w-[15%] -translate-y-1/2 border-y border-l", line)} />
      <div className={clsx("absolute right-[4.5%] top-1/2 h-[27%] w-[5%] -translate-y-1/2 border-y border-l", line)} />

      {/*
        The goals sit *outside* the touchline, behind the goal line, not inside
        the field. That is the whole point of drawing them: the ball can be seen
        crossing a line and landing in a net, instead of stopping on the grass.
      */}
      <GoalMouth side="left" />
      <GoalMouth side="right" />
    </div>
  );
}

/**
 * One goal: a frame behind the line with a meshed net.
 *
 * The net is a pair of crossed repeating gradients rather than an image, so it
 * scales with the pitch and costs nothing to render.
 */
function GoalMouth({ side }: { side: "left" | "right" }) {
  const net =
    "repeating-linear-gradient(0deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 5px)," +
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 5px)";

  return (
    <div
      className={clsx(
        "absolute top-1/2 h-[11%] w-[4.5%] -translate-y-1/2 border-y border-white/45",
        side === "left" ? "left-0 border-l" : "right-0 border-r",
      )}
      style={{ background: net, backgroundColor: "rgba(6,20,13,0.55)" }}
      data-testid={`goal-${side}`}
    />
  );
}

/** The touchline ticker: what the ball is doing right now. */
function Ticker({
  frame,
  home,
  away,
  minute,
  goal,
  finished,
  score,
}: {
  frame: ReturnType<typeof samplePitch>;
  home: Club;
  away: Club;
  minute: number;
  goal: { scorer: Scorer } | null;
  finished: boolean;
  score: { home: number; away: number };
}) {
  const onBall = frame.possession === "home" ? home : away;
  return (
    <section className="card overflow-hidden" data-testid="ticker">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="font-mono text-[10px] font-bold tabular-nums text-flare/80">
          {String(minute).padStart(2, "0")}′
        </span>
        <span className="h-3 w-px bg-white/15" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-chalk/75">
          {finished ? (
            <span className="font-semibold">
              Full time: {home.short} {score.home}–{score.away} {away.short}.
            </span>
          ) : goal ? (
            <span className="font-semibold text-flare">
              {goal.scorer.playerName} scores for {onBall.short}.
            </span>
          ) : (
            captionFor(frame, home, away)
          )}
        </p>
        <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-chalk/50 sm:block">
          {finished ? `${home.short} ${score.home}–${score.away} ${away.short}` : `${onBall.short} on the ball`}
        </span>
      </div>
    </section>
  );
}

function StatBlock({
  label,
  a,
  b,
  split,
  home,
  away,
}: {
  label: string;
  a: string;
  b: string;
  split: number;
  home: Club;
  away: Club;
}) {
  return (
    <section className="card px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-sm font-bold tabular-nums">{a}</span>
        <span className="label">{label}</span>
        <span className="font-mono text-sm tabular-nums text-chalk/55">{b}</span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-l-full transition-[width] duration-150 ease-linear"
          style={{ width: `${split}%`, background: home.colors.secondary }}
        />
        <div className="h-full flex-1 opacity-60" style={{ background: away.colors.primary }} />
      </div>
    </section>
  );
}

/** The caption names what the ball is actually doing — proof the picture is the sim. */
function captionFor(frame: ReturnType<typeof samplePitch>, home: Club, away: Club): string {
  const onBall = frame.possession === "home" ? home : away;
  const third =
    frame.ball.x > 0.66 ? "final third" : frame.ball.x < 0.34 ? "own half" : "middle third";
  const doing =
    frame.phase === "goal"
      ? "in the net"
      : frame.phase === "shot"
        ? "shooting"
        : frame.phase === "pass"
          ? "passing"
          : frame.phase === "restart" || frame.phase === "kick-off"
            ? "restarting"
            : `in the ${third}`;
  return `${onBall.short} ${doing}.`;
}

/**
 * Which goal is on screen, if any.
 *
 * The celebration window is a stretch of minutes, and a goal's scorer is recorded
 * at a single minute. We match the window back to the scorer whose minute falls in
 * it, so the graphic names the right man even when two goals are close together.
 */
function goalOnScreen(
  result: MatchResult,
  frame: ReturnType<typeof samplePitch>,
  minute: number,
  home: Club,
  away: Club,
): { scorer: Scorer; club: Club; player?: Player } | null {
  if (!frame.celebration) return null;

  const side = frame.possession;
  const scorers = side === "home" ? result.scorers.home : result.scorers.away;
  const match =
    scorers.filter((s) => s.minute <= minute + 0.5).sort((a, b) => b.minute - a.minute)[0] ?? scorers[0];
  if (!match) return null;

  const club = side === "home" ? home : away;
  const player = club.players.find((p) => p.id === match.playerId) ?? undefined;
  return { scorer: match, club, player };
}

/** Goals scored by each side at or before `minute`. */
function scoreAt(result: MatchResult, minute: number) {
  return {
    home: result.scorers.home.filter((s) => s.minute <= minute).length,
    away: result.scorers.away.filter((s) => s.minute <= minute).length,
  };
}

/** Share of the match so far each side has spent on the ball. Counted, not faked. */
function possessionSoFar(result: MatchResult, minute: number, seed: number) {
  let home = 0;
  let away = 0;
  const steps = Math.max(1, minute);
  for (let i = 0; i <= steps; i++) {
    if (samplePitch({ result, minute: i, seed }).possession === "home") home++;
    else away++;
  }
  const total = home + away;
  return { home: Math.round((home / total) * 100), away: Math.round((away / total) * 100) };
}

/** Average ball position, split into each side's share of the pitch. */
function territorySoFar(result: MatchResult, minute: number, seed: number) {
  let sum = 0;
  const steps = Math.max(1, minute);
  for (let i = 0; i <= steps; i++) sum += samplePitch({ result, minute: i, seed }).ball.x;
  const avg = sum / (steps + 1);
  return { home: Math.round((1 - avg) * 100), away: Math.round(avg * 100) };
}

/** A stable seed for one match, so the same fixture always animates the same way. */
function hashSeed(result: MatchResult): number {
  const key = `${result.homeId}|${result.awayId}|${result.homeGoals}-${result.awayGoals}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
