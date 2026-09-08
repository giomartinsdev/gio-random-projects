// HTTP client for bet-api's /internal/* surface. The only outbound
// calls this service makes besides the betting sites themselves —
// claim a queued job (with decrypted credentials inside) and report
// the outcome back. Never logs the credentials it receives.

export type ClaimedBet = {
  id: string;
  userId: string;
  vendor: string;
  url: string;
  stakeCents: number;
};

export type ClaimedJob = {
  bet: ClaimedBet;
  credentials: { username: string; password: string };
};

export type ResultReport = {
  status: "succeeded" | "failed";
  error?: string;
  receipt?: {
    steps?: string[];
    screenshotJpeg?: string;
    betRef?: string;
    balanceCents?: number;
    dryRun?: boolean;
  };
};

export class BffClient {
  constructor(
    private readonly baseUrl: string,
    private readonly runnerKey: string,
  ) {}

  /** Returns the next queued job, or null when the queue is empty. */
  async claim(): Promise<ClaimedJob | null> {
    const response = await fetch(`${this.baseUrl}/internal/jobs/claim`, {
      method: "POST",
      headers: { "x-runner-key": this.runnerKey },
    });
    if (!response.ok) {
      throw new Error(`claim failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { bet?: ClaimedBet | null; credentials?: unknown };
    if (!body.bet) return null;
    if (
      !body.credentials ||
      typeof body.credentials !== "object" ||
      typeof (body.credentials as { username?: unknown }).username !== "string" ||
      typeof (body.credentials as { password?: unknown }).password !== "string"
    ) {
      throw new Error(`claim for bet ${body.bet.id} came back without credentials`);
    }
    return {
      bet: body.bet,
      credentials: body.credentials as { username: string; password: string },
    };
  }

  /**
   * Reports a finished job. A 409 means the bet is no longer running
   * on the BFF side (stale/duplicate report) — that's a no-op, not a
   * failure, so callers shouldn't retry it.
   */
  async reportResult(betId: string, report: ResultReport): Promise<void> {
    const response = await fetch(`${this.baseUrl}/internal/jobs/${betId}/result`, {
      method: "POST",
      headers: { "x-runner-key": this.runnerKey, "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    if (response.status === 409) return; // already finalized elsewhere — fine
    if (!response.ok) {
      throw new Error(`result report failed: HTTP ${response.status}`);
    }
  }
}