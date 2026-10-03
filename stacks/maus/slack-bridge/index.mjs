// maus-slack-bridge — talk to OpenMausBot bots from Slack, choosing which bot.
//
// A Slack message (DM or @mention) becomes a turn on the chosen bot's thread
// through the OpenMausBot HTTP API, and the terminal reply is posted back to
// Slack. The person picks the bot per message by name prefix, or sets a
// sticky default with `use <bot>`. It runs in the same network namespace as the
// `omb` container, so its loopback calls are the self-hosted owner.
//
// Slack side is Socket Mode: no public URL, no inbound port, outbound WSS only.
//
// Usage in Slack:
//   list                 → show the bots you can talk to
//   use BackendBOT       → make BackendBOT your default for this Slack channel
//   BackendBOT: fix X    → send "fix X" to BackendBOT (works without a default)
//   fix X                → goes to your default bot (or asks you to pick)
//
// Env:
//   SLACK_BOT_TOKEN   xoxb-…   (OAuth bot token)
//   SLACK_APP_TOKEN   xapp-…   (app-level token; enables Socket Mode)
//   OMB_URL           default http://127.0.0.1:8799
//   OMB_DEFAULT_BOT_ID optional; fallback when a message names no bot
//   SLACK_ALLOWED_USERS  optional comma-separated Slack user ids; empty = anyone
//   REPLY_TIMEOUT_MS  default 15 min
//
// State (sticky defaults + Slack channel → OpenMausBot task) lives on /data.
import { App } from "@slack/bolt";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OMB = (process.env.OMB_URL || "http://127.0.0.1:8799").replace(/\/$/, "");
const STATE_FILE = process.env.STATE_FILE || "/data/slack-bridge-state.json";
const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS || 15 * 60_000);
const FALLBACK_BOT_ID = process.env.OMB_DEFAULT_BOT_ID || "";
const ALLOWED = (process.env.SLACK_ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
  console.error("[slack-bridge] missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN");
  process.exit(1);
}

// state = { defaults: { "<slackUserId>": "<botName>" }, threads: { "<channelId>": { "<botId>": "<threadId>" } } }
function loadState() {
  try { const s = JSON.parse(readFileSync(STATE_FILE, "utf8")); return { defaults: s.defaults || {}, threads: s.threads || {} }; }
  catch { return { defaults: {}, threads: {} }; }
}
function saveState() {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.warn("[slack-bridge] could not persist state:", e.message); }
}
let state = loadState();

async function api(method, path, body) {
  const res = await fetch(`${OMB}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function fetchBots() {
  const r = await api("GET", "/api/bots");
  const bots = r.json?.bots || [];
  return bots.filter((b) => !b.hidden).map((b) => ({ id: b.id, name: b.name, description: b.description || "" }));
}

function resolveBot(bots, token) {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  return bots.find((b) => b.id.toLowerCase() === t)
    || bots.find((b) => b.name.toLowerCase() === t)
    || bots.find((b) => b.name.toLowerCase().startsWith(t)) // unique-enough prefix
    || null;
}

function stripLeadingMention(text) {
  return (text || "").replace(/^\s*<@[A-Z0-9]+>\s*/, "").trim();
}

// Parse "<Bot>: rest" or "<Bot> rest". Returns {bot, rest} or null.
function parsePrefixed(bots, text) {
  const m = text.match(/^([^:\n]{1,40}?)\s*:\s*([\s\S]+)$/);
  if (m) { const bot = resolveBot(bots, m[1]); if (bot) return { bot, rest: m[2].trim() }; }
  return null;
}

async function threadFor(channel, bot) {
  state.threads[channel] = state.threads[channel] || {};
  if (state.threads[channel][bot.id]) return state.threads[channel][bot.id];
  const created = await api("POST", `/api/bots/${bot.id}/tasks`, { title: `Slack · #${channel.slice(-6)}` });
  if (created.status !== 201 || !created.json?.task?.threadId) {
    throw new Error(`could not open a thread for ${bot.name} (${created.status}): ${created.text.slice(0, 160)}`);
  }
  state.threads[channel][bot.id] = created.json.task.threadId;
  saveState();
  return state.threads[channel][bot.id];
}

async function awaitReply(threadId, requestMessageId) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=40`);
    const messages = page.json?.messages || [];
    const reply = messages.find((m) => m.role === "bot" && m.kind === "text" && m.turnTerminal && m.requestMessageId === requestMessageId);
    if (reply) return { ok: true, text: reply.text || "", succeeded: reply.turnSucceeded !== false };
    const settled = messages.find((m) => m.role === "bot" && m.turnTerminal && m.requestMessageId === requestMessageId);
    if (settled) return { ok: true, text: "", succeeded: settled.turnSucceeded !== false };
  }
  return { ok: false, text: "O bot ainda está trabalhando nisso — abra maus.giomartins.dev pra acompanhar." };
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const isAllowed = (user) => ALLOWED.length === 0 || ALLOWED.includes(user);
const botListText = (bots) => bots.map((b) => `• *${b.name}*${b.description ? ` — ${b.description.slice(0, 70)}` : ""}`).join("\n");

async function respond(say, client, channel, slackThread, text) {
  await client.chat.postMessage({ channel, thread_ts: slackThread, text });
}

async function handle(say, client, event, label) {
  if (!isAllowed(event.user)) { await say("Você não está na allow-list deste bot."); return; }
  const text = stripLeadingMention(event.text);
  const channel = event.channel;
  const slackThread = event.thread_ts || event.ts;

  let bots;
  try { bots = await fetchBots(); }
  catch (e) { await respond(say, client, channel, slackThread, `Não consegui falar com o maus: ${e.message}`); return; }
  if (!bots.length) { await respond(say, client, channel, slackThread, "Nenhum bot disponível no maus."); return; }

  const lower = text.toLowerCase();
  if (!text || lower === "help" || lower === "ajuda") {
    await respond(say, client, channel, slackThread,
      `*Como usar:*\n• \`list\` — ver os bots\n• \`use <nome>\` — definir o bot padrão deste canal\n• \`<nome>: sua mensagem\` — mandar pro bot escolhido\n• ou só escreva, se já tem um padrão.\n\n${botListText(bots)}`);
    return;
  }
  if (lower === "list" || lower === "bots" || lower === "lista") {
    await respond(say, client, channel, slackThread, `*Bots disponíveis:*\n${botListText(bots)}`);
    return;
  }
  const useMatch = text.match(/^use\s+(.+)$/i);
  if (useMatch) {
    const bot = resolveBot(bots, useMatch[1]);
    if (!bot) { await respond(say, client, channel, slackThread, `Não achei "${useMatch[1].trim()}".\n\n${botListText(bots)}`); return; }
    state.defaults[event.user] = bot.name; saveState();
    await respond(say, client, channel, slackThread, `Beleza — suas mensagens agora vão pro *${bot.name}*. (troque com \`use <nome>\`)`);
    return;
  }

  let bot = null, rest = text;
  const prefixed = parsePrefixed(bots, text);
  if (prefixed) { bot = prefixed.bot; rest = prefixed.rest; }
  else if (state.defaults[event.user]) bot = resolveBot(bots, state.defaults[event.user]);
  else if (FALLBACK_BOT_ID) bot = bots.find((b) => b.id === FALLBACK_BOT_ID) || null;
  else if (bots.length === 1) bot = bots[0];

  if (!bot) {
    await respond(say, client, channel, slackThread,
      `Pra qual bot? Escreva \`<nome>: sua mensagem\` ou defina um padrão com \`use <nome>\`.\n\n${botListText(bots)}`);
    return;
  }
  if (!rest) { await respond(say, client, channel, slackThread, `Manda a mensagem pra *${bot.name}* (ex.: \`${bot.name}: o que você acha?\`).`); return; }

  let threadId;
  try { threadId = await threadFor(channel, bot); }
  catch (e) { await respond(say, client, channel, slackThread, `Não consegui abrir a conversa com *${bot.name}*: ${e.message}`); return; }

  const sendId = randomBytes(20).toString("hex");
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: rest, threadId, sendId });
  if (sent.status !== 202 && sent.status !== 200) {
    await respond(say, client, channel, slackThread, `*${bot.name}* recusou (${sent.status}): ${(sent.json?.error || sent.text || "").slice(0, 180)}`);
    return;
  }
  const result = await awaitReply(threadId, sent.json?.message?.id);
  await respond(say, client, channel, slackThread, `*${bot.name}*\n${result.text?.trim() || "(sem texto)"}`);
}

app.message(async ({ message, say, client }) => {
  if (message.subtype || message.bot_id) return;
  if (message.channel_type !== "im") return;
  await handle(say, client, message, "DM");
});
app.event("app_mention", async ({ event, say, client }) => {
  if (event.bot_id) return;
  await handle(say, client, event, "mention");
});

(async () => {
  await app.start();
  console.log(`[slack-bridge] online (multi-bot) via ${OMB}`);
})();
