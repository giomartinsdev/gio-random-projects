import clsx from "clsx";

import { boardConfidence } from "@/engine/board";
import { tierName } from "@/engine/career";
import type { Career } from "@/engine/types";
import { money, ordinal } from "@/lib/format";

interface Props {
  career: Career;
}

export function Header({ career }: Props) {
  const club = career.clubs[career.playerClubId];
  const confidence = boardConfidence(career);

  return (
    <header className="border-b border-white/[0.07] bg-pitch-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-sm font-extrabold tracking-tight shadow-floodlight"
            style={{
              background: `linear-gradient(135deg, ${club.colors.primary}, ${club.colors.secondary})`,
            }}
            data-testid="club-short"
            aria-hidden
          >
            {club.short}
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight tracking-tight">
              {club.name}
            </h1>
            <p className="text-sm text-chalk/50">
              {tierName(club.tier, career.totalTiers)} · Season {career.season} ·{" "}
              {ordinal(career.clubPosition)} place
            </p>
          </div>
        </div>

        <dl className="flex items-stretch gap-2 text-sm">
          <Stat label="Balance" value={money(club.balance)} tone={club.balance < 0 ? "bad" : "good"} />
          <Stat label="Week" value={`${career.week}/${career.totalWeeks}`} />
          <Stat
            label="Board"
            value={`${confidence}%`}
            tone={confidence < 35 ? "bad" : confidence > 65 ? "good" : "neutral"}
          />
        </dl>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="min-w-[86px] rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <dt className="label">{label}</dt>
      <dd
        className={clsx(
          "mt-0.5 font-mono text-sm font-semibold tabular-nums",
          tone === "good" && "text-flare",
          tone === "bad" && "text-ember",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
