import clsx from "clsx";

import { ClubCrest, PlayerFace } from "@/components/Identity";
import { PlayerCard } from "@/components/PlayerCard";
import { currentOpponent } from "@/engine/career";
import { computeTable, positionOf } from "@/engine/league";
import { computeStrength, keyPlayers, pickLineup, squadRating, starPlayer } from "@/engine/squad";
import type { Career, Club, FormResult, Mentality, MatchResult, Player } from "@/engine/types";
import { money, ordinal, scoreline } from "@/lib/format";

interface Props {
  career: Career;
  lastResult?: MatchResult;
  onPlay: () => void;
  onMentality: (mentality: Mentality) => void;
  onSimSeason: () => void;
  onOpenMatch?: () => void;
}

const MENTALITIES: { value: Mentality; label: string; hint: string; glyph: string }[] = [
  { value: "cautious", label: "Cautious", hint: "Fewer goals at both ends", glyph: "◤" },
  { value: "balanced", label: "Balanced", hint: "The default", glyph: "◆" },
  { value: "attacking", label: "Attacking", hint: "More goals, more risk", glyph: "◥" },
];

/**
 * Matchday.
 *
 * This screen used to be a grid of metric cards, which is what every management
 * sim looks like and none of them feel like football. It is now built the way a
 * broadcast builds a fixture: two badges, two faces, a scoreline slot, and one
 * unmissable action. The information is identical; the hierarchy is not.
 */
export function Dashboard({
  career,
  lastResult,
  onPlay,
  onMentality,
  onSimSeason,
  onOpenMatch,
}: Props) {
  const club = career.clubs[career.playerClubId];
  const opponent = currentOpponent(career);
  const strength = computeStrength(club);
  const opponentStrength = opponent ? computeStrength(opponent.club) : null;
  const isHome = opponent?.fixture.homeId === career.playerClubId;
  const table = computeTable(Object.values(career.clubs), career.fixtures);
  const opponentPosition = opponent ? positionOf(table, opponent.club.id) : 0;
  const stars = keyPlayers(club, 4);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08]" data-testid="matchday-hero">
        {/* Floodlit backdrop, tinted by both clubs. */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background: `
              radial-gradient(ellipse 60% 120% at 0% 30%, ${club.colors.primary} 0%, transparent 58%),
              radial-gradient(ellipse 60% 120% at 100% 30%, ${opponent?.club.colors.primary ?? "#122"} 0%, transparent 58%),
              linear-gradient(160deg, #0a1b13 0%, #06120d 60%, #04100b 100%)`,
          }}
        />
        <div className="crowd pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.13]" aria-hidden />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(200,247,81,.55), transparent)" }}
          aria-hidden
        />

        <div className="relative px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flare/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-flare" />
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-flare">
                {opponent ? "Next fixture" : "Season complete"}
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-chalk/55">
              Matchday {career.week + 1} · {isHome ? "Home" : "Away"}
            </span>
          </div>

          {opponent ? (
            <>
              <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
                <FixtureSide
                  club={club}
                  position={career.clubPosition}
                  rating={squadRating(club)}
                  star={stars[0]}
                  align="left"
                />

                <div className="flex flex-col items-center">
                  <p className="display text-[34px] leading-none text-chalk/50 sm:text-[46px]">v</p>
                  <div className="mt-1 flex items-center gap-1">
                    <Pill label="ATK" value={`${strength.attack.toFixed(0)}`} />
                    <Pill label="DEF" value={`${strength.defence.toFixed(0)}`} />
                  </div>
                </div>

                <FixtureSide
                  club={opponent.club}
                  position={opponentPosition}
                  rating={squadRating(opponent.club)}
                  star={starPlayer(opponent.club)}
                  align="right"
                />
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button className="cta w-full sm:w-auto" onClick={onPlay}>
                  <span className="text-lg leading-none">▶</span>
                  Kick off
                </button>
                {lastResult && onOpenMatch && (
                  <button className="btn-ghost" onClick={onOpenMatch}>
                    Rewatch last match
                  </button>
                )}
                <button className="btn-ghost" onClick={onSimSeason}>
                  Simulate season
                </button>
                <div className="sm:ml-auto">
                  <MatchupMini
                    a={strength.attack}
                    b={opponentStrength?.defence ?? 0}
                    label="Your attack v their defence"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.07] pt-4 text-[11px] text-chalk/50">
                <Meta label="Form" value={<FormRibbon form={career.form} />} />
                <Meta
                  label="Squad"
                  value={
                    <span>
                      <span className="font-mono text-chalk/85">{squadRating(club)}</span> ovr ·{" "}
                      {club.players.length} players
                    </span>
                  }
                />
                <Meta
                  label="Gate"
                  value={
                    <span>
                      <span className="font-mono text-chalk/85">{money(club.ticketPrice)}</span> ·{" "}
                      {club.capacity.toLocaleString("en-GB")} cap
                    </span>
                  }
                />
                <Meta
                  label="Balance"
                  value={<span className="font-mono text-chalk/85">{money(club.balance)}</span>}
                />
              </div>
            </>
          ) : (
            <div className="py-10 text-center">
              <p className="display text-3xl text-chalk/80">Season complete</p>
              <p className="mt-2 text-sm text-chalk/50">End the season to see where you finished.</p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="display text-2xl leading-none">Key men</h2>
                <p className="mt-1 text-xs text-chalk/55">
                  The four the result usually turns on. Full XI on the right.
                </p>
              </div>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/50 sm:block">
                4–2–3–1
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {stars.map((player, index) => (
                <PlayerCard key={player.id} player={player} club={club} index={index} size="sm" />
              ))}
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="display text-xl leading-none">Mentality</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/50">
                Applies to the next match
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {MENTALITIES.map((option) => {
                const active = career.mentality === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => onMentality(option.value)}
                    aria-pressed={active}
                    className={clsx(
                      "group relative overflow-hidden rounded-xl border px-3 py-3 text-left transition",
                      active
                        ? "border-flare/60 bg-flare/[0.09] shadow-[0_0_0_1px_rgba(200,247,81,.22)]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/25",
                    )}
                  >
                    <span
                      className={clsx(
                        "absolute right-2 top-1 text-lg leading-none transition",
                        active ? "text-flare/70" : "text-chalk/50 group-hover:text-chalk/50",
                      )}
                      aria-hidden
                    >
                      {option.glyph}
                    </span>
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] text-chalk/55">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {lastResult && <ResultPanel career={career} result={lastResult} onOpenMatch={onOpenMatch} />}
        </div>

        <aside className="space-y-5">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
              <h2 className="label">Squad sheet</h2>
              <span className="font-mono text-[10px] text-chalk/50">{club.short}</span>
            </div>
            <ul className="divide-y divide-white/[0.04]">
              {pickLineup(club).map((player, index) => (
                <li key={player.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-5 shrink-0 text-center font-mono text-[10px] tabular-nums text-chalk/50">
                    {index + 1}
                  </span>
                  <PlayerFace
                    playerId={player.id}
                    age={player.age}
                    name={player.name}
                    photoUrl={player.photoUrl}
                    photoCredit={player.photoCredit}
                    colors={club.colors}
                    number={player.number}
                    className="h-7 w-7 shrink-0 rounded"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{player.name}</span>
                  <span className="font-mono text-[11px] tabular-nums text-chalk/55">{player.ability}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="label">The board</h2>
            <div className="mt-3 space-y-2 text-sm">
              <Row label="Squad rating" value={String(squadRating(club))} />
              <Row label="Squad size" value={String(club.players.length)} />
              <Row
                label="Last crowd"
                value={club.lastAttendance ? club.lastAttendance.toLocaleString("en-GB") : "—"}
              />
              <Row label="Balance" value={money(club.balance)} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FixtureSide({
  club,
  position,
  rating,
  star,
  align,
}: {
  club: Club;
  position: number;
  rating: number;
  star?: Player;
  align: "left" | "right";
}) {
  return (
    <div className={clsx("min-w-0", align === "right" ? "text-center sm:text-right" : "text-center sm:text-left")}>
      <div
        className={clsx(
          "flex flex-col items-center gap-2 sm:flex-row sm:gap-3",
          align === "right" && "sm:flex-row-reverse",
        )}
      >
        <ClubCrest
          clubId={club.id}
          name={club.name}
          colors={club.colors}
          short={club.short}
          crestUrl={club.crestUrl}
          className="h-12 w-12 shrink-0 drop-shadow-[0_8px_18px_rgba(0,0,0,.5)] sm:h-16 sm:w-16"
        />
        <div className="min-w-0 sm:flex-1">
          <p className="display mx-auto max-w-[130px] text-[15px] leading-[1.05] sm:max-w-none sm:truncate sm:text-2xl">
            {club.name}
          </p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/55 sm:text-[10px] sm:tracking-[0.16em]">
            {ordinal(position)} · {rating} ovr
          </p>
        </div>
      </div>

      {star && (
        <div
          className={clsx(
            "mt-3 flex items-center gap-2",
            align === "right" ? "justify-center sm:flex-row-reverse sm:justify-start" : "justify-center sm:flex-row sm:justify-start",
          )}
        >
          <PlayerFace
            playerId={star.id}
            age={star.age}
            name={star.name}
            photoUrl={star.photoUrl}
            photoCredit={star.photoCredit}
            colors={club.colors}
            number={star.number}
            className="h-10 w-10 shrink-0 rounded-lg ring-1 ring-white/15 sm:h-11 sm:w-11"
          />
          <div className="min-w-0 text-left">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-flare/80">Key player</p>
            <p className="truncate text-[11.5px] font-medium text-chalk/85 sm:text-[12px]">{star.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-chalk/50">
      {label} <span className="font-bold text-chalk/80">{value}</span>
    </span>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-chalk/50">{label}</span>
      {value}
    </span>
  );
}

function MatchupMini({ a, b, label }: { a: number; b: number; label: string }) {
  const total = Math.max(1, a + b);
  return (
    <div className="w-full sm:w-56">
      <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/55">
        <span>{label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold tabular-nums">{a.toFixed(0)}</span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 rounded-full bg-flare/80" style={{ width: `${(a / total) * 100}%` }} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-chalk/50">{b.toFixed(0)}</span>
      </div>
    </div>
  );
}

function FormRibbon({ form }: { form: FormResult[] }) {
  if (form.length === 0) return <span className="text-chalk/55">No matches yet</span>;
  return (
    <span className="flex gap-1">
      {form.slice(-6).map((result, index) => (
        <span
          key={index}
          className={clsx(
            "grid h-4 w-4 place-items-center rounded-[3px] font-mono text-[9px] font-bold",
            result === "W" && "bg-flare/20 text-flare",
            result === "D" && "bg-white/10 text-chalk/60",
            result === "L" && "bg-ember/20 text-ember",
          )}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

function ResultPanel({
  career,
  result,
  onOpenMatch,
}: {
  career: Career;
  result: MatchResult;
  onOpenMatch?: () => void;
}) {
  const club = career.clubs[career.playerClubId];
  const isHome = result.homeId === career.playerClubId;
  const myGoals = isHome ? result.homeGoals : result.awayGoals;
  const theirGoals = isHome ? result.awayGoals : result.homeGoals;
  const opponent = career.clubs[isHome ? result.awayId : result.homeId];

  const won = myGoals > theirGoals;
  const drew = myGoals === theirGoals;
  const scorers = (isHome ? result.scorers.home : result.scorers.away).concat(
    isHome ? result.scorers.away : result.scorers.home,
  );

  return (
    <section className="card overflow-hidden" data-testid="last-result">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
        <h2 className="label">Last result</h2>
        <span
          className={clsx(
            "rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
            won && "bg-flare/15 text-flare",
            drew && "bg-white/10 text-chalk/70",
            !won && !drew && "bg-ember/15 text-ember",
          )}
        >
          {won ? "Win" : drew ? "Draw" : "Loss"}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center justify-center gap-3">
          <MiniTeam club={isHome ? club : opponent} align="right" />
          <p
            className="display shrink-0 text-4xl leading-none tabular-nums"
            data-testid="scoreline"
            data-home={result.homeId}
            data-away={result.awayId}
          >
            {scoreline(result.homeGoals, result.awayGoals)}
          </p>
          <MiniTeam club={isHome ? opponent : club} align="left" />
        </div>

        <ul className="flex-1 space-y-1 text-sm" data-testid="match-events">
          {scorers.map((scorer, index) => (
            <li key={index} className="flex items-center gap-2 rounded-lg px-1 py-0.5">
              <span className="w-7 shrink-0 font-mono text-[11px] text-chalk/50">{scorer.minute}′</span>
              <span className="text-[12.5px] text-chalk/75">{scorer.playerName}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-chalk/50">
                {scorer.side === (isHome ? "home" : "away") ? club.short : opponent?.short}
              </span>
            </li>
          ))}
          {scorers.length === 0 && (
            <li className="px-1 text-[12px] text-chalk/55">Goalless.</li>
          )}
        </ul>

        {onOpenMatch && (
          <button className="btn-ghost shrink-0" onClick={onOpenMatch}>
            Rewatch
          </button>
        )}
      </div>
    </section>
  );
}

function MiniTeam({ club, align }: { club?: Club; align: "left" | "right" }) {
  if (!club) return <span className="w-16" />;
  return (
    <div className={clsx("flex w-16 flex-col items-center gap-1", align === "right" ? "order-first" : "")}>
      <ClubCrest
        clubId={club.id}
        name={club.name}
        colors={club.colors}
        short={club.short}
        crestUrl={club.crestUrl}
        className="h-8 w-8"
      />
      <span className="truncate font-mono text-[9px] uppercase tracking-wider text-chalk/55">{club.short}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-chalk/55">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
