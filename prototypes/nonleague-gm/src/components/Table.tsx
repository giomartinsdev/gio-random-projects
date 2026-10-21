import clsx from "clsx";

import { computeTable } from "@/engine/league";
import { tierName } from "@/engine/career";
import type { Career } from "@/engine/types";

interface Props {
  career: Career;
}

export function Table({ career }: Props) {
  const clubs = Object.values(career.clubs);
  const table = computeTable(clubs, career.fixtures);
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const tier = clubs[0]?.tier ?? career.totalTiers;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
        <h2 className="label">{tierName(tier, career.totalTiers)}</h2>
        <span className="font-mono text-xs text-chalk/35">
          {career.fixtures.filter((f) => f.played).length}/{career.fixtures.length} played
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-white/[0.07] text-left">
              <th className="w-10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-chalk/35">#</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-chalk/35">Club</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">P</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">W</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">D</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">L</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">GF</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">GA</th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">GD</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-chalk/35">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, index) => {
              const club = clubById.get(row.clubId);
              const mine = row.clubId === career.playerClubId;
              const zone =
                index < 2
                  ? "promotion"
                  : index < 6
                    ? "playoff"
                    : index >= table.length - 3
                      ? "relegation"
                      : null;

              return (
                <tr
                  key={row.clubId}
                  data-testid="table-row"
                  data-mine={mine ? "true" : "false"}
                  className={clsx(
                    "border-b border-white/[0.04] last:border-0",
                    mine ? "bg-flare/[0.07]" : "hover:bg-white/[0.02]",
                  )}
                >
                  <td className="relative px-3 py-2.5 font-mono text-xs text-chalk/40">
                    {zone && (
                      <span
                        className={clsx(
                          "absolute inset-y-0 left-0 w-0.5",
                          zone === "promotion" && "bg-flare",
                          zone === "playoff" && "bg-flare/40",
                          zone === "relegation" && "bg-ember",
                        )}
                      />
                    )}
                    {index + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-4 w-1 rounded-full"
                        style={{ background: club?.colors.primary }}
                        aria-hidden
                      />
                      <span className={clsx(mine && "font-semibold text-flare")}>
                        {club?.name ?? row.clubId}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-chalk/50">{row.played}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{row.won}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{row.drawn}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{row.lost}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-chalk/60">{row.goalsFor}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-chalk/60">{row.goalsAgainst}</td>
                  <td
                    className={clsx(
                      "px-2 py-2.5 text-right font-mono tabular-nums",
                      row.goalDifference > 0 ? "text-flare/80" : row.goalDifference < 0 ? "text-ember/80" : "text-chalk/60",
                    )}
                  >
                    {row.goalDifference > 0 ? "+" : ""}
                    {row.goalDifference}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums">
                    {row.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-3 border-t border-white/[0.07] px-5 py-3 text-xs text-chalk/40">
        <div className="flex flex-wrap gap-4">
          <Legend className="bg-flare" label="Automatic promotion" />
          <Legend className="bg-flare/40" label="Play-offs" />
          <Legend className="bg-ember" label="Relegation" />
        </div>
        <span className="sm:hidden">Swipe for GD &amp; Pts →</span>
      </div>
    </section>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx("h-2 w-2 rounded-full", className)} />
      {label}
    </span>
  );
}
