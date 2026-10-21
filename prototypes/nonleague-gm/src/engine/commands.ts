import { advanceWeek } from "./career";
import type { Career, CommandResult } from "./types";

export type Command =
  | { type: "advance-week"; weeks: number }
  | { type: "set-mentality"; mentality: Career["mentality"] };

/**
 * The single entry point for changing a career from the UI.
 *
 * Every mutation goes through here so that "reject an invalid action" is one
 * piece of logic, not a condition copy-pasted into each button handler. A
 * command returns a *new* career or a reason; it never half-applies.
 */
export function applyCommand(career: Career, command: Command): CommandResult {
  switch (command.type) {
    case "advance-week": {
      if (!Number.isInteger(command.weeks) || command.weeks < 1) {
        return { ok: false, career, reason: "Advance at least one week." };
      }
      if (career.seasonComplete) {
        return {
          ok: false,
          career,
          reason: "The season is complete. Start the next one first.",
        };
      }

      let next = career;
      for (let i = 0; i < command.weeks; i++) {
        if (next.seasonComplete) break;
        next = advanceWeek(next);
      }

      return { ok: true, career: next };
    }

    case "set-mentality": {
      if (!["cautious", "balanced", "attacking"].includes(command.mentality)) {
        return { ok: false, career, reason: "Unknown mentality." };
      }
      return {
        ok: true,
        career: { ...career, mentality: command.mentality },
      };
    }

    default:
      return { ok: false, career, reason: "Unknown command." };
  }
}
