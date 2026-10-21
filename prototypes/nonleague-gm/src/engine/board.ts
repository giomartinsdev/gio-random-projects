import type { Career } from "./types";

/**
 * Board confidence.
 *
 * The rule has to be explainable in one sentence, because the player needs to
 * know why they were sacked: you are dismissed if you finish in the bottom
 * three, or if your last eight matches produced two points or fewer.
 *
 * Deliberately *not* based on transfer spend or wage bill — those tempt a
 * prototype into modelling a boardroom nobody can see.
 */
export interface BoardReview {
  sacked: boolean;
  confidence: number;
  message: string;
}

export function boardConfidence(career: Career): number {
  const positionScore = Math.max(0, 21 - career.clubPosition) * 4; // 0–80
  const points = career.form.reduce(
    (sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0),
    0,
  );
  const formScore = career.form.length === 0 ? 20 : (points / (career.form.length * 3)) * 20;

  return Math.round(Math.min(100, positionScore + formScore));
}

export function reviewBoard(career: Career): BoardReview {
  const confidence = boardConfidence(career);

  const recent = career.form.slice(-8);
  const recentPoints = recent.reduce(
    (sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0),
    0,
  );

  const bottomThree = career.clubPosition > 17;
  const disastrousRun = recent.length >= 8 && recentPoints <= 2;

  if (bottomThree || disastrousRun) {
    return {
      sacked: true,
      confidence,
      message: disastrousRun
        ? "The board has lost patience with a run of defeats."
        : "The board has dismissed you with the club in the bottom three.",
    };
  }

  return {
    sacked: false,
    confidence,
    message:
      confidence > 70
        ? "The board is delighted with progress."
        : "The board is satisfied for now.",
  };
}
