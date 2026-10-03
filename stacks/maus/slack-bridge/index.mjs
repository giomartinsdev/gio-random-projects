// maus-slack-bridge — talk to a OpenMausBot bot from Slack.
//
// A tiny two-way bridge: a Slack message (DM or @mention) becomes a turn on
// the bot's thread through the OpenMausBot HTTP API, and the bot's terminal
// reply is posted back to Slack. It runs in the same network namespace as the
// `omb` container, so its loopback calls are the self-hosted owner.
//
// Slack side is Socket Mode: no public URL, no inbound port, outbound WSS only.
//
// Env:
//   SLACK_BOT_TOKEN   xoxb-…   (OAuth bot token; chat:write, im:history, app_mentions:read)
//   SLACK_APP_TOKEN   xapp-…   (app-level token; connections:write — enables Socket Mode)
//   OMB_BOT_ID        the bot id from maus.giomartins.com (GET /api/bots)
//   OMB_URL           default http://127.0.0.1:8799
//   SLACK_ALLOWED_USERS  optional comma-separated Slack user ids; empty = anyone
//   REPLY_TIMEOUT_MS  default 15 min
//
// State (Slack channel → OpenMausBot task) is kept on the /data volume so
// threads survive a restart.
import { App } from "@slack/bolt";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BOT_ID = required("OMB_BOT_ID");
const OMB = (process.env.OMB_URL || "http://127.0.0.1:8799").replace(/\/$/, "");
const STATE_FILE = process.env.STATE_FILE || "/data/slack-bridge-state.json";
const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS || 15 * 60_000);
const ALLOWED = (process.env.SLACK_ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[slack-bridge] missing required env ${name}`); process.exit(1); }
  return v;
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function saveState(state) {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.warn("[slack-bridge] could not persist state:", e.message); }
}
let state = loadState(); // { "<slackChannelId>": { threadId, title } }

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

// One OpenMausBot thread per Slack channel, created once and reused.
async function threadFor(channel, label) {
  if (state[channel]?.threadId) return state[channel].threadId;
  const created = await api("POST", `/api/bots/${BOT_ID}/tasks`, { title: `Slack · ${label}`.slice(0, 80) });
  if (created.status !== 201 || !created.json?.task?.threadId) {
    throw new Error(`could not open a thread (${created.status}): ${created.text.slice(0, 200)}`);
  }
  state[channel] = { threadId: created.json.task.threadId, title: label };
  saveState(state);
  return state[channel].threadId;
}

// Wait for the bot's terminal reply to exactly this request.
async function awaitReply(threadId, requestMessageId) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  const poll = 1500;
  let lastNote = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, poll));
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=40`);
    const messages = page.json?.messages || [];
    const reply = messages.find((m) =>
      m.role === "bot" && m.kind === "text" && m.turnTerminal && m.requestMessageId === requestMessageId);
    if (reply) return { ok: true, text: reply.text || "", succeeded: reply.turnSucceeded !== false };
    // A settled turn with no text still ends the wait.
    const settled = messages.find((m) =>
      m.role === "bot" && m.turnTerminal && m.requestMessageId === requestMessageId);
    if (settled) return { ok: true, text: "", succeeded: settled.turnSucceeded !== false };
    const err = messages.find((m) =>
      m.kind === "activity" && m.tool?.ok === false && m.requestMessageId === requestMessageId);
    if (err && Date.now() - lastNote > 30_000) {
      lastNote = Date.now();
      console.warn(`[slack-bridge] turn error: ${err.tool?.name}`);
    }
  }
  return { ok: false, text: "The bot is still working on this — open maus.giomartins.dev to follow along." };
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

function isAllowed(user) {
  return ALLOWED.length === 0 || ALLOWED.includes(user);
}

async function handle(say, client, event, label) {
  if (!isAllowed(event.user)) {
    await say("You're not on this bot's allow-list.");
    return;
  }
  const text = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!text) return;

  let threadId;
  try {
    threadId = await threadFor(event.channel, label);
  } catch (e) {
    await say(`Could not reach the bot: ${e.message}`);
    return;
  }

  const sendId = randomBytes(20).toString("hex"); // 40 chars, satisfies the server's id rule
  const sent = await api("POST", `/api/bots/${BOT_ID}/messages`, { text, threadId, sendId });
  if (sent.status !== 202 && sent.status !== 200) {
    await say(`The bot refused that (${sent.status}): ${(sent.json?.error || sent.text || "").slice(0, 200)}`);
    return;
  }
  const requestMessageId = sent.json?.message?.id;

  // Slack thread: reply in a Slack thread under the user's message when one exists.
  const slackThread = event.thread_ts || event.ts;
  const result = await awaitReply(threadId, requestMessageId);
  const body = result.text?.trim() || "(no text reply)";
  await client.chat.postMessage({ channel: event.channel, thread_ts: slackThread, text: body });
  if (!result.ok) return;
}

// Direct messages.
app.message(async ({ message, say, client }) => {
  if (message.subtype || message.bot_id) return;
  if (message.channel_type !== "im") return;
  await handle(say, client, message, "DM");
});

// @mentions in channels.
app.event("app_mention", async ({ event, say, client }) => {
  if (event.bot_id) return;
  await handle(say, client, event, "mention");
});

(async () => {
  await app.start();
  console.log(`[slack-bridge] online — bot ${BOT_ID} via ${OMB}`);
})();
