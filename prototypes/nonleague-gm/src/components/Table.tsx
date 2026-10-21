import clsx from "clsx";

import { ClubCrest } from "@/components/Identity";
import { tierName } from "@/engine/career";
import { computeTable } from "@/engine/league";
import type { Career } from "@/engine/types";

interface Props {
  career: Career;
}

/**
 * The league table.
 *
 * Clean is the brief, so: badges instead of colour bars, a fixed column rhythm,
 * tabular figures right-aligned, and one lime row. The zone marker is a hairline
 * on the left edge rather than a coloured cell — the table has to survive being
 * read on a phone in a pub.
 */
export function Table({ career }: Props) {
  const clubs = Object.values(career.clubs);
  const table = computeTable(clubs, career.fixtures);
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const tier = clubs[0]?.tier ?? career.totalTiers;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div>
          <h2 className="display text-xl leading-none">{tierName(tier, career.totalTiers)}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/55">
            Season {career.season} · matchday {career.week}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-chalk/50">
          {career.fixtures.filter((f) => f.played).length}/{career.fixtures.length} played
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-white/[0.07]">
              <th className="w-9 px-2 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk/50">#</th>
              <th className="px-2 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk/50">Club</th>
              {["P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map((label) => (
                <th
                  key={label}
                  className={clsx(
                    "w-9 px-1.5 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.14em]",
                    label === "Pts" ? "w-11 pr-4 text-flare/70" : "text-chalk/50",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map((row, index) => {
              const club = clubById.get(row.clubId);
              const mine = row.clubId === career.playerClubId;
              const zone =
                index < 2 ? "promotion" : index < 6 ? "playoff" : index >= table.length - 3 ? "relegation" : null;

              return (
                <tr
                  key={row.clubId}
                  data-testid="table-row"
                  data-mine={mine ? "true" : "false"}
                  className={clsx(
                    "border-b border-white/[0.04] last:border-0",
                    mine ? "bg-flare/[0.07]" : "hover:bg-white/[0.025]",
                  )}
                >
                  <td className="relative px-2 py-2 font-mono text-[11px] tabular-nums text-chalk/55">
                    {zone && (
                      <span
                        className={clsx(
                          "absolute inset-y-1 left-0 w-0.5 rounded-full",
                          zone === "promotion" && "bg-flare",
                          zone === "playoff" && "bg-flare/40",
                          zone === "relegation" && "bg-ember",
                        )}
                      />
                    )}
                    {index + 1}
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2">
                      {club && (
                        <ClubCrest
                          clubId={club.id}
                          name={club.name}
                          colors={club.colors}
                          short={club.short}
                          crestUrl={club.crestUrl}
                          className="h-5 w-5 shrink-0"
                        />
                      )}
                      <span className={clsx("truncate", mine && "font-semibold text-flare")}>
                        {club?.name ?? row.clubId}
                      </span>
                    </span>
                  </td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums text-chalk/50">{row.played}</td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums">{row.won}</td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums">{row.drawn}</td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums">{row.lost}</td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums text-chalk/60">{row.goalsFor}</td>
                  <td className="px-1.5 py-2 text-right font-mono tabular-nums text-chalk/60">{row.goalsAgainst}</td>
                  <td
                    className={clsx(
                      "px-1.5 py-2 text-right font-mono tabular-nums",
                      row.goalDifference > 0
                        ? "text-flare/80"
                        : row.goalDifference < 0
                          ? "text-ember/80"
                          : "text-chalk/60",
                    )}
                  >
                    {row.goalDifference > 0 ? "+" : ""}
                    {row.goalDifference}
                  </td>
                  <td className="py-2 pl-1.5 pr-4 text-right font-mono font-bold tabular-nums">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-3 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-chalk/55">
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
