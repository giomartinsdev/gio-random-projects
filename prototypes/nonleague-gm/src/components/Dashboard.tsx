import clsx from "clsx";

import { currentOpponent } from "@/engine/career";
import { computeTable, positionOf } from "@/engine/league";
import { computeStrength, squadRating } from "@/engine/squad";
import type { Career, FormResult, Mentality, MatchResult } from "@/engine/types";
import { money, ordinal, scoreline } from "@/lib/format";

interface Props {
  career: Career;
  lastResult?: MatchResult;
  onPlay: () => void;
  onMentality: (mentality: Mentality) => void;
  onSimSeason: () => void;
}

const MENTALITIES: { value: Mentality; label: string; hint: string }[] = [
  { value: "cautious", label: "Cautious", hint: "Fewer goals at both ends" },
  { value: "balanced", label: "Balanced", hint: "The default" },
  { value: "attacking", label: "Attacking", hint: "More goals, more risk" },
];

export function Dashboard({
  career,
  lastResult,
  onPlay,
  onMentality,
  onSimSeason,
}: Props) {
  const club = career.clubs[career.playerClubId];
  const opponent = currentOpponent(career);
  const strength = computeStrength(club);
  const opponentStrength = opponent ? computeStrength(opponent.club) : null;
  const isHome = opponent?.fixture.homeId === career.playerClubId;
  const table = computeTable(Object.values(career.clubs), career.fixtures);
  const opponentPosition = opponent ? positionOf(table, opponent.club.id) : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
            <h2 className="label">Next fixture</h2>
            <span className="font-mono text-xs text-chalk/40">
              Week {career.week + 1}
            </span>
          </div>

          {opponent ? (
            <div className="px-5 py-6">
              <div className="flex items-center justify-between gap-4">
                <TeamBlock
                  name={club.name}
                  short={club.short}
                  colors={club.colors}
                  rating={squadRating(club)}
                  home={isHome}
                />
                <div className="text-center">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-chalk/35">
                    {isHome ? "Home" : "Away"}
                  </p>
                  <p className="my-1 text-2xl font-black text-chalk/25">v</p>
                  <p className="font-mono text-[11px] text-chalk/35">
                    {opponent.club.tier === club.tier
                      ? `${ordinal(career.clubPosition)} v ${ordinal(opponentPosition)}`
                      : "Cup"}
                  </p>
                </div>
                <TeamBlock
                  name={opponent.club.name}
                  short={opponent.club.short}
                  colors={opponent.club.colors}
                  rating={squadRating(opponent.club)}
                  home={!isHome}
                />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Matchup
                  label="Your attack"
                  a={strength.attack}
                  b={opponentStrength?.defence ?? 0}
                  bLabel="Their defence"
                />
                <Matchup
                  label="Their attack"
                  a={opponentStrength?.attack ?? 0}
                  b={strength.defence}
                  bLabel="Your defence"
                />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button className="btn-primary" onClick={onPlay}>
                  Watch match
                </button>
                <button className="btn-ghost" onClick={onSimSeason}>
                  Simulate rest of season
                </button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-chalk/60">
                {career.seasonComplete
                  ? "The season is complete."
                  : "No fixture scheduled."}
              </p>
            </div>
          )}
        </section>

        {lastResult && <ResultPanel career={career} result={lastResult} />}

        <section className="card p-5">
          <h2 className="label">Mentality</h2>
          <p className="mt-1 text-sm text-chalk/50">
            Applies to your next match. Cautious sides concede less but score less.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {MENTALITIES.map((option) => (
              <button
                key={option.value}
                onClick={() => onMentality(option.value)}
                aria-pressed={career.mentality === option.value}
                className={clsx(
                  "rounded-xl border px-3 py-3 text-left transition",
                  career.mentality === option.value
                    ? "border-flare/60 bg-flare/10"
                    : "border-white/10 hover:border-white/25",
                )}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-xs text-chalk/45">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="card p-5">
          <h2 className="label">Club</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Squad rating" value={String(squadRating(club))} />
            <Row label="Squad size" value={String(club.players.length)} />
            <Row label="Capacity" value={club.capacity.toLocaleString("en-GB")} />
            <Row
              label="Last crowd"
              value={
                club.lastAttendance
                  ? club.lastAttendance.toLocaleString("en-GB")
                  : "—"
              }
            />
            <Row label="Ticket price" value={money(club.ticketPrice)} />
            <Row label="Balance" value={money(club.balance)} />
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="label">Form</h2>
          <div className="mt-3 flex gap-1.5">
            {career.form.length === 0 && (
              <p className="text-sm text-chalk/40">No matches played yet.</p>
            )}
            {career.form.map((result, index) => (
              <FormPip key={index} result={result} />
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function TeamBlock({
  name,
  short,
  colors,
  rating,
  home,
}: {
  name: string;
  short: string;
  colors: { primary: string; secondary: string };
  rating: number;
  home: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 text-center">
      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-xl text-sm font-extrabold"
        style={{
          background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
        }}
        aria-hidden
      >
        {short}
      </div>
      <p className="mt-2 truncate text-sm font-semibold">{name}</p>
      <p className="font-mono text-xs text-chalk/40">
        {rating} ovr {home && "· home"}
      </p>
    </div>
  );
}

function Matchup({
  label,
  a,
  b,
  bLabel,
}: {
  label: string;
  a: number;
  b: number;
  bLabel: string;
}) {
  const total = Math.max(1, a + b);
  const percent = (a / total) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-chalk/60">{label}</span>
        <span className="text-chalk/40">{bLabel}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
          {a.toFixed(0)}
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-flare/80"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="w-8 shrink-0 font-mono text-sm tabular-nums text-chalk/50">
          {b.toFixed(0)}
        </span>
      </div>
    </div>
  );
}

function ResultPanel({ career, result }: { career: Career; result: MatchResult }) {
  const club = career.clubs[career.playerClubId];
  const isHome = result.homeId === career.playerClubId;
  const myGoals = isHome ? result.homeGoals : result.awayGoals;
  const theirGoals = isHome ? result.awayGoals : result.homeGoals;
  const opponentId = isHome ? result.awayId : result.homeId;
  const opponent = career.clubs[opponentId];

  const won = myGoals > theirGoals;
  const drew = myGoals === theirGoals;

  return (
    <section className="card overflow-hidden" data-testid="last-result">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
        <h2 className="label">Last result</h2>
        <span
          className={clsx(
            "rounded-md px-2 py-0.5 font-mono text-xs font-bold",
            won && "bg-flare/15 text-flare",
            drew && "bg-white/10 text-chalk/70",
            !won && !drew && "bg-ember/15 text-ember",
          )}
        >
          {won ? "WIN" : drew ? "DRAW" : "LOSS"}
        </span>
      </div>

      <div className="px-5 py-5">
        <p className="text-center text-sm text-chalk/50">
          {isHome ? club.short : (opponent?.short ?? "???")} v{" "}
          {isHome ? (opponent?.short ?? "???") : club.short}
        </p>
        <p
          className="mt-1 text-center font-mono text-4xl font-black tabular-nums"
          data-testid="scoreline"
          data-home={result.homeId}
          data-away={result.awayId}
        >
          {scoreline(result.homeGoals, result.awayGoals)}
        </p>

        <ul
          className="mt-5 space-y-1.5 text-sm"
          data-testid="match-events"
        >
          {result.events
            .filter((event) => event.kind === "goal" || event.kind === "full-time")
            .map((event, index) => (
              <li
                key={index}
                className="flex items-start gap-3 rounded-lg px-2 py-1.5 odd:bg-white/[0.02]"
              >
                <span className="w-8 shrink-0 font-mono text-xs text-chalk/35">
                  {event.minute}′
                </span>
                <span
                  className={clsx(
                    "text-chalk/75",
                    event.kind === "goal" && event.side === "home" && isHome && "text-flare/90",
                    event.kind === "goal" && event.side === "away" && !isHome && "text-flare/90",
                  )}
                >
                  {event.text}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}

function FormPip({ result }: { result: FormResult }) {
  return (
    <span
      className={clsx(
        "grid h-7 w-7 place-items-center rounded-md font-mono text-xs font-bold",
        result === "W" && "bg-flare/15 text-flare",
        result === "D" && "bg-white/10 text-chalk/60",
        result === "L" && "bg-ember/15 text-ember",
      )}
      title={result}
    >
      {result}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-chalk/45">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
