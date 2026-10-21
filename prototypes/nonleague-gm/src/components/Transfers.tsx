import clsx from "clsx";
import { useMemo, useState } from "react";

import { PlayerFace } from "@/components/Identity";
import { STADIUM_UPGRADE_COST } from "@/engine/career";
import { attributesOf, positionLabel, shirtNumber } from "@/engine/identity";
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

/**
 * The market.
 *
 * A list of names with an asking price is a spreadsheet with a buy button. The
 * same six players as cards — face, rating, six attributes — turn the decision
 * into "do I want *him*", which is the decision a football game is made of.
 */
export function Transfers({ career, onSign, onUpgrade }: Props) {
  const club = career.clubs[career.playerClubId];
  const agents = useMemo(() => freeAgents(career), [career.seed]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [signed, setSigned] = useState<string[]>([]);

  const handleSign = (target: FreeAgent) => {
    const result = onSign(target);
    if (result.ok) setSigned((current) => [...current, target.id]);
    setMessage({
      ok: result.ok,
      text: result.ok ? `${target.name} signs for ${club.name}.` : (result.reason ?? "The signing failed."),
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
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08]">
        <div
          className="absolute inset-0 opacity-60"
          aria-hidden
          style={{
            background: `radial-gradient(ellipse 70% 140% at 10% 0%, ${club.colors.primary} 0%, transparent 62%), linear-gradient(160deg,#0a1b13,#06120d)`,
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="display text-2xl leading-none">Transfer market</h2>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/50">
              {agents.length} available · {signed.length} signed this window
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-chalk/55">Balance</p>
            <p className="display text-2xl leading-none text-flare">{exactMoney(club.balance)}</p>
          </div>
        </div>
      </section>

      {message && (
        <p
          role="status"
          className={clsx(
            "rounded-xl border px-4 py-3 text-sm motion-safe:animate-rise",
            message.ok
              ? "border-flare/30 bg-flare/[0.08] text-flare"
              : "border-ember/30 bg-ember/[0.08] text-ember",
          )}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="market">
        {agents.map((target, index) => {
          const affordable = target.fee <= club.balance;
          const done = signed.includes(target.id);
          const attributes = attributesOf(target);

          return (
            <article
              key={target.id}
              className="player-card p-3 motion-safe:animate-rise"
              data-testid="market-card"
              data-position={target.position}
              data-rating={target.ability}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <div className="flex gap-3">
                <div className="shrink-0 text-center">
                  <p className="display text-4xl leading-none">{target.ability}</p>
                  <p className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-chalk/55">
                    {positionLabel(target)}
                  </p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-chalk/50">
                    Age {target.age}
                  </p>
                </div>

                <PlayerFace
                  playerId={target.id}
                  age={target.age}
                  name={target.name}
                  colors={club.colors}
                  number={shirtNumber(6 + index)}
                  className="h-[92px] flex-1 rounded-lg"
                />
              </div>

              <p className="mt-2 truncate border-b border-white/10 pb-1.5 text-sm font-semibold">
                {target.name}
              </p>

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

              <div className="mt-3 flex items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-chalk/50">Fee</p>
                  <p className="font-mono text-sm font-bold tabular-nums">
                    {target.fee === 0 ? <span className="text-flare">Free</span> : money(target.fee)}
                  </p>
                  <p className="font-mono text-[10px] text-chalk/50">{money(target.wage)}/wk</p>
                </div>
                <button
                  className={clsx("btn text-xs", done ? "btn-ghost" : "btn-primary")}
                  onClick={() => handleSign(target)}
                  disabled={!affordable || done}
                  title={affordable ? undefined : "The club cannot afford this fee"}
                >
                  {done ? "Signed" : affordable ? "Sign" : "Too dear"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <h2 className="display text-xl leading-none">Ground improvements</h2>
            <p className="mt-1.5 text-sm text-chalk/55">
              A new stand adds 1,200 seats and lifts the mood. Bigger crowds mean bigger gate
              receipts — if you can fill it.
            </p>
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-chalk/55">Capacity</p>
              <p className="font-mono text-lg font-bold tabular-nums">
                {club.capacity.toLocaleString("en-GB")}
              </p>
              <p className="font-mono text-[10px] text-chalk/50">Cost {exactMoney(STADIUM_UPGRADE_COST)}</p>
            </div>
            <button
              className="btn-primary"
              onClick={handleUpgrade}
              disabled={club.balance < STADIUM_UPGRADE_COST}
            >
              Build a stand
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
