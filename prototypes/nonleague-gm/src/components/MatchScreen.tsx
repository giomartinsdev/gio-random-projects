import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { ballTrail, samplePitch, TOTAL_MINUTES } from "@/engine/pitch";
import type { Career, Club, MatchResult } from "@/engine/types";

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
 * The live match: twenty-two players on a pitch, a ball, and a clock.
 *
 * The positions are not drawn here — they come from `samplePitch`, which is a
 * pure function of (result, minute, seed). That separation is the reason this
 * screen can be trusted: the picture cannot disagree with the scoreline,
 * because both are derived from the same MatchResult. It also means the whole
 * match can be replayed frame by frame in a test.
 */
export function MatchScreen({ career, result, onExit }: Props) {
  const [minute, setMinute] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const minuteRef = useRef(0);

  const home = career.clubs[result.homeId];
  const away = career.clubs[result.awayId];
  const seed = useMemo(() => hashSeed(result), [result]);

  useEffect(() => {
    minuteRef.current = minute;
  }, [minute]);

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

  const frame = useMemo(
    () => samplePitch({ result, minute, seed }),
    [result, minute, seed],
  );
  const trail = useMemo(
    () => ballTrail({ result, minute, seed }),
    [result, minute, seed],
  );

  const score = scoreAt(result, minute);
  const finished = minute >= TOTAL_MINUTES;
  // The clock reads in whole minutes even though the model ticks in halves.
  const clock = Math.min(TOTAL_MINUTES, Math.floor(minute));
  const events = result.events.filter((e) => e.minute <= minute);

  const possession = useMemo(() => possessionSoFar(result, minute, seed), [result, minute, seed]);
  const territory = useMemo(() => territorySoFar(result, minute, seed), [result, minute, seed]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="match-screen">
      <div className="space-y-4">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5">
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
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-flare">
                {finished ? "Full time" : "Live"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-chalk/35">
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
                    speed === s ? "bg-flare/15 text-flare" : "text-chalk/40 hover:text-chalk",
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

          <div className="px-4 pt-4">
            <Scorebar
              home={home}
              away={away}
              homeGoals={score.home}
              awayGoals={score.away}
              minute={clock}
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
        </section>

        <PossessionBar frame={frame} home={home} away={away} />
      </div>

      <aside className="space-y-4">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-chalk/40">
              Match stats
            </h2>
            <span className="font-mono text-[10px] tabular-nums text-chalk/35">
              {clock}′
            </span>
          </div>
          <dl className="divide-y divide-white/[0.05]">
            <Stat label="Possession" a={`${possession.home}%`} b={`${possession.away}%`} />
            <Stat label="Territory" a={`${territory.home}%`} b={`${territory.away}%`} />
            <Stat label="Goals" a={String(score.home)} b={String(score.away)} />
          </dl>
          <p className="border-t border-white/[0.05] px-4 py-2.5 text-[11px] leading-relaxed text-chalk/35">
            Every number here is counted from the same model that draws the pitch.
          </p>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-white/[0.07] px-4 py-2.5">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-chalk/40">
              Commentary
            </h2>
          </div>
          <ol className="max-h-[300px] divide-y divide-white/[0.04] overflow-y-auto" data-testid="commentary">
            {events
              .slice()
              .reverse()
              .map((event, index) => (
                <li key={index} className="flex gap-3 px-4 py-2">
                  <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-chalk/30">
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
          <button className="btn-primary w-full" onClick={onExit}>
            Back to the dashboard
          </button>
        )}
      </aside>
    </div>
  );
}

function Scorebar({
  home,
  away,
  homeGoals,
  awayGoals,
  minute,
}: {
  home: Club;
  away: Club;
  homeGoals: number;
  awayGoals: number;
  minute: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className="h-7 w-1 shrink-0 rounded-full"
          style={{ background: "var(--team-home)" }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{home.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-flare/80">Home</p>
        </div>
      </div>

      <div className="flex items-baseline gap-2.5">
        <span
          className="font-mono text-3xl font-black tabular-nums"
          data-testid="live-score"
        >
          {homeGoals}
        </span>
        <span className="font-mono text-lg text-chalk/25">–</span>
        <span className="font-mono text-3xl font-black tabular-nums">{awayGoals}</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5 text-right">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{away.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-chalk/40">Away</p>
        </div>
        <span
          className="h-7 w-1 shrink-0 rounded-full"
          style={{ background: "var(--team-away)" }}
          aria-hidden
        />
      </div>

      <span
        className="w-14 shrink-0 rounded-md bg-white/[0.05] px-1.5 py-1 text-center font-mono text-xs font-bold tabular-nums text-chalk/70"
        data-testid="match-clock"
        aria-live="off"
      >
        {String(minute).padStart(2, "0")}′
      </span>
    </div>
  );
}

/**
 * The pitch.
 *
 * Drawn with plain absolutely-positioned boxes so the geometry is exactly what
 * `samplePitch` returned — no canvas, no layout rounding between the model and
 * the picture. `data-x` / `data-y` are on every token so a test can prove no
 * player ever leaves the grass.
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
  return (
    <div className="p-4">
      <div
        className="pitch relative w-full overflow-hidden rounded-xl"
        data-testid="pitch"
        style={{ aspectRatio: "956 / 664" }}
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

        <GoalFlash frame={frame} home={home} away={away} />

        {/* Lower third: the last goal, then a live caption. */}
        <LastGoalCard frame={frame} home={home} away={away} homeGoals={homeGoals} awayGoals={awayGoals} minute={minute} />
      </div>
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
 *
 * The trail lives outside the span, in the pitch, so a fade never drags the ball
 * itself backwards.
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
  // frame, so it snaps instead of gliding the length of the field. The engine
  // says which frames those are; guessing from distance would also cut a long
  // pass, which is exactly the motion worth seeing.
  const transition = dead ? "none" : undefined;

  const size = 15;
  const shadowScale = 1 - lift * 0.45;

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
        <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden>
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

/**
 * What a goal looks like: the net flashes and a caption names the scorer.
 *
 * Shown only while `celebration` is true, which is the stretch of match minutes
 * the ball spends in the net. It is keyed on the score so React restarts the
 * animation for each goal rather than running it once per match.
 */
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
        className="pointer-events-none absolute top-1/2 z-[11] h-[16%] w-[9%] -translate-y-1/2 rounded-full bg-flare/35 blur-xl motion-safe:animate-pulse"
        style={atRight ? { right: "1.5%" } : { left: "1.5%" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
        role="status"
        data-testid="goal-flash"
      >
        <span className="flex items-center gap-2 rounded-full border border-flare/40 bg-pitch-950/90 px-3 py-1 backdrop-blur">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-flare">
            Goal
          </span>
          <span className="h-2.5 w-px bg-white/20" aria-hidden />
          <span className="text-[11.5px] font-semibold text-chalk/85">{club.short}</span>
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
  return (
    <span className="relative block h-[26px] w-[22px]">
      {carrier && (
        <span
          className="absolute -inset-1.5 rounded-full border border-flare/60 bg-flare/10"
          aria-hidden
        />
      )}
      <span
        className="absolute left-1/2 top-0 h-[9px] w-[9px] -translate-x-1/2 rounded-full border"
        style={{
          background: home ? "#0a1b13" : "#0a1b13",
          borderColor: home ? colour.secondary : colour.primary,
        }}
        aria-hidden
      />
      <span
        className={clsx(
          "absolute bottom-0 left-1/2 grid h-[16px] w-[20px] -translate-x-1/2 place-items-center rounded-[45%] font-mono text-[8px] font-bold leading-none",
          home ? "text-pitch-950" : "text-pitch-950",
        )}
        style={{
          background: home ? colour.secondary : colour.primary,
          boxShadow: "0 1px 2px rgba(0,0,0,0.45)",
        }}
      >
        {number}
      </span>
    </span>
  );
}

function PitchMarkings() {
  const line = "border-white/25";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={clsx("absolute inset-[4.5%] border", line)} />
      <div className={clsx("absolute inset-y-[4.5%] left-1/2 w-px", "bg-white/25")} />
      <div
        className={clsx("absolute left-1/2 top-1/2 h-[25%] w-[17%] -translate-x-1/2 -translate-y-1/2 rounded-full border", line)}
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
 * scales with the pitch and costs nothing to render. `depth` is the distance the
 * net reaches back, in percent of the pitch — deep enough that a ball at
 * `NET_X` is unambiguously inside it.
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

function LastGoalCard({
  frame,
  home,
  away,
  homeGoals,
  awayGoals,
  minute,
}: {
  frame: ReturnType<typeof samplePitch>;
  home: Club;
  away: Club;
  homeGoals: number;
  awayGoals: number;
  minute: number;
}) {
  const onBall = frame.possession === "home" ? home : away;
  const third = frame.ball.x > 0.66 ? "final third" : frame.ball.x < 0.34 ? "own half" : "middle third";

  // The caption names what the ball is actually doing. A caption that says
  // "passing" while the ball is visibly travelling is the cheapest proof that
  // the picture is the simulation and not a loop of dots.
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

  return (
    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
      <div className="rounded-lg border border-white/10 bg-pitch-950/85 px-2.5 py-1.5 backdrop-blur">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-chalk/35">
          {minute}′ · {home.short} {homeGoals}–{awayGoals} {away.short}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-tight text-chalk/75">
          {onBall.short} {doing}.
        </p>
      </div>
      <div className="hidden rounded-lg border border-flare/25 bg-pitch-950/85 px-2.5 py-1.5 backdrop-blur sm:block">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-flare/80">
          4–2–3–1
        </p>
      </div>
    </div>
  );
}

function PossessionBar({
  frame,
  home,
  away,
}: {
  frame: ReturnType<typeof samplePitch>;
  home: Club;
  away: Club;
}) {
  const homeShare = Math.round(frame.momentum * 50 + 50);
  return (
    <section className="card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/35">
          Momentum
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/35">
          {home.short} {homeShare}%
        </span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-l-full bg-flare/80 transition-[width] duration-100 ease-linear"
          style={{ width: `${homeShare}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-chalk/30">
        <span>{home.short}</span>
        <span>{away.short}</span>
      </div>
    </section>
  );
}

function Stat({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <dd className="w-12 font-mono text-sm font-semibold tabular-nums">{a}</dd>
      <dt className="flex-1 text-center text-[11px] text-chalk/40">{label}</dt>
      <dd className="w-12 text-right font-mono text-sm tabular-nums text-chalk/55">{b}</dd>
    </div>
  );
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
