import type { Locator, Page } from "patchright";
import { BetError, type BetOutcome, type BetReceipt, type BetRequest, type BookmakerDriver } from "./types.js";
import { centsToStakeString, parseBalanceToCents } from "../lib/stake.js";

// ─── Selectors ────────────────────────────────────────────────────────
// The one file that knows Betano's DOM, and it's data, not logic:
// every lookup walks its candidate list and takes the first visible
// hit, so tuning a selector after a failed run is a one-line edit (the
// receipt's screenshot shows exactly what the page looked like).
// Betano (Kaizen Gaming platform) ships pt-BR UI; data-testid
// candidates first, then text/placeholder fallbacks. Re-verify against
// a live session whenever the site redesigns — see README.
export const LOGIN_EMAIL = ['input[name="username"]', 'input[type="email"]', 'input[autocomplete="username"]'];
export const LOGIN_PASSWORD = ['input[type="password"]'];
export const LOGIN_SUBMIT = ['button[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Login")'];
// The slip's stake field: betano names it in pt-BR ("Valor da aposta").
export const STAKE_INPUT = [
  '[data-testid="stake-input"]',
  'input[placeholder*="Valor"]',
  'input[placeholder*="valor"]',
  'input[name="stake"]',
  'input[inputmode="decimal"]',
];
export const CONFIRM_BUTTON = [
  '[data-testid="bet-button"]',
  'button:has-text("Apostar")',
  'button:has-text("Place bet")',
];
// Odds buttons on a market page, for links that open a page instead of
// a pre-filled slip ("não sei / varia" — both shapes are handled).
export const ODDS_BUTTON = [
  'button[data-testid*="odds"]',
  'button[data-testid*="odd"]',
  '[data-testid="prebet-item"] button',
  'button:has-text("@")',
];
// Balance, for the receipt's balanceCents (best-effort).
export const BALANCE = ['[data-testid*="balance"]', '[class*="balance"]'];
// Confirmation states that mean the bet went through: the site's own
// success toast/copy, in either language.
export const CONFIRMED_TEXT =
  "text=/aposta (registrada|realizada|colocada|feita)/i, text=/bet (placed|registered)/i, text=/sucesso/i";

async function firstVisible(page: Page, selectors: string[], timeout = 8_000): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(300);
  }
}

async function screenshotJpeg(page: Page, log: (line: string) => void): Promise<string | undefined> {
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
    return buffer.toString("base64");
  } catch {
    // A screenshot that can't happen must not fail a bet that won.
    log("screenshot falhou (página fechando?) — seguindo sem imagem");
    return undefined;
  }
}

async function looksLikeChallenge(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const text = document.body?.innerText?.slice(0, 4000) ?? "";
      return (
        /just a moment/i.test(text) ||
        /attention required/i.test(text) ||
        (document.querySelector("#challenge-form, #cf-chl-widget, iframe[src*='challenges.cloudflare.com']") !==
          null &&
          text.length < 200)
      );
    })
    .catch(() => false);
}

async function isOnLoginPage(page: Page): Promise<boolean> {
  if (/\/(login|entrar|sign-?in)/i.test(new URL(page.url()).pathname)) return true;
  const password = await firstVisible(page, LOGIN_PASSWORD, 500);
  if (!password) return false;
  return (await firstVisible(page, LOGIN_EMAIL, 500)) !== null;
}

async function login(page: Page, req: BetRequest, loginUrl: string): Promise<void> {
  req.log(`abrindo a página de login (${loginUrl})`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const email = await firstVisible(page, LOGIN_EMAIL, 10_000);
  if (!email) throw new BetError("formulário de login não apareceu (campo de email)");
  const password = await firstVisible(page, LOGIN_PASSWORD, 10_000);
  if (!password) throw new BetError("formulário de login não apareceu (campo de senha)");

  req.log("preenchendo credenciais e entrando");
  await email.fill(req.username);
  await password.fill(req.password);
  const submit = await firstVisible(page, LOGIN_SUBMIT, 5_000);
  if (!submit) throw new BetError("botão de login não encontrado");
  await submit.click();

  // Logged in = we land somewhere the login form isn't. 20s because
  // the site's SPA is slow after submit.
  for (let waited = 0; waited < 20_000; waited += 1_000) {
    await page.waitForTimeout(1_000);
    if (!(await isOnLoginPage(page))) {
      req.log("login concluído (sessão salva no perfil persistente)");
      return;
    }
  }
  throw new BetError("login não concluiu em 20s — confira as credenciais nos ajustes");
}

export const betanoDriver = {
  vendor: "betano",

  async placeBet(page: Page, req: BetRequest): Promise<BetOutcome> {
    const steps: string[] = [];
    const step = (line: string) => {
      req.log(line);
      steps.push(line);
    };
    const stakeStr = centsToStakeString(req.stakeCents);

    step(`abrindo o link da betano (${req.url})`);
    await page.goto(req.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // Cloudflare in front: wait out a soft challenge once, then give up
    // with a clear message (the receipt's screenshot shows the stuck
    // page).
    if (await looksLikeChallenge(page)) {
      step("challenge do Cloudflare apareceu — esperando até 15s");
      await page.waitForTimeout(5_000);
      if (await looksLikeChallenge(page)) await page.waitForTimeout(10_000);
      if (await looksLikeChallenge(page)) {
        return {
          status: "failed",
          error: "Cloudflare bloqueou o acesso à betano (challenge persistente)",
          receipt: { steps, screenshotJpeg: await screenshotJpeg(page, req.log) },
        };
      }
      step("challenge passou");
    }

    // Login, only when the session actually expired — the persistent
    // profile (browser.ts) keeps cookies across runs, so this is the
    // exception, not the rule.
    if (await isOnLoginPage(page)) {
      step("sessão expirou — fazendo login");
      await login(page, req, "https://www.betano.com.br/");
      step("voltando ao link da aposta");
      await page.goto(req.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    } else {
      step("sessão válida (sem formulário de login)");
    }

    // Case 1: the link pre-filled the slip. Case 2: the link opens a
    // market page — click the first odd so a slip exists at all.
    let stake = await firstVisible(page, STAKE_INPUT, 8_000);
    if (stake) {
      step("slip já veio preenchido pelo link");
    } else {
      step("slip vazio — a página é de mercado; clicando na primeira odd");
      const odd = await firstVisible(page, ODDS_BUTTON, 8_000);
      if (!odd) {
        return {
          status: "failed",
          error: "nem slip preenchido nem odd clicável no link — seletores precisam de revisão (veja o screenshot)",
          receipt: { steps, screenshotJpeg: await screenshotJpeg(page, req.log) },
        };
      }
      await odd.click();
      stake = await firstVisible(page, STAKE_INPUT, 10_000);
      if (!stake) {
        return {
          status: "failed",
          error: "clicou na odd mas o slip não abriu — seletores precisam de revisão (veja o screenshot)",
          receipt: { steps, screenshotJpeg: await screenshotJpeg(page, req.log) },
        };
      }
    }

    step(`preenchendo o valor da aposta (${stakeStr})`);
    await stake.click();
    await stake.fill(stakeStr);

    const beforeShot = await screenshotJpeg(page, req.log);
    step("screenshot antes do clique final tirado");

    if (req.dryRun) {
      step("DRY_RUN: parando antes do clique final (nenhuma aposta colocada)");
      return { status: "succeeded", receipt: { steps, screenshotJpeg: beforeShot, dryRun: true } };
    }

    const confirm = await firstVisible(page, CONFIRM_BUTTON, 10_000);
    if (!confirm) {
      return {
        status: "failed",
        error: "botão de confirmar aposta não encontrado",
        receipt: { steps, screenshotJpeg: beforeShot },
      };
    }
    step("confirmando a aposta");
    await confirm.click();

    // Success = a confirmation text appearing. 15s: the site's own
    // round-trip plus toast animation.
    let confirmed = false;
    for (let waited = 0; waited < 15_000; waited += 500) {
      await page.waitForTimeout(500);
      if (await page.locator(CONFIRMED_TEXT).first().isVisible().catch(() => false)) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) {
      return {
        status: "failed",
        error: "clique no botão enviado mas nenhuma confirmação apareceu em 15s — confira o screenshot e o histórico do site",
        receipt: { steps, screenshotJpeg: await screenshotJpeg(page, req.log) },
      };
    }

    step("aposta confirmada");
    const receipt: BetReceipt = { steps, screenshotJpeg: await screenshotJpeg(page, req.log) };
    const balance = await firstVisible(page, BALANCE, 2_000);
    const balanceText = balance ? await balance.textContent().catch(() => null) : null;
    if (balanceText) {
      const cents = parseBalanceToCents(balanceText);
      if (cents !== null) receipt.balanceCents = cents;
    }
    return { status: "succeeded", receipt };
  },
} satisfies BookmakerDriver;