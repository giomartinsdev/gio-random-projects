import clsx from "clsx";

import { PlayerFace } from "@/components/Identity";
import { attributesOf, positionLabel } from "@/engine/identity";
import type { Club, Player } from "@/engine/types";

/**
 * The player card.
 *
 * This is the object the whole game-feel direction hangs on: a face, a rating, a
 * position, six attributes and the club's colour. A squad screen made of these is
 * a team; the same data in a table is a spreadsheet.
 *
 * The tier (gold/silver/bronze) is derived from ability, so a squad has a visible
 * hierarchy at a glance instead of twenty identical rows.
 */
export function PlayerCard({
  player,
  club,
  size = "md",
  className,
  index = 0,
}: {
  player: Player;
  club: Club;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Stagger index for the entrance animation. */
  index?: number;
}) {
  const tier = player.ability >= 74 ? "gold" : player.ability >= 62 ? "silver" : "bronze";
  const attributes = attributesOf(player);

  return (
    <article
      className={clsx(
        "player-card",
        tier === "gold" && "player-card-gold",
        tier === "silver" && "player-card-silver",
        "motion-safe:animate-rise",
        className,
      )}
      data-testid="player-card"
      data-player={player.id}
      data-tier={tier}
      data-position={player.position}
      data-rating={player.ability}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      {/* Club colour wash, keyed to the badge. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1.5"
        style={{ background: `linear-gradient(90deg, ${club.colors.primary}, ${club.colors.secondary})` }}
        aria-hidden
      />

      <div className="relative flex items-start gap-2 px-3 pt-4">
        <div className="shrink-0 text-center">
          <p className="display text-4xl leading-none text-chalk" data-testid="card-rating">
            {player.ability}
          </p>
          <p className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-chalk/55">
            {positionLabel(player)}
          </p>
          <span className="mt-1.5 block h-px w-6 bg-white/20" aria-hidden />
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-chalk/55">
            {club.short}
          </p>
        </div>

        <div className="relative -mb-2 min-w-0 flex-1">
          <FaceSlot player={player} club={club} size={size} />
        </div>
      </div>

      <div className="relative px-3 pb-3">
        <p
          className="truncate border-b border-white/10 pb-1.5 text-center text-[13px] font-semibold tracking-wide"
          title={player.name}
        >
          {player.name}
        </p>

        {size !== "sm" && (
          <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
            {(
              [
                ["PAC", attributes.pace],
                ["SHO", attributes.shooting],
                ["PAS", attributes.passing],
                ["DRI", attributes.dribbling],
                ["DEF", attributes.defending],
                ["PHY", attributes.physical],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-1">
                <dt className="font-mono text-[9px] uppercase tracking-wider text-chalk/55">{label}</dt>
                <dd className="font-mono text-[11px] font-bold tabular-nums text-chalk/85">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}

function FaceSlot({
  player,
  club,
  size,
}: {
  player: Player;
  club: Club;
  size: "sm" | "md" | "lg";
}) {
  const height = size === "sm" ? "h-[86px]" : size === "lg" ? "h-[168px]" : "h-[124px]";

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto h-16 w-16 rounded-full blur-2xl"
        style={{ background: club.colors.secondary, opacity: 0.28 }}
        aria-hidden
      />
      <PlayerFace
        playerId={player.id}
        age={player.age}
        name={player.name}
        photoUrl={player.photoUrl}
        photoCredit={player.photoCredit}
        colors={club.colors}
        number={player.number}
        className={clsx("relative mx-auto w-full", height)}
      />
    </>
  );
}

/**
 * The compact form, for a squad list or a bench.
 *
 * Same identity, one third of the height: a face, a number, a name, a rating. Used
 * where the card grid would be too tall to scan.
 */
export function PlayerRow({
  player,
  club,
  badge,
}: {
  player: Player;
  club: Club;
  badge?: string;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      data-testid="squad-row"
      data-position={player.position}
      data-rating={player.ability}
    >
      <span className="w-6 shrink-0 text-center font-mono text-[11px] tabular-nums text-chalk/50">
        {player.number ?? ""}
      </span>
      <PlayerFace
        playerId={player.id}
        age={player.age}
        name={player.name}
        photoUrl={player.photoUrl}
        photoCredit={player.photoCredit}
        colors={club.colors}
        number={player.number}
        className="h-8 w-8 shrink-0 rounded-md"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{player.name}</span>
          {badge && (
            <span className="rounded bg-flare/15 px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-flare">
              {badge}
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-chalk/50">
          {positionLabel(player)} · {player.age}y
        </span>
      </span>
      <span className="font-mono text-sm font-bold tabular-nums text-chalk/85">{player.ability}</span>
    </div>
  );
}
