import clsx from "clsx";
import { useEffect, useState } from "react";

import { Dashboard } from "@/components/Dashboard";
import { Header } from "@/components/Header";
import { LeagueScreen, archiveMatchday, buildLeague } from "@/components/LeagueScreen";
import { MatchScreen } from "@/components/MatchScreen";
import { Squad } from "@/components/Squad";
import { Table } from "@/components/Table";
import { Transfers } from "@/components/Transfers";
import { reviewBoard } from "@/engine/board";
import {
  advanceWeek,
  createCareer,
  finishSeason,
  loadCareer,
  saveCareer,
  signPlayer,
  upgradeStadium,
} from "@/engine/career";
import {
  friendStandings,
  loadLeague,
  mentalityFor,
  recordSeason,
  saveLeague,
  type FriendLeague,
} from "@/engine/friendLeague";
import { computeTable } from "@/engine/league";
import type { Career, FreeAgent, MatchResult, Mentality } from "@/engine/types";
import { ordinal, scoreline } from "@/lib/format";

type Screen = "league" | "dashboard" | "match" | "squad" | "table" | "transfers";

const SAVE_KEY = "pyramid.save.v1";
const LEAGUE_KEY = "pyramid.league.v1";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "league", label: "League" },
  { id: "match", label: "Match" },
  { id: "squad", label: "Squad" },
  { id: "table", label: "Table" },
  { id: "transfers", label: "Transfers" },
];

export default function App() {
  const [career, setCareer] = useState<Career>(() => restore() ?? createCareer({ seed: 20260820 }));
  const [league, setLeague] = useState<FriendLeague>(() => restoreLeague(career) ?? buildLeague(career));
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [lastResult, setLastResult] = useState<MatchResult | undefined>();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(SAVE_KEY, saveCareer(career));
  }, [career]);

  useEffect(() => {
    localStorage.setItem(LEAGUE_KEY, saveLeague(league));
  }, [league]);

  const club = career.clubs[career.playerClubId];

  /**
   * Plays the matchweek with the friend league's picks.
   *
   * The picks come from the league, not from a global setting: five of the ten
   * fixtures on this matchday are managed by people, and playing every AI club
   * as "balanced" while a friend is attacking would make the league cosmetic.
   *
   * `window` is the window that has just been resolved. It replaces the picks
   * wholesale *and* receives the archive in the same update, because two
   * separate setters would race: the resolved window would land after the
   * archive and silently drop the matchday's results.
   */
  function playNext(
    mentalities?: Record<string, Mentality>,
    window?: FriendLeague,
  ) {
    const picks = mentalities ?? picksForLeague();
    const next = advanceWeek(career, { mentalities: picks });
    const result = playerResultOf(next);
    setCareer(next);
    setLeague((current) =>
      archiveMatchday(window ?? current, next),
    );
    if (result) {
      setLastResult(result);
      setScreen("match");
    }
  }

  function picksForLeague(): Record<string, Mentality> {
    const picks: Record<string, Mentality> = {};
    for (const member of league.members) {
      picks[member.clubId] = mentalityFor(league, member.clubId);
    }
    return picks;
  }

  function simSeason() {
    let next = career;
    let guard = 0;
    while (!next.seasonComplete && guard < 200) {
      next = advanceWeek(next, { mentalities: picksForLeague() });
      guard++;
    }
    const result = playerResultOf(next);
    setCareer(next);
    if (result) setLastResult(result);
    setToast("Season simulated.");
  }

  function endSeason() {
    const board = reviewBoard(career);
    if (board.sacked) {
      setToast(`Sacked. ${board.message}`);
      setCareer({ ...career, dismissed: true });
      return;
    }
    const next = finishSeason(career);
    const entry = next.history[next.history.length - 1];

    // Crown the friend champion before the table is rebuilt for the new season.
    const table = computeTable(Object.values(career.clubs), career.fixtures);
    const tier = Object.values(career.clubs)[0]?.tier ?? career.totalTiers;
    const standings = friendStandings(league, table, tier);
    let nextLeague = league;
    try {
      nextLeague = recordSeason(
        league,
        career.season,
        standings.map((row) => ({
          managerId: row.managerId,
          tier: row.tier,
          position: row.position,
          points: row.points,
        })),
      );
    } catch {
      // Season already crowned (e.g. double click); keep the league as it is.
    }

    setCareer(next);
    setLeague(nextLeague);
    setLastResult(undefined);
    setToast(
      entry
        ? `Season ${entry.season}: finished ${ordinal(entry.position)} in tier ${entry.tier} — ${entry.outcome}.`
        : "New season.",
    );
  }

  function handleSign(target: FreeAgent) {
    const result = signPlayer(career, target);
    if (result.ok) setCareer(result.career);
    return { ok: result.ok, reason: result.reason };
  }

  function handleUpgrade() {
    const result = upgradeStadium(career);
    if (result.ok) setCareer(result.career);
    return { ok: result.ok, reason: result.reason };
  }

  function handleMentality(mentality: Mentality) {
    setCareer({ ...career, mentality });
  }

  return (
    <div className="min-h-screen">
      <Header career={career} />

      <nav className="sticky top-0 z-10 border-b border-white/[0.07] bg-pitch-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-5 py-2">
          {SCREENS.map((item) => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
              className={clsx(
                "tab whitespace-nowrap",
                screen === item.id && "tab-active",
              )}
            >
              {item.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            {career.seasonComplete && !career.dismissed && (
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={endSeason}>
                End season
              </button>
            )}
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => {
                const fresh = createCareer({ seed: 20260820 });
                localStorage.removeItem(SAVE_KEY);
                localStorage.removeItem(LEAGUE_KEY);
                setCareer(fresh);
                setLeague(buildLeague(fresh));
                setLastResult(undefined);
                setScreen("dashboard");
                setToast("New career started.");
              }}
            >
              New career
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {toast && (
          <div
            role="status"
            className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-chalk/80"
          >
            <span>{toast}</span>
            <button
              className="text-chalk/40 hover:text-chalk"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {career.dismissed && (
          <div className="mb-5 rounded-xl border border-ember/30 bg-ember/[0.08] px-4 py-3 text-sm text-ember">
            You have been dismissed by the board. Start a new career to try again.
          </div>
        )}

        {screen === "dashboard" && (
          <Dashboard
            career={career}
            lastResult={lastResult}
            onPlay={() => playNext()}
            onMentality={handleMentality}
            onSimSeason={simSeason}
          />
        )}
        {screen === "league" && (
          <LeagueScreen
            career={career}
            league={league}
            onLeague={setLeague}
            onResolve={(mentalities, resolved) => playNext(mentalities, resolved)}
          />
        )}
        {screen === "match" && lastResult && (
          <MatchScreen
            career={career}
            result={lastResult}
            onExit={() => setScreen("dashboard")}
          />
        )}
        {screen === "match" && !lastResult && (
          <div className="card px-5 py-10 text-center">
            <p className="text-sm text-chalk/60">
              No match to watch yet. Play one from the dashboard.
            </p>
            <button className="btn-ghost mt-4" onClick={() => setScreen("dashboard")}>
              Back to the dashboard
            </button>
          </div>
        )}
        {screen === "squad" && <Squad career={career} />}
        {screen === "table" && <Table career={career} />}
        {screen === "transfers" && (
          <Transfers
            career={career}
            onSign={handleSign}
            onUpgrade={handleUpgrade}
          />
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10 pt-2 text-xs text-chalk/30">
        Prototype · fictional clubs and players · {league.name} · matchday{" "}
        {league.matchday} · last result{" "}
        {lastResult ? scoreline(lastResult.homeGoals, lastResult.awayGoals) : "—"} ·{" "}
        {club.name}
      </footer>
    </div>
  );
}

function restore(): Career | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? loadCareer(raw) : null;
  } catch {
    return null;
  }
}

function restoreLeague(career: Career): FriendLeague | null {
  try {
    const raw = localStorage.getItem(LEAGUE_KEY);
    if (!raw) return null;
    const parsed = loadLeague(raw);
    // A stale league from an older save would point at clubs that no longer
    // exist; rebuild instead of rendering a table of ghosts.
    const clubIds = new Set(Object.keys(career.clubs));
    return parsed.members.every((m) => clubIds.has(m.clubId)) ? parsed : null;
  } catch {
    return null;
  }
}

/** The most recent match this club played, or undefined if it had none. */
function playerResultOf(career: Career): MatchResult | undefined {
  for (let i = career.results.length - 1; i >= 0; i--) {
    const result = career.results[i];
    if (
      result.homeId === career.playerClubId ||
      result.awayId === career.playerClubId
    ) {
      return result;
    }
  }
  return undefined;
}
