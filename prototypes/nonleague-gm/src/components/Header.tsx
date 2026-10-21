import clsx from "clsx";

import { ClubCrest, PlayerFace } from "@/components/Identity";
import { boardConfidence } from "@/engine/board";
import { tierName } from "@/engine/career";
import { starPlayer } from "@/engine/squad";
import type { Career } from "@/engine/types";
import { money, ordinal } from "@/lib/format";

/**
 * The club bar.
 *
 * A management game's header is the one piece of UI a player looks at a thousand
 * times, so it carries identity rather than metrics: the badge, the club, the
 * captain's face, and the three numbers that decide whether you are sacked
 * (balance, week, board). It is styled as a scoreboard strip, not a page header —
 * angled colour block, condensed type, hairline separators.
 */
export function Header({ career }: { career: Career }) {
  const club = career.clubs[career.playerClubId];
  const confidence = boardConfidence(career);
  const captain = starPlayer(club);

  return (
    <header className="relative overflow-hidden border-b border-white/[0.08] bg-pitch-950/85 backdrop-blur">
      {/* Club colour bleed: the identity of the club is the background of the bar. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        aria-hidden
        style={{
          background: `radial-gradient(ellipse 55% 140% at 8% 40%, ${club.colors.primary} 0%, transparent 62%),
                       radial-gradient(ellipse 40% 120% at 92% 60%, ${club.colors.secondary} 0%, transparent 60%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${club.colors.secondary}, transparent)` }}
        aria-hidden
      />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <ClubCrest
            clubId={club.id}
            name={club.name}
            colors={club.colors}
            short={club.short}
            crestUrl={club.crestUrl}
            className="h-14 w-14 shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,.55)]"
          />
          <div className="min-w-0">
            <h1 className="display truncate text-[26px] leading-none tracking-tight sm:text-[30px]">
              {club.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-chalk/55">
              <span data-testid="club-short">{club.short}</span>
              <span className="text-chalk/50">/</span>
              <span>{tierName(club.tier, career.totalTiers)}</span>
              <span className="text-chalk/50">/</span>
              <span>Season {career.season}</span>
              <span className="text-chalk/50">/</span>
              <span className="text-flare">{ordinal(career.clubPosition)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {captain && (
            <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-black/25 py-1.5 pl-1.5 pr-3 md:flex">
              <PlayerFace
                playerId={captain.id}
                age={captain.age}
                name={captain.name}
                photoUrl={captain.photoUrl}
                photoCredit={captain.photoCredit}
                colors={club.colors}
                number={captain.number}
                className="h-9 w-9 rounded-lg"
              />
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-chalk/55">Captain</p>
                <p className="max-w-[120px] truncate text-xs font-semibold">{captain.name}</p>
              </div>
            </div>
          )}

          <dl className="flex items-stretch gap-1.5">
            <Stat label="Balance" value={money(club.balance)} tone={club.balance < 0 ? "bad" : "good"} />
            <Stat label="Week" value={`${career.week}/${career.totalWeeks}`} />
            <Stat
              label="Board"
              value={`${confidence}%`}
              tone={confidence < 35 ? "bad" : confidence > 65 ? "good" : "neutral"}
            />
          </dl>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label: name,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="min-w-[76px] rounded-xl border border-white/[0.09] bg-black/30 px-2.5 py-1.5">
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-chalk/55">{name}</dt>
      <dd
        className={clsx(
          "mt-0.5 font-mono text-[13px] font-semibold tabular-nums",
          tone === "good" && "text-flare",
          tone === "bad" && "text-ember",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
