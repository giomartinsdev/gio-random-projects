import clsx from "clsx";
import { useMemo, useState } from "react";

import { STADIUM_UPGRADE_COST } from "@/engine/career";
import { Rng } from "@/engine/rng";
import type { Career, FreeAgent, Position } from "@/engine/types";
import { exactMoney, money } from "@/lib/format";

interface Props {
  career: Career;
  onSign: (target: FreeAgent) => { ok: boolean; reason?: string };
  onUpgrade: () => { ok: boolean; reason?: string };
}

/**
 * A deterministic shortlist of free agents.
 *
 * Generated from the career seed rather than stored, so it is stable across
 * reloads without bloating the save. Refreshing the page does not let you reroll
 * into a better market — which is the point.
 */
export function freeAgents(career: Career): FreeAgent[] {
  const rng = new Rng(career.seed, 9001);
  const positions: Position[] = ["GK", "DF", "MF", "FW"];
  const first = ["Ash", "Cole", "Dane", "Ezra", "Jude", "Kit", "Luca", "Milo", "Niall", "Otto", "Rory", "Seth", "Toby", "Vinnie"];
  const last = ["Abbott", "Bexley", "Chase", "Dunlop", "Fairbairn", "Gable", "Huxley", "Ives", "Keel", "Lomax", "Marsh", "Nagle", "Pace", "Rowe"];

  return Array.from({ length: 6 }, (_, index) => {
    const ability = rng.int(42, 68);
    const fee = rng.chance(0.4) ? 0 : rng.int(8_000, 60_000);

    return {
      id: `fa-${career.seed}-${index}`,
      name: `${rng.pick(first)} ${rng.pick(last)}`,
      position: positions[rng.int(0, 3)],
      age: rng.int(18, 33),
      ability,
      wage: Math.round((ability - 30) * 22 + 180),
      value: Math.round(Math.pow(Math.max(1, ability - 24), 2.1) * 12),
      fee,
    };
  });
}

export function Transfers({ career, onSign, onUpgrade }: Props) {
  const club = career.clubs[career.playerClubId];
  const agents = useMemo(() => freeAgents(career), [career.seed]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSign = (target: FreeAgent) => {
    const result = onSign(target);
    setMessage({
      ok: result.ok,
      text: result.ok
        ? `${target.name} signs for ${club.name}.`
        : (result.reason ?? "The signing failed."),
    });
  };

  const handleUpgrade = () => {
    const result = onUpgrade();
    setMessage({
      ok: result.ok,
      text: result.ok ? "The new stand is open." : (result.reason ?? "The upgrade failed."),
    });
  };

  return (
    <div className="space-y-5">
      {message && (
        <p
          role="status"
          className={clsx(
            "rounded-xl border px-4 py-3 text-sm",
            message.ok
              ? "border-flare/30 bg-flare/[0.08] text-flare"
              : "border-ember/30 bg-ember/[0.08] text-ember",
          )}
        >
          {message.text}
        </p>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <h2 className="label">Transfer market</h2>
          <span className="font-mono text-xs text-chalk/40">
            Balance {exactMoney(club.balance)}
          </span>
        </div>

        <ul className="divide-y divide-white/[0.04]">
          {agents.map((target) => {
            const affordable = target.fee <= club.balance;
            return (
              <li
                key={target.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] font-mono text-[11px] font-bold text-chalk/70">
                  {target.position}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{target.name}</span>
                  <span className="block font-mono text-xs text-chalk/40">
                    Age {target.age} · Rating {target.ability} · {money(target.wage)}/wk
                  </span>
                </span>
                <span className="font-mono text-sm tabular-nums">
                  {target.fee === 0 ? (
                    <span className="text-flare">Free</span>
                  ) : (
                    money(target.fee)
                  )}
                </span>
                <button
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => handleSign(target)}
                  disabled={!affordable}
                  title={affordable ? undefined : "The club cannot afford this fee"}
                >
                  Sign
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="label">Ground improvements</h2>
        <p className="mt-1 text-sm text-chalk/50">
          A new stand adds 1,200 seats and lifts the mood. Bigger crowds mean
          bigger gate receipts — if you can fill it.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <div>
            <p className="text-sm font-medium">
              Capacity {club.capacity.toLocaleString("en-GB")}
            </p>
            <p className="font-mono text-xs text-chalk/40">
              Cost {exactMoney(STADIUM_UPGRADE_COST)}
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={handleUpgrade}
            disabled={club.balance < STADIUM_UPGRADE_COST}
          >
            Build a stand
          </button>
        </div>
      </section>
    </div>
  );
}
