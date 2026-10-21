import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { leagueCode } from "@/engine/friendLeague";

/** Opens the league hub from the desktop nav. */
async function openLeague() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /^league$/i }));
  return user;
}

describe("the friend league", () => {
  it("lists every manager and the invite code", async () => {
    await openLeague();

    const rows = await screen.findAllByTestId("friend-row");
    // Six friends, six clubs: the league overlay is people, not a division.
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.textContent)).toContainEqual(
      expect.stringContaining("Gio"),
    );

    // The code is derived, not random, so it can be printed on an invite card.
    expect(screen.getByText(new RegExp(leagueCode("The Sunday Lads")))).toBeInTheDocument();
  });

  it("counts a head-to-head row for every rival and none for me", async () => {
    await openLeague();

    const rows = await screen.findAllByTestId("h2h-row");
    expect(rows).toHaveLength(5);
    expect(rows.some((row) => row.textContent?.includes("Gio"))).toBe(false);
  });

  it("locking in plays the matchday and opens the next window", async () => {
    const user = await openLeague();

    expect(screen.getByTestId("league-window")).toHaveTextContent(/matchday 1 ·/i);

    await user.click(screen.getByRole("button", { name: /lock in & play matchday/i }));

    // The pick is a played fixture now, so the game shows the pitch...
    expect(await screen.findByTestId("match-clock")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /skip to full time/i }));
    await user.click(screen.getByRole("button", { name: /back to the dashboard/i }));
    await user.click(screen.getByRole("button", { name: /^league$/i }));

    // ...and the window has rolled on rather than staying stuck on matchday one.
    expect(await screen.findByTestId("league-window")).toHaveTextContent(/matchday 2 ·/i);
  });

  it("remembers the league across a reload", async () => {
    const user = await openLeague();

    await user.click(screen.getByRole("button", { name: /lock in & play matchday/i }));
    await screen.findByTestId("match-clock");

    const stored = localStorage.getItem("pyramid.league.v1");
    expect(stored).toContain("The Sunday Lads");
    // The picks are cleared on resolve; only the matchday counter survives.
    expect(stored).toContain('"matchday":2');
  });

  it("shows the friend table ranked with my own row highlighted", async () => {
    await openLeague();

    const rows = await screen.findAllByTestId("friend-row");
    const mine = rows.filter((row) => row.className.includes("bg-flare"));
    expect(mine).toHaveLength(1);
    expect(within(mine[0]).getByText("Gio")).toBeInTheDocument();
  });

  it("archives only the friend derbies played that matchday", async () => {
    const user = await openLeague();

    await user.click(screen.getByRole("button", { name: /lock in & play matchday/i }));
    await screen.findByTestId("match-clock");
    await user.click(screen.getByRole("button", { name: /skip to full time/i }));
    await user.click(screen.getByRole("button", { name: /back to the dashboard/i }));
    await user.click(screen.getByRole("button", { name: /^league$/i }));

    // Matchday one draws two friend derbies, so the archive gains exactly those
    // two meetings — not all ten fixtures of the week.
    const stored = JSON.parse(localStorage.getItem("pyramid.league.v1") ?? "{}");
    expect(stored.results).toHaveLength(2);
    expect(stored.results.every((r: { week: number }) => r.week === 1)).toBe(true);
    expect(stored.results).toContainEqual(
      expect.objectContaining({ homeClubId: "club-5-1", awayClubId: "club-5-20" }),
    );

    // The head-to-head is scoped to my club, so it shows one meeting with Dan
    // even though the archive holds two derbies that week.
    const header = screen.getByText(/your meetings/i);
    expect(header.textContent).toContain("1");

    const rows = await screen.findAllByTestId("h2h-row");
    const danRow = rows.find((row) => row.textContent?.includes("Dan"));
    expect(danRow?.textContent).toContain("1");
  });

  it("keeps the archive when the league screen resolves the window itself", async () => {
    const user = await openLeague();

    await user.click(screen.getByRole("button", { name: /lock in & play matchday/i }));
    await screen.findByTestId("match-clock");

    // The resolved window and the archive are separate state updates; a race
    // between them would advance the matchday and forget the derby.
    const stored = JSON.parse(localStorage.getItem("pyramid.league.v1") ?? "{}");
    expect(stored.matchday).toBe(2);
    expect(stored.picks).toEqual({});
    expect(stored.results).toHaveLength(2);
  });
});
