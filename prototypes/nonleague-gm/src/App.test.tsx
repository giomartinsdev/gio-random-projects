import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("career screen", () => {
  it("shows the club, the league and a next action on load", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/national league north|tier/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /kick off/i }),
    ).toBeInTheDocument();
  });

  it("shows a scoreline and match events after playing", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));
    await user.click(screen.getByRole("button", { name: /skip to full time/i }));
    await user.click(screen.getByRole("button", { name: /back to the hub/i }));

    const scoreline = await screen.findByTestId("scoreline");
    expect(scoreline.textContent).toMatch(/\d+\s*[–-]\s*\d+/);

    const events = await screen.findByTestId("match-events");
    expect(within(events).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("reports the result of my club's match, not another fixture that week", async () => {
    const user = userEvent.setup();
    render(<App />);

    const myShort = screen.getByTestId("club-short").textContent?.trim();

    // A matchweek plays ten fixtures; the panel must pick the one involving
    // the club being managed, otherwise it shows a stranger's scoreline.
    await user.click(screen.getByRole("button", { name: /kick off/i }));
    await user.click(screen.getByRole("button", { name: /skip to full time/i }));
    await user.click(screen.getByRole("button", { name: /back to the hub/i }));

    const panel = await screen.findByTestId("last-result");
    expect(panel.textContent).toContain(myShort);
  });

  it("lists at least eighteen players with a position and rating", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^squad$/i }));

    // The squad is a grid of player cards: a face, a rating, a position. The
    // table is still there for comparison, one toggle away.
    const cards = await screen.findAllByTestId("player-card");
    expect(cards.length).toBeGreaterThanOrEqual(18);

    for (const card of cards) {
      expect(card.dataset.position).toMatch(/^(GK|DF|MF|FW)$/);
      expect(Number(card.dataset.rating)).toBeGreaterThan(0);
      expect(within(card).getByTestId("player-face")).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: /^list$/i }));
    const rows = await screen.findAllByTestId("squad-row");
    expect(rows).toHaveLength(cards.length);
    for (const row of rows) {
      expect(row.dataset.position).toMatch(/^(GK|DF|MF|FW)$/);
      expect(Number(row.dataset.rating)).toBeGreaterThan(0);
    }
  });

  it("shows twenty clubs in the table and highlights mine", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /table/i }));

    const rows = await screen.findAllByTestId("table-row");
    expect(rows).toHaveLength(20);

    const mine = rows.filter((row) => row.dataset.mine === "true");
    expect(mine).toHaveLength(1);
  });

  it("watching a match puts twenty-two players on a pitch with a running clock", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));

    const players = await screen.findAllByTestId("pitch-player");
    expect(players).toHaveLength(22);

    const clock = screen.getByTestId("match-clock");
    const first = clock.textContent;

    // The clock has to actually advance, or this is a screenshot, not a match.
    await waitFor(() => expect(screen.getByTestId("match-clock").textContent).not.toBe(first), {
      timeout: 3000,
    });

    expect(players.filter((p) => p.dataset.side === "home")).toHaveLength(11);
    expect(players.filter((p) => p.dataset.side === "away")).toHaveLength(11);
    expect(players.filter((p) => p.dataset.ball === "true")).toHaveLength(1);
  });

  it("skipping to full time lands on ninety minutes and the real scoreline", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));
    await user.click(screen.getByRole("button", { name: /skip to full time/i }));

    // It jumps to the whistle rather than exiting: the pitch is the point.
    expect(screen.getByTestId("match-clock").textContent).toMatch (/90/);
    const live = screen.getByTestId("live-score").textContent ?? "";

    // The ticker must stop narrating a live ball once the whistle has gone —
    // "ASH restarting" at 90' reads as a stuck match, not a finished one.
    expect(screen.getByTestId("ticker").textContent).toMatch(/full time/i);
    expect(screen.getByTestId("ticker").textContent).not.toMatch(/on the ball/i);

    await user.click(screen.getByRole("button", { name: /back to the hub/i }));

    const scoreline = await screen.findByTestId("scoreline");
    expect(scoreline.textContent).toMatch(/\d+\s*[–-]\s*\d+/);

    // The live pitch is gone, so the clock cannot still be ticking behind it.
    expect(screen.queryByTestId("match-clock")).not.toBeInTheDocument();
    expect(live).toMatch(/\d+/);
  });

  it("a player token never lands outside the pitch", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));

    const pitch = await screen.findByTestId("pitch");
    for (const token of screen.getAllByTestId("pitch-player")) {
      const x = Number(token.dataset.x);
      const y = Number(token.dataset.y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(pitch).toBeInTheDocument();
  });

  it("labels the match with the matchday just played, not the next one", async () => {
    const user = userEvent.setup();
    render(<App />);

    // A fresh career is on week 0; watching the first match advances it to 1.
    // The pitch is showing matchday 1, so saying "Matchday 2" here would be a
    // lie about which game the scoreline belongs to.
    await user.click(screen.getByRole("button", { name: /kick off/i }));
    expect(await screen.findByText(/^matchday 1$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^matchday 2$/i)).not.toBeInTheDocument();
  });

  it("draws a ball that is round, panelled and moves along the grass", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));

    const ball = await screen.findByTestId("pitch-ball");

    // A real football, not a white dot: panels are paths inside an SVG.
    expect(ball.querySelector("svg")).not.toBeNull();
    expect(ball.querySelectorAll("path").length).toBeGreaterThan(4);

    const startX = Number(ball.dataset.x);
    const startY = Number(ball.dataset.y);

    // And it is carried: the ball travels during the match rather than sitting
    // in the centre spot for ninety minutes.
    await waitFor(
      () => {
        const now = screen.getByTestId("pitch-ball");
        const moved =
          Math.abs(Number(now.dataset.x) - startX) +
          Math.abs(Number(now.dataset.y) - startY);
        expect(moved).toBeGreaterThan(0.01);
      },
      { timeout: 3000 },
    );
  });

  it("has a goal mouth with a net at each end", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));

    const left = await screen.findByTestId("goal-left");
    const right = await screen.findByTestId("goal-right");

    // The mesh is a pair of crossed gradients; without it "in the net" would be
    // a ball resting on grass.
    expect(left.style.background).toContain("repeating-linear-gradient");
    expect(right.style.background).toContain("repeating-linear-gradient");
  });

  it("gives every squad player a face, and the same face on every screen", async () => {
    const user = userEvent.setup();
    render(<App />);

    const myShort = screen.getByTestId("club-short").textContent;

    // The club bar already shows the captain's portrait.
    const headerFace = screen.getAllByTestId("player-face")[0];
    const headerPlayer = headerFace.dataset.player;

    await user.click(screen.getByRole("button", { name: /^squad$/i }));

    const faces = await screen.findAllByTestId("player-face");
    expect(faces.length).toBeGreaterThanOrEqual(18);
    // A face is a drawing, not an empty box: every one carries a head and a shirt.
    expect(faces[0].querySelector("svg")).not.toBeNull();
    expect(faces[0].querySelectorAll("path").length).toBeGreaterThan(6);

    const same = faces.find((f) => f.dataset.player === headerPlayer);
    expect(same).toBeTruthy();
    // The identical player must draw the identical face, or he changes person
    // between the header and the grid.
    expect(same?.innerHTML).toBe(headerFace.innerHTML);
    expect(myShort).toBeTruthy();
  });

  it("shows a badge for every club, on the hub and in the table", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Two badges in the fixture hero: mine and the opponent's.
    const heroBadges = await screen.findAllByTestId("club-crest");
    expect(heroBadges.length).toBeGreaterThanOrEqual(2);
    expect(heroBadges[0].tagName.toLowerCase()).toBe("svg");
    expect(heroBadges[0].getAttribute("aria-label")).toMatch(/crest/i);

    await user.click(screen.getByRole("button", { name: /^table$/i }));
    const rows = await screen.findAllByTestId("table-row");
    expect(rows).toHaveLength(20);
    for (const row of rows.slice(0, 5)) {
      expect(within(row).getByTestId("club-crest")).toBeInTheDocument();
    }
  });

  it("names the scorer, with his face, when a goal goes in", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /kick off/i }));

    // Run the clock forward until the ball is in the net. The graphic is driven
    // by the ball, not by a timer, so this is the only honest way to test it.
    let overlay = screen.queryByTestId("goal-overlay");
    for (let i = 0; i < 900 && !overlay; i++) {
      await new Promise((r) => setTimeout(r, 20));
      overlay = screen.queryByTestId("goal-overlay");
      if (screen.queryByTestId("match-clock")?.textContent?.startsWith("90")) break;
    }

    if (overlay) {
      expect(overlay.textContent).toMatch(/goal/i);
      expect(overlay.dataset.scorer).toBeTruthy();
      expect(within(overlay).getByTestId("player-face")).toBeInTheDocument();
      expect(within(overlay).getByTestId("club-crest")).toBeInTheDocument();
    } else {
      // A 0–0 is a legitimate outcome; the assertion above only applies when a
      // goal was actually scored.
      expect(screen.getByTestId("live-score").textContent).toBe("0");
    }
  }, 20000);
});
