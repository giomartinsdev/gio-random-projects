import { useMemo, useState } from "react";

import {
  createFriendLeague,
  friendStandings,
  headToHead,
  MISS_LIMIT,
  mentalityFor,
  recordMatchday,
  resolveMatchday,
  submit,
  takeover,
  waitingOn,
  windowState,
  type FriendLeague,
  type Manager,
} from "@/engine/friendLeague";
import { computeTable } from "@/engine/league";
import type { Career, Mentality } from "@/engine/types";
import { ordinal } from "@/lib/format";
import clsx from "clsx";

import { ClubCrest } from "@/components/Identity";

interface Props {
  career: Career;
  league: FriendLeague;
  onLeague: (league: FriendLeague) => void;
  /**
   * Plays the matchday in the engine and returns the result rows.
   *
   * The resolved window is handed back with the picks, because the league's
   * archive has to be written against the *new* career — otherwise App would
   * append results to a league object that is about to be overwritten by the
   * resolved window.
   */
  onResolve: (
    mentalities: Record<string, Mentality>,
    resolved: FriendLeague,
  ) => void;
}

const FRIEND_NAMES = ["Dan", "Priya", "Tom", "Aisha", "Callum"];
const PREFERRED_CLUBS = [
  "Uppermill County",
  "Kestrel Park",
  "Larkhall City",
  "Dunmere Town",
  "Quarrydale United",
];

/**
 * Builds the demo league from the career's own division.
 *
 * The clubs are taken from the save rather than hardcoded, because a league
 * whose members are not in your division is not a league — it is a friends list.
 */
export function buildLeague(career: Career): FriendLeague {
  const clubs = Object.values(career.clubs);
  const mine = career.clubs[career.playerClubId];
  const rivals: { id: string; name: string; clubId: string }[] = [];
  const used = new Set([mine.id]);

  for (const name of PREFERRED_CLUBS) {
    const club = clubs.find((c) => c.name === name && !used.has(c.id));
    if (club && rivals.length < FRIEND_NAMES.length) {
      used.add(club.id);
      rivals.push({
        id: `m-${FRIEND_NAMES[rivals.length].toLowerCase()}`,
        name: FRIEND_NAMES[rivals.length],
        clubId: club.id,
      });
    }
  }
  // Small divisions in tests may not carry all five preferred clubs.
  for (const club of clubs) {
    if (rivals.length >= FRIEND_NAMES.length) break;
    if (used.has(club.id)) continue;
    used.add(club.id);
    rivals.push({
      id: `m-${FRIEND_NAMES[rivals.length].toLowerCase()}`,
      name: FRIEND_NAMES[rivals.length],
      clubId: club.id,
    });
  }

  return createFriendLeague({
    name: "The Sunday Lads",
    commissioner: { id: "m-gio", name: "Gio", clubId: mine.id },
    rivals,
    season: career.season,
  });
}

/**
 * The friends' picks, derived from the league and the matchday.
 *
 * Deterministic on purpose: the same save always produces the same opponents'
 * shapes, so a reload cannot reroll your rivals into a kinder week. This is the
 * stand-in for the server that a real league would use.
 */
export function simulatedPicks(
  league: FriendLeague,
  excludeId = "m-gio",
): Record<string, Mentality> {
  const shapes: Mentality[] = ["cautious", "balanced", "attacking"];
  const picks: Record<string, Mentality> = {};
  league.members.forEach((member, index) => {
    if (member.id === excludeId) return;
    const roll = (league.matchday * 7 + index * 13 + league.name.length) % 9;
    picks[member.id] = shapes[roll % 3];
  });
  return picks;
}

export function LeagueScreen({ career, league, onLeague, onResolve }: Props) {
  const [pick, setPick] = useState<Mentality>("balanced");
  const clubs = Object.values(career.clubs);
  const table = useMemo(
    () => computeTable(clubs, career.fixtures),
    [clubs, career.fixtures],
  );
  const tier = clubs[0]?.tier ?? career.totalTiers;
  const me = league.members.find((m) => m.id === league.commissionerId);
  const waiting = waitingOn(league);
  const locked = windowState(league) === "locked";
  const standings = friendStandings(league, table, tier);
  const myEntry = standings.find((s) => s.managerId === league.commissionerId);
  const h2h = headToHead(league, league.commissionerId);
  const playedH2h = h2h.filter((h) => h.played > 0);

  /**
   * Plays the matchday that is currently sitting in the window.
   *
   * The picks are read *before* the window resolves, because resolving clears
   * them. Non-submitters fall back to balanced via `mentalityFor`, which is the
   * same treatment a caretaker club gets.
   */
  function playWindow(source: FriendLeague, resolved: FriendLeague) {
    const mentalities: Record<string, Mentality> = {};
    for (const member of source.members) {
      mentalities[member.clubId] = mentalityFor(source, member.clubId);
    }
    onResolve(mentalities, resolved);
  }

  function lockIn() {
    if (!me) return;
    // Your pick goes through the real submit path, so the rule that a caretaker
    // club cannot pick still applies. Rivals' picks are a local stand-in for
    // the server: deterministic for a given matchday, never re-rolled.
    const next = submit(league, me.id, pick);
    const withRivals: FriendLeague = {
      ...next,
      picks: { ...next.picks, ...simulatedPicks(next) },
    };

    // Resolving the window is what advances the matchday and wipes the picks;
    // without it the league would stay frozen on matchday one forever.
    const { league: resolved } = resolveMatchday(withRivals);
    playWindow(withRivals, resolved);
  }

  function closeWindow() {
    // The deadline passed: anyone who never picked is auto-simmed at balanced
    // rather than blocking the other five.
    const { league: resolved } = resolveMatchday(league, { force: true });
    playWindow(league, resolved);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-flare">
                Private league · {league.code}
              </p>
              <h2 className="display text-3xl leading-none text-chalk">
                {league.name}
              </h2>
              {myEntry && (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-chalk/55">
                  You · {ordinal(myEntry.position)} · {myEntry.points} pts
                </p>
              )}
            </div>
            <span
              data-testid="league-window"
              className="font-mono text-[11px] text-chalk/55"
            >
              Matchday {league.matchday} · {league.members.length} managers ·{" "}
              {league.windowHours}h window
            </span>
          </div>

          <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <p className="label">Your pick · ready signal</p>
              <p className="mt-1 text-sm text-chalk/60">
                A pick is your ready signal. Nobody sees anyone else&apos;s until
                the window shuts.
              </p>
              <div className="mt-3 flex gap-2">
                {(["cautious", "balanced", "attacking"] as Mentality[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPick(m)}
                    aria-pressed={pick === m}
                    className={clsx(
                      "flex-1 rounded-lg px-3 py-2 text-xs font-semibold capitalize transition min-h-[44px] sm:min-h-0",
                      pick === m
                        ? "bg-flare text-pitch-950"
                        : "bg-white/[0.04] text-chalk/60 hover:text-chalk",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="btn-primary text-sm" onClick={lockIn}>
                  Lock in &amp; play matchday
                </button>
                <button
                  className="btn-ghost text-sm"
                  onClick={closeWindow}
                  disabled={league.matchday > career.totalWeeks}
                >
                  Close window (auto-sim)
                </button>
              </div>
              <p className="mt-3 text-xs text-chalk/50">
                Prototype: your five friends are simulated on this device. The
                rules in <span className="font-mono">friendLeague.ts</span> are
                what a server would run.
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <p className="label">Ready</p>
                <p className="font-mono text-xs text-flare">
                  {league.members.length - waiting.length} / {league.members.length}
                </p>
              </div>
              <ul className="mt-2 space-y-1.5">
                {league.members.map((member) => (
                  <ReadyRow
                    key={member.id}
                    member={member}
                    career={career}
                    club={career.clubs[member.clubId]?.name ?? member.clubId}
                    ready={Boolean(league.picks[member.id])}
                  />
                ))}
              </ul>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-chalk/50">
                {locked ? "All in · resolving" : `${waiting.length} still to pick`}
              </p>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3">
            <h3 className="display text-lg leading-none">Head to head</h3>
            <span className="font-mono text-[10px] text-chalk/50">
              {playedH2h.reduce((sum, h) => sum + h.played, 0)} your meetings
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left">
                {["Rival", "P", "W", "D", "L", "GF", "GA", "Pts", "Last"].map((h) => (
                  <th
                    key={h}
                    className={clsx(
                      "px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-wider text-chalk/50",
                      h === "Rival" ? "text-left" : "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h2h.map((record) => {
                const member = league.members.find((m) => m.id === record.opponentId);
                return (
                  <tr
                    key={record.opponentId}
                    data-testid="h2h-row"
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        {career.clubs[member?.clubId ?? ""] && (
                          <ClubCrest
                            clubId={member?.clubId ?? ""}
                            name={career.clubs[member?.clubId ?? ""].name}
                            colors={career.clubs[member?.clubId ?? ""].colors}
                            short={career.clubs[member?.clubId ?? ""].short}
                            crestUrl={career.clubs[member?.clubId ?? ""].crestUrl}
                            className="h-5 w-5 shrink-0"
                          />
                        )}
                        <span className="font-semibold text-chalk">{record.opponentName}</span>
                        <span className="truncate text-xs text-chalk/50">
                          {career.clubs[member?.clubId ?? ""]?.name}
                        </span>
                      </span>
                    </td>
                    {[
                      record.played,
                      record.won,
                      record.drawn,
                      record.lost,
                      record.goalsFor,
                      record.goalsAgainst,
                    ].map((value, i) => (
                      <td
                        key={i}
                        className="px-3 py-2.5 text-right font-mono tabular-nums text-chalk/60"
                      >
                        {value}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums">
                      {record.points}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[10px] text-chalk/50">
                      {record.last ? `${record.last.score}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
          <p className="border-t border-white/[0.07] px-5 py-2.5 text-xs text-chalk/50">
            Only matches between two managers count. A 6–0 win over an AI club is
            worth nothing here.
          </p>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
            <h3 className="display text-lg leading-none">The friend table</h3>
            <span className="font-mono text-[10px] text-chalk/50">
              MD {Math.max(0, career.week)}
            </span>
          </div>
          <ul>
            {standings.map((entry, index) => (
              <li
                key={entry.managerId}
                data-testid="friend-row"
                className={clsx(
                  "flex items-center gap-2 px-4 py-2",
                  entry.managerId === league.commissionerId && "bg-flare/[0.08]",
                )}
              >
                <span className="w-4 font-mono text-[10px] text-chalk/50">
                  {index + 1}
                </span>
                <span
                  className={clsx(
                    "flex-1 truncate text-xs",
                    entry.managerId === league.commissionerId
                      ? "font-semibold text-flare"
                      : "text-chalk/80",
                  )}
                >
                  {entry.managerName}
                </span>
                {career.clubs[entry.clubId] && (
                  <ClubCrest
                    clubId={entry.clubId}
                    name={career.clubs[entry.clubId].name}
                    colors={career.clubs[entry.clubId].colors}
                    short={career.clubs[entry.clubId].short}
                    crestUrl={career.clubs[entry.clubId].crestUrl}
                    className="h-4 w-4 shrink-0"
                  />
                )}
                <span className="w-8 text-right font-mono text-[10px] text-chalk/55">
                  {entry.played ? ordinal(entry.position) : "—"}
                </span>
                <span className="w-7 text-right font-mono text-xs font-semibold tabular-nums">
                  {entry.points}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-white/[0.07] px-4 py-2.5 text-[11px] leading-relaxed text-chalk/50">
            Ranked by league position. A friend promoted above you beats you, even
            on fewer points.
          </p>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
            <h3 className="display text-lg leading-none">Honours</h3>
            <span className="font-mono text-[10px] text-chalk/50">
              {league.honours.length} crowned
            </span>
          </div>
          {league.honours.length === 0 ? (
            <p className="px-4 py-4 text-xs text-chalk/55">
              No season has finished yet. The champion is whoever ends highest up
              the pyramid.
            </p>
          ) : (
            <ul>
              {[...league.honours].reverse().map((honour) => (
                <li
                  key={honour.season}
                  className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2 last:border-0"
                >
                  <span className="w-12 font-mono text-[10px] text-chalk/50">
                    {honour.season}
                  </span>
                  <span className="flex-1 truncate text-xs text-chalk/80">
                    {honour.managerName}
                  </span>
                  <span className="font-mono text-[10px] text-chalk/50">
                    T{honour.tier} · {ordinal(honour.position)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card px-4 py-3">
          <p className="display text-lg leading-none">Caretaker rule</p>
          <p className="mt-1 text-xs leading-relaxed text-chalk/50">
            Miss {MISS_LIMIT} deadlines and the club goes to a caretaker. The
            table keeps its history; anyone can take the seat.
          </p>
          {league.members.some((m) => m.misses > 0) && (
            <button
              className="btn-ghost mt-3 w-full text-xs"
              onClick={() => {
                const idle = league.members.find((m) => m.status === "idle");
                if (idle) onLeague(takeover(league, idle.id, "Sophie"));
              }}
            >
              Hand the idle club to a new manager
            </button>
          )}
        </section>

        {league.matchday > career.totalWeeks && (
          <section className="card px-4 py-3">
            <p className="label">Season over</p>
            <p className="mt-1 text-xs text-chalk/50">
              End the season from the top bar to crown a champion and start the
              next one.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

function ReadyRow({
  member,
  career,
  club,
  ready,
}: {
  member: Manager;
  career: Career;
  club: string;
  ready: boolean;
}) {
  const memberClub = career.clubs[member.clubId];
  return (
    <li className="flex items-center gap-2 text-xs" data-manager={member.id}>
      <span
        aria-hidden
        className={clsx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          member.status === "idle" ? "bg-ember" : ready ? "bg-flare" : "bg-white/20",
        )}
      />
      {memberClub && (
        <ClubCrest
          clubId={memberClub.id}
          name={memberClub.name}
          colors={memberClub.colors}
          short={memberClub.short}
          crestUrl={memberClub.crestUrl}
          className="h-5 w-5 shrink-0"
        />
      )}
      <span className="w-12 shrink-0 font-semibold text-chalk/80">{member.name}</span>
      <span className="flex-1 truncate text-chalk/50">{club}</span>
      <span className="font-mono text-[9px] uppercase tracking-wider text-chalk/50">
        {member.status === "idle" ? "caretaker" : ready ? "in" : "waiting"}
      </span>
    </li>
  );
}

/** Records the matchday just played into the friend league's own archive. */
export function archiveMatchday(
  league: FriendLeague,
  career: Career,
): FriendLeague {
  // Read from the fixture list, not from `results`: `results` is an append-only
  // matchweek log with no fixture id, so pairing it back to a week is guesswork.
  const rows = career.fixtures
    .filter((f) => f.week === career.week && f.played && f.result)
    .map((f) => ({
      season: career.season,
      week: f.week,
      homeClubId: f.homeId,
      awayClubId: f.awayId,
      homeGoals: f.result?.homeGoals ?? 0,
      awayGoals: f.result?.awayGoals ?? 0,
    }));

  const recorded = recordMatchday(league, career.season, career.week, rows);

  // The league's matchday follows the career's, whichever screen played the
  // fixture. Without this, playing from the dashboard would leave the league
  // window sitting on a matchday that has already been simulated.
  return {
    ...recorded,
    matchday: Math.max(recorded.matchday, career.week + 1),
  };
}
