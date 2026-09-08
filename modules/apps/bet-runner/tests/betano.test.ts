import { afterEach, describe, expect, it, vi } from "vitest";
import { betanoDriver } from "../src/vendors/betano.js";
import {
  BALANCE,
  CONFIRMED_TEXT,
  CONFIRM_BUTTON,
  LOGIN_USERNAME,
  LOGIN_PASSWORD,
  LOGIN_SUBMIT,
  LOGGED_OUT_SIGNAL,
  MODAL_DISMISS,
  ODDS_BUTTON,
  SLIP_EXPANDER,
  STAKE_INPUT,
} from "../src/vendors/betano.js";
import { FakePage } from "./fakePage.js";
import type { BetRequest } from "../src/vendors/types.js";

const BET_URL = "https://www.betano.com.br/aposta/abc";

function request(overrides: Partial<BetRequest> = {}): BetRequest {
  return {
    betId: "bet-1",
    url: BET_URL,
    stakeCents: 10_50,
    username: "gio@betano.com",
    password: "hunter2",
    dryRun: false,
    log: () => undefined,
    ...overrides,
  };
}

// The driver's selector waits are wall-clock (Date.now) deadlines; the
// fake page advances its own virtual clock on every waitForTimeout, so
// pinning Date.now to it makes those waits virtual too — a test that
// exercises a 15s timeout finishes instantly.
function freezeClockOn(page: FakePage) {
  vi.spyOn(Date, "now").mockImplementation(() => page.now);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("betanoDriver", () => {
  it("places a bet on a link that pre-filled the slip", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.visible.add(STAKE_INPUT[0]);
    page.visible.add(CONFIRM_BUTTON[0]);
    page.visible.add(CONFIRMED_TEXT);
    page.visible.add(BALANCE[0]); // the receipt's balanceCents source
    page.textContent = "Saldo: R$ 87,50";

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
    expect(page.clicks).toContainEqual(CONFIRM_BUTTON[0]);
    expect(outcome.receipt.steps.length).toBeGreaterThan(0);
    expect(outcome.receipt.screenshotJpeg).toBeTruthy();
    expect(outcome.receipt.balanceCents).toBe(8_750);
    expect(outcome.receipt.dryRun).toBeUndefined();
  });

  it("never clicks confirm in dry-run", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.visible.add(STAKE_INPUT[0]);
    page.visible.add(CONFIRM_BUTTON[0]);

    const outcome = await betanoDriver.placeBet(page.asPage(), request({ dryRun: true }));

    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.receipt.dryRun).toBe(true);
    expect(page.clicks).not.toContainEqual(CONFIRM_BUTTON[0]);
  });

  it("clicks the first odd when the link opens a market page instead of a slip", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.onClick = (selector) => {
      // Clicking the odd opens the slip: the stake input appears.
      if (ODDS_BUTTON.includes(selector)) page.visible.add(STAKE_INPUT[0]);
    };
    page.visible.add(ODDS_BUTTON[0]);
    page.visible.add(CONFIRM_BUTTON[0]);
    page.visible.add(CONFIRMED_TEXT);

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(ODDS_BUTTON[0]);
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
  });

  it("logs in when the session expired, then places the bet", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.visible.add(LOGIN_USERNAME[0]);
    page.visible.add(LOGIN_PASSWORD[0]);
    page.visible.add(LOGIN_SUBMIT[0]);
    page.onClick = (selector) => {
      if (LOGIN_SUBMIT.includes(selector)) {
        page.visible.delete(LOGIN_USERNAME[0]);
        page.visible.delete(LOGIN_PASSWORD[0]);
        page.visible.add(STAKE_INPUT[0]);
        page.visible.add(CONFIRM_BUTTON[0]);
        page.visible.add(CONFIRMED_TEXT);
      }
    };

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.fills).toContainEqual({ selector: LOGIN_USERNAME[0], value: "gio@betano.com" });
    expect(page.fills).toContainEqual({ selector: LOGIN_PASSWORD[0], value: "hunter2" });
    expect(page.clicks).toContainEqual(LOGIN_SUBMIT[0]);
    expect(page.clicks).toContainEqual(CONFIRM_BUTTON[0]);
  });

  it("logs in when the page shows a logged-out CTA even without a login form", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    // The bookingcode/market page while logged out: header CTA visible,
    // no login form anywhere on it.
    page.visible.add(LOGGED_OUT_SIGNAL[2]); // a:has-text("Entrar")
    page.visible.add(LOGIN_USERNAME[0]);
    page.visible.add(LOGIN_PASSWORD[0]);
    page.visible.add(LOGIN_SUBMIT[0]);
    page.onClick = (selector) => {
      if (LOGIN_SUBMIT.includes(selector)) {
        page.visible.delete(LOGIN_USERNAME[0]);
        page.visible.delete(LOGIN_PASSWORD[0]);
        page.visible.delete(LOGGED_OUT_SIGNAL[2]);
        page.visible.add(STAKE_INPUT[0]);
        page.visible.add(CONFIRM_BUTTON[0]);
        page.visible.add(CONFIRMED_TEXT);
      }
    };

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.fills).toContainEqual({ selector: LOGIN_USERNAME[0], value: "gio@betano.com" });
    expect(page.fills).toContainEqual({ selector: LOGIN_PASSWORD[0], value: "hunter2" });
    expect(page.clicks).toContainEqual(LOGIN_SUBMIT[0]);
    expect(page.clicks).toContainEqual(CONFIRM_BUTTON[0]);
  });

  it("keeps going when the logged-out CTA is a false positive and no login form appears", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    // A stray "Entrar" on an otherwise logged-in page.
    page.visible.add(LOGGED_OUT_SIGNAL[2]);
    page.visible.add(STAKE_INPUT[0]);
    page.visible.add(CONFIRM_BUTTON[0]);
    page.visible.add(CONFIRMED_TEXT);

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(CONFIRM_BUTTON[0]);
  });

  it("dismisses the age-verification wall before touching the page", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    const [ageModal] = MODAL_DISMISS;
    const ageButton = `${ageModal.modal} ${ageModal.buttons[0]}`;
    page.visible.add(ageModal.modal);
    page.visible.add(ageButton);
    page.onClick = (selector) => {
      if (selector === ageButton) {
        page.visible.delete(ageModal.modal);
        page.visible.add(STAKE_INPUT[0]);
        page.visible.add(CONFIRM_BUTTON[0]);
        page.visible.add(CONFIRMED_TEXT);
      }
    };

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(ageButton);
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
  });

  it("dismisses the post-login geolocation wall", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    const [, , geoModal] = MODAL_DISMISS;
    const geoButton = `${geoModal.modal} ${geoModal.buttons[0]}`;
    // The loose :has-text container matches the outermost ancestor and
    // is always "visible"; the button inside is what decides the click.
    page.visible.add(geoModal.modal);
    page.visible.add(geoButton);
    page.onClick = (selector) => {
      if (selector === geoButton) {
        page.visible.delete(geoButton);
        page.visible.add(STAKE_INPUT[0]);
        page.visible.add(CONFIRM_BUTTON[0]);
        page.visible.add(CONFIRMED_TEXT);
      }
    };

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(geoButton);
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
  });

  it("dismisses the booking-code confirmation dialog over the slip", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    const [, , , bookingModal] = MODAL_DISMISS;
    const bookingButton = `${bookingModal.modal} ${bookingModal.buttons[0]}`;
    page.visible.add(STAKE_INPUT[0]);
    page.visible.add(bookingModal.modal);
    page.visible.add(bookingButton);
    page.onClick = (selector) => {
      if (selector === bookingButton) page.visible.delete(bookingModal.modal);
      // The real slip is still clickable behind the dialog once it's gone.
    };
    page.visible.add(CONFIRM_BUTTON[0]);
    page.visible.add(CONFIRMED_TEXT);

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(bookingButton);
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
  });

  it("expands the collapsed slip bar that booking codes leave behind", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    // The link added the selection but the slip sits folded as the
    // bottom bar; the stake field only exists after its header expands.
    page.visible.add(SLIP_EXPANDER[0]);
    page.onClick = (selector) => {
      if (selector === SLIP_EXPANDER[0]) {
        page.visible.delete(SLIP_EXPANDER[0]);
        page.visible.add(STAKE_INPUT[0]);
        page.visible.add(CONFIRM_BUTTON[0]);
        page.visible.add(CONFIRMED_TEXT);
      }
    };

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("succeeded");
    expect(page.clicks).toContainEqual(SLIP_EXPANDER[0]);
    expect(page.fills).toContainEqual({ selector: STAKE_INPUT[0], value: "10,50" });
  });

  it("never fills the bet-mentor quick-bet widget as the slip stake", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    // The widget the site renders outside the slip also matches
    // inputmode=decimal — the driver's candidate list excludes it by
    // class, so a page with only the widget counts as "no slip".
    page.visible.add('input[inputmode="decimal"]');

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error).toMatch(/slip/i);
    expect(page.fills).toHaveLength(0);
  });

  it("fails clearly on a persistent Cloudflare challenge", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.challenge = true;

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error).toMatch(/cloudflare/i);
    expect(outcome.receipt?.screenshotJpeg).toBeTruthy();
  });

  it("fails with a screenshot when neither a slip nor an odd exists", async () => {
    const page = new FakePage();
    freezeClockOn(page);

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error).toMatch(/slip/i);
    expect(outcome.receipt?.screenshotJpeg).toBeTruthy();
  });

  it("fails when clicking the odd does not open a slip", async () => {
    const page = new FakePage();
    freezeClockOn(page);
    page.visible.add(ODDS_BUTTON[0]);

    const outcome = await betanoDriver.placeBet(page.asPage(), request());

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.error).toMatch(/slip não abriu/i);
  });
});