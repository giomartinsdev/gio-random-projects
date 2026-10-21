import { describe, expect, it } from "vitest";

import { applyCommand, type Command } from "./commands";
import { createCareer } from "./career";

const SEED = 777;

describe("commands", () => {
  it("rejects zero weeks", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const result = applyCommand(career, { type: "advance-week", weeks: 0 });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least one week/i);
  });

  it("rejects negative weeks", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const result = applyCommand(career, { type: "advance-week", weeks: -3 });

    expect(result.ok).toBe(false);
  });

  it("advances the requested number of weeks", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const result = applyCommand(career, { type: "advance-week", weeks: 3 });

    expect(result.ok).toBe(true);
    expect(result.career.week).toBe(career.week + 3);
  });

  it("stops advancing once the season is complete rather than running on", () => {
    let career = createCareer({ seed: SEED, divisions: 1 });

    let guard = 0;
    while (!career.seasonComplete && guard < 500) {
      career = applyCommand(career, {
        type: "advance-week",
        weeks: 10,
      }).career;
      guard++;
    }

    expect(career.seasonComplete).toBe(true);

    const after = applyCommand(career, { type: "advance-week", weeks: 5 });

    expect(after.ok).toBe(false);
    expect(after.reason).toMatch(/season/i);
    expect(after.career.week).toBe(career.week);
  });

  it("rejects an unknown command type", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const command = { type: "teleport" } as unknown as Command;

    const result = applyCommand(career, command);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unknown/i);
  });

  it("keeps the career immutable", () => {
    const career = createCareer({ seed: SEED, divisions: 1 });
    const snapshot = JSON.stringify(career);

    applyCommand(career, { type: "advance-week", weeks: 2 });

    expect(JSON.stringify(career)).toBe(snapshot);
  });
});
