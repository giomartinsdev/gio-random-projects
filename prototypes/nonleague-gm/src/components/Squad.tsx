import clsx from "clsx";
import { useMemo, useState } from "react";

import { ClubCrest, PlayerFace } from "@/components/Identity";
import { PlayerCard } from "@/components/PlayerCard";
import { attributesOf, positionLabel } from "@/engine/identity";
import { pickLineup } from "@/engine/squad";
import type { Career, Player } from "@/engine/types";
import { money } from "@/lib/format";

interface Props {
  career: Career;
}

type SortKey = "position" | "ability" | "age" | "wage";

/**
 * The squad.
 *
 * A grid of player cards, because a squad *is* a set of people — and a table of
 * twenty rows is how you look up a person, not how you build a team. The table is
 * still there, one toggle away, for the people who want to compare wages.
 */
export function Squad({ career }: Props) {
  const club = career.clubs[career.playerClubId];
  const [sort, setSort] = useState<SortKey>("position");
  const [view, setView] = useState<"cards" | "list">("cards");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        const order: Record<Player["position"], number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
        return copy.sort((a, b) => order[a.position] - order[b.position] || b.ability - a.ability);
      }
    }
  }, [club.players, sort]);

  const selected = players.find((p) => p.id === selectedId) ?? players[0];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08]">
        <div
          className="absolute inset-0 opacity-70"
          aria-hidden
          style={{
            background: `radial-gradient(ellipse 70% 140% at 12% 0%, ${club.colors.primary} 0%, transparent 60%),
                         linear-gradient(160deg, #0a1b13, #06120d)`,
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <ClubCrest
              clubId={club.id}
              name={club.name}
              colors={club.colors}
              short={club.short}
              crestUrl={club.crestUrl}
              className="h-12 w-12"
            />
            <div>
              <h2 className="display text-2xl leading-none">The squad</h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/50">
                {club.players.length} players · {starters.size} in the XI
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-white/10 p-0.5">
              {(["cards", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  className={clsx(
                    "rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition",
                    view === mode ? "bg-white/10 text-chalk" : "text-chalk/55 hover:text-chalk",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(["position", "ability", "age", "wage"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={clsx(
                    "rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition",
                    sort === key ? "bg-flare/15 text-flare" : "text-chalk/55 hover:text-chalk",
                  )}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {view === "cards" ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
              data-testid="squad-grid"
            >
              {players.map((player, index) => (
                <button
                  key={player.id}
                  onClick={() => setSelectedId(player.id)}
                  className={clsx(
                    "text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flare",
                    selected?.id === player.id ? "scale-[1.015]" : "hover:-translate-y-0.5",
                  )}
                  aria-pressed={selected?.id === player.id}
                >
                  <PlayerCard player={player} club={club} index={index} />
                </button>
              ))}
            </div>
          ) : (
            <section className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left">
                      <Th>Player</Th>
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
                        <td className="py-1.5 pl-3 pr-2">
                          <span className="flex items-center gap-2">
                            <PlayerFace
                              playerId={player.id}
                              age={player.age}
                              name={player.name}
                              photoUrl={player.photoUrl}
                              colors={club.colors}
                              number={player.number}
                              className="h-7 w-7 shrink-0 rounded"
                            />
                            <span className="font-medium">{player.name}</span>
                            {starters.has(player.id) && (
                              <span className="rounded bg-flare/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-flare">
                                XI
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-chalk/60">{positionLabel(player)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-chalk/60">{player.age}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{player.ability}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-chalk/60">{money(player.wage)}</td>
                        <td className="py-1.5 pl-3 pr-4 text-right">
                          <MoraleBar value={player.morale} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {selected && <PlayerInspector player={selected} club={club} starter={starters.has(selected.id)} />}
      </div>
    </div>
  );
}

/** The selected player, at poster size: face, rating, six attributes, contract. */
function PlayerInspector({
  player,
  club,
  starter,
}: {
  player: Player;
  club: Career["clubs"][string];
  starter: boolean;
}) {
  const attributes = attributesOf(player);

  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start" data-testid="player-inspector">
      <section className="player-card overflow-hidden">
        <div
          className="relative overflow-hidden"
          style={{
            background: `radial-gradient(ellipse 90% 80% at 50% 0%, ${club.colors.primary} 0%, transparent 72%)`,
          }}
        >
          <PlayerFace
            playerId={player.id}
            age={player.age}
            name={player.name}
            photoUrl={player.photoUrl}
            colors={club.colors}
            number={player.number}
            className="h-52 w-full motion-safe:animate-pop"
          />
          <div className="absolute left-3 top-3">
            <p className="display text-5xl leading-none">{player.ability}</p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-chalk/60">
              {positionLabel(player)}
            </p>
          </div>
          {starter && (
            <span className="absolute right-3 top-3 rounded bg-flare px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-pitch-950">
              Starting XI
            </span>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-lg font-semibold leading-tight">{player.name}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-chalk/55">
            {player.age} · {club.short}
            {player.nationality ? ` · ${player.nationality}` : ""}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3">
          {(
            [
              ["Pace", attributes.pace],
              ["Shooting", attributes.shooting],
              ["Passing", attributes.passing],
              ["Dribbling", attributes.dribbling],
              ["Defending", attributes.defending],
              ["Physical", attributes.physical],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between">
                <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/55">{label}</dt>
                <dd className="font-mono text-[11px] font-bold tabular-nums">{value}</dd>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${value}%`,
                    background: value >= 70 ? "#c8f751" : value >= 55 ? "#8fbf6a" : "#6c7f70",
                  }}
                />
              </div>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-2 border-t border-white/10 px-4 py-3 text-[11px]">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/50">Wage</p>
            <p className="font-mono tabular-nums text-chalk/85">{money(player.wage)}/wk</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/50">Value</p>
            <p className="font-mono tabular-nums text-chalk/85">{money(player.value)}</p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h3 className="label">Morale</h3>
        <div className="mt-2 flex items-center gap-3">
          <MoraleBar value={player.morale} />
          <span className="text-[11px] text-chalk/55">
            {player.morale >= 70 ? "Happy" : player.morale >= 45 ? "Settled" : "Unsettled"}
          </span>
        </div>
      </section>
    </aside>
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
      <span className="w-6 text-right font-mono text-xs tabular-nums text-chalk/55">{value}</span>
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={clsx(
        "px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk/50 first:pl-4 last:pr-4",
        className,
      )}
    >
      {children}
    </th>
  );
}
