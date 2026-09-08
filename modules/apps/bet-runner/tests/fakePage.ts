// A scripted structural fake of the slice of patchright's Page the
// drivers use — no Chromium in CI. The test decides which selectors
// are "visible" and optionally reacts to clicks/gotos; the fake
// records every interaction so assertions read like a run log.
import type { Page } from "patchright";

export class FakeLocator {
  constructor(
    private readonly page: FakePage,
    private readonly selector: string,
  ) {}

  first(): FakeLocator {
    return this;
  }

  async isVisible(): Promise<boolean> {
    return this.page.visible.has(this.selector);
  }

  async click(): Promise<void> {
    this.page.clicks.push(this.selector);
    await this.page.onClick?.(this.selector);
  }

  async fill(value: string): Promise<void> {
    this.page.fills.push({ selector: this.selector, value });
  }

  async textContent(): Promise<string | null> {
    return this.page.textContent ?? null;
  }
}

export class FakePage {
  /** Selectors that resolve as visible right now. */
  visible = new Set<string>();
  /** Clicks performed, in order. */
  clicks: string[] = [];
  /** Field fills, in order. */
  fills: { selector: string; value: string }[] = [];
  /** Number of screenshots taken. */
  screenshots = 0;
  /** What textContent() returns (the balance, on the happy path). */
  textContent: string | null = null;
  /** What evaluate() returns — the drivers only evaluate "is this a challenge?" */
  challenge = false;
  /** Last URL handed to goto(). */
  lastGoto: string | null = null;
  /** Virtual clock (ms) — tests point Date.now at this via freezeClockOn. */
  now = 0;
  /** Optional reaction to a click (mutate `visible` to simulate navigation). */
  onClick?: (selector: string) => void | Promise<void>;

  async goto(url: string): Promise<void> {
    this.lastGoto = url;
  }

  async waitForLoadState(): Promise<void> {}

  async waitForTimeout(ms: number): Promise<void> {
    this.now += ms;
  }

  url(): string {
    return this.lastGoto ?? "about:blank";
  }

  async evaluate(): Promise<boolean> {
    return this.challenge;
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this, selector);
  }

  async screenshot(): Promise<Buffer> {
    this.screenshots += 1;
    return Buffer.from("jpeg-bytes");
  }

  /** Casts itself to the real Page type — the driver only touches the methods above. */
  asPage(): Page {
    return this as unknown as Page;
  }
}