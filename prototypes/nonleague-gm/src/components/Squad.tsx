import clsx from "clsx";
import { useMemo, useState } from "react";

import { pickLineup } from "@/engine/squad";
import type { Career, Player } from "@/engine/types";
import { money } from "@/lib/format";

interface Props {
  career: Career;
}

type SortKey = "ability" | "position" | "age" | "wage";

export function Squad({ career }: Props) {
  const club = career.clubs[career.playerClubId];
  const [sort, setSort] = useState<SortKey>("ability");

  const starters = useMemo(() => new Set(pickLineup(club).map((p) => p.id)), [club]);

  const players = useMemo(() => {
    const copy = [...club.players];
    switch (sort) {
      case "ability":
        return copy.sort((a, b) => b.ability - a.ability);
      case "age":
        return copy.sort((a, b) => a.age - b.age);
      case "wage":
        return copy.sort((a, b) => b.wage - a.wage);
      case "position":
      default: {
        const order: Record<Player["position"], number> = {
          GK: 0,
          DF: 1,
          MF: 2,
          FW: 3,
        };
        return copy.sort(
          (a, b) => order[a.position] - order[b.position] || b.ability - a.ability,
        );
      }
    }
  }, [club.players, sort]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <h2 className="label">Squad · {club.players.length} players</h2>
        <div className="flex gap-1">
          {(["position", "ability", "age", "wage"] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={clsx("tab", sort === key && "tab-active")}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.07] text-left">
              <Th>Name</Th>
              <Th>Pos</Th>
              <Th className="text-right">Age</Th>
              <Th className="text-right">Rating</Th>
              <Th className="text-right">Wage</Th>
              <Th className="text-right">Morale</Th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr
                key={player.id}
                data-testid="squad-row"
                data-position={player.position}
                data-rating={player.ability}
                className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-5 py-2.5">
                  <span className="font-medium">{player.name}</span>
                  {starters.has(player.id) && (
                    <span className="ml-2 rounded bg-flare/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-flare">
                      XI
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-chalk/60">
                  {player.position}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-chalk/60">
                  {player.age}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                  {player.ability}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-chalk/60">
                  {money(player.wage)}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <MoraleBar value={player.morale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MoraleBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
        <span
          className={clsx(
            "block h-full rounded-full",
            value >= 70 ? "bg-flare" : value >= 45 ? "bg-chalk/50" : "bg-ember",
          )}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="w-6 text-right font-mono text-xs tabular-nums text-chalk/45">
        {value}
      </span>
    </span>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={clsx(
        "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-chalk/35 first:pl-5 last:pr-5",
        className,
      )}
    >
      {children}
    </th>
  );
}
