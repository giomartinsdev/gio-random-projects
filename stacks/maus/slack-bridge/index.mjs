// maus-slack-bridge — a full channel agent for OpenMausBot, in Slack.
//
// @mention the app in a channel (or DM it) and it opens a Slack thread bound
// to one OpenMausBot conversation. The bot posts its progress and replies
// there, and anything you write in that Slack thread continues the SAME
// maus thread. Everything lands in maus.giomartins.dev.
//
// It runs in omb's network namespace, so its loopback calls are the
// self-hosted owner. Slack uses Socket Mode (outbound WSS only; no public
// URL, no inbound port).
//
// Usage:
//   @GioBot list                 → list your bots
//   @GioBot use BackendBOT       → set this channel's default bot
//   @GioBot BackendBOT: do X     → start a thread on BackendBOT with task X
//   @GioBot do X                 → start on the channel/user default
//   (then keep replying in that Slack thread — same maus thread)
//
// Env:
//   SLACK_BOT_TOKEN      xoxb-…
//   SLACK_APP_TOKEN      xapp-…
//   OMB_URL              default http://127.0.0.1:8799
//   OMB_DEFAULT_BOT_ID   optional fallback when nothing is chosen
//   SLACK_ALLOWED_USERS  optional comma-separated Slack user ids; empty = anyone
//   SLACK_SHOW_TOOLS     "1" (default) to post tool activity lines
//   POLL_MS              default 3000
//
// State lives on /data (sessions: Slack thread → maus thread).
import { App } from "@slack/bolt";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OMB = (process.env.OMB_URL || "http://127.0.0.1:8799").replace(/\/$/, "");
const STATE_FILE = process.env.STATE_FILE || "/data/slack-bridge-state.json";
const FALLBACK_BOT_ID = process.env.OMB_DEFAULT_BOT_ID || "";
const ALLOWED = (process.env.SLACK_ALLOWED_USERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SHOW_TOOLS = (process.env.SLACK_SHOW_TOOLS ?? "1") !== "0";
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS || 3000));
const SEND_ID_RE = /^[A-Za-z0-9_-]{16,80}$/;

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
  console.error("[slack-bridge] missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN");
  process.exit(1);
}

// state = {
//   defaults:        { "<slackUserId>": "<botName>" },
//   channelDefaults: { "<channelId>":   "<botName>" },
//   sessions:        { "<channelId>:<rootTs>": { botId, botName, threadId, seen: { "<msgId>": true } } }
// }
function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { defaults: s.defaults || {}, channelDefaults: s.channelDefaults || {}, sessions: s.sessions || {} };
  } catch { return { defaults: {}, channelDefaults: {}, sessions: {} }; }
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
  return (r.json?.bots || []).filter((b) => !b.hidden).map((b) => ({ id: b.id, name: b.name, description: b.description || "" }));
}
function resolveBot(bots, token) {
  const t = (token || "").trim().toLowerCase();
  if (!t) return null;
  return bots.find((b) => b.id.toLowerCase() === t)
    || bots.find((b) => b.name.toLowerCase() === t)
    || bots.find((b) => b.name.toLowerCase().startsWith(t)) || null;
}
const stripMention = (text) => (text || "").replace(/^\s*<@[A-Z0-9]+>\s*/, "").trim();
const botListText = (bots) => bots.map((b) => `• *${b.name}*${b.description ? ` — ${b.description.slice(0, 70)}` : ""}`).join("\n");
const newSendId = () => randomBytes(20).toString("hex");

const app = new App({ token: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN, socketMode: true });

async function post(client, channel, threadTs, text) {
  try { return await client.chat.postMessage({ channel, thread_ts: threadTs, text, unfurl_links: false }); }
  catch (e) { console.warn("[slack-bridge] post failed:", e.message); return null; }
}

function sessionKey(channel, rootTs) { return `${channel}:${rootTs}`; }

async function startSession(client, channel, rootTs, bot, label) {
  const created = await api("POST", `/api/bots/${bot.id}/tasks`, { title: `Slack · ${label}`.slice(0, 80) });
  if (created.status !== 201 || !created.json?.task?.threadId) {
    throw new Error(`could not open a thread on ${bot.name} (${created.status}): ${created.text.slice(0, 160)}`);
  }
  const key = sessionKey(channel, rootTs);
  state.sessions[key] = { botId: bot.id, botName: bot.name, threadId: created.json.task.threadId, seen: {} };
  saveState();
  return state.sessions[key];
}

async function sendToMaus(session, text) {
  const sendId = newSendId();
  const sent = await api("POST", `/api/bots/${session.botId}/messages`, { text, threadId: session.threadId, sendId });
  return sent;
}

// The single poller: push every new bot message from each session's maus
// thread into its Slack thread. Tool activity becomes a compact line.
const inflight = new Set();
async function pollOnce(slack) {
  for (const [key, session] of Object.entries(state.sessions)) {
    if (inflight.has(key)) continue;
    inflight.add(key);
    try {
      const [channel, rootTs] = key.split(":");
      const page = await api("GET", `/api/threads/${session.threadId}/messages?limit=50`);
      const messages = page.json?.messages || [];
      for (const m of messages) {
        if (session.seen[m.id]) continue;
        // Seed anything that predates the session without reposting it.
        session.seen[m.id] = true;
        if (m.role !== "bot") continue;
        if (m.kind === "text" && (m.text || "").trim()) {
          await post(slack, channel, rootTs, `*${session.botName}*\n${m.text}`);
        } else if (m.kind === "activity" && SHOW_TOOLS && m.tool?.name) {
          const line = m.tool.spoken || (m.tool.ok === false ? `❌ ${m.tool.name}` : `· ${m.tool.name}`);
          if (m.tool.ok === false) await post(slack, channel, rootTs, `_${line}_`);
        } else if (m.kind === "options" && m.card) {
          await post(slack, channel, rootTs, `*${session.botName}* pede uma decisão: ${m.card.title || m.card.subtitle || m.card.requestType || ""}`);
        }
      }
      saveState();
    } catch (e) {
      console.warn(`[slack-bridge] poll ${key} failed:`, e.message);
    } finally {
      inflight.delete(key);
    }
  }
}

async function resolveAndRun(slack, client, channel, rootTs, user, rawText) {
  const text = stripMention(rawText);
  let bots;
  try { bots = await fetchBots(); }
  catch (e) { await post(client, channel, rootTs, `Não consegui falar com o maus: ${e.message}`); return; }
  if (!bots.length) { await post(client, channel, rootTs, "Nenhum bot disponível no maus."); return; }

  const lower = text.toLowerCase();
  if (!text || lower === "help" || lower === "ajuda") {
    await post(client, channel, rootTs,
      `*Como usar:*\n• \`list\` — ver os bots\n• \`use <nome>\` — definir o bot padrão deste canal\n• \`<nome>: sua tarefa\` — começar uma thread com esse bot\n• ou só escreva, se já tem padrão.\n\nDepois é só responder nesta thread do Slack pra continuar.\n\n${botListText(bots)}`);
    return;
  }
  if (lower === "list" || lower === "bots" || lower === "lista") {
    await post(client, channel, rootTs, `*Bots disponíveis:*\n${botListText(bots)}`);
    return;
  }
  const use = text.match(/^use\s+(.+)$/i);
  if (use) {
    const bot = resolveBot(bots, use[1]);
    if (!bot) { await post(client, channel, rootTs, `Não achei "${use[1].trim()}".\n\n${botListText(bots)}`); return; }
    state.channelDefaults[channel] = bot.name; saveState();
    await post(client, channel, rootTs, `Beleza — este canal agora usa *${bot.name}*. (troque com \'use <nome>\')`);
    return;
  }

  let bot = null, rest = text;
  const prefixed = text.match(/^([^:\n]{1,40}?)\s*:\s*([\s\S]+)$/);
  if (prefixed) { const b = resolveBot(bots, prefixed[1]); if (b) { bot = b; rest = prefixed[2].trim(); } }
  if (!bot && state.channelDefaults[channel]) bot = resolveBot(bots, state.channelDefaults[channel]);
  if (!bot && state.defaults[user]) bot = resolveBot(bots, state.defaults[user]);
  if (!bot && FALLBACK_BOT_ID) bot = bots.find((b) => b.id === FALLBACK_BOT_ID) || null;
  if (!bot && bots.length === 1) bot = bots[0];
  if (!bot) { await post(client, channel, rootTs, `Pra qual bot? Escreva \`<nome>: sua tarefa\` ou defina um padrão com \`use <nome>\`.\n\n${botListText(bots)}`); return; }
  if (!rest) { await post(client, channel, rootTs, `Manda a tarefa pra *${bot.name}* (ex.: \`${bot.name}: escreva um plano\`).`); return; }

  const key = sessionKey(channel, rootTs);
  let session = state.sessions[key];
  if (!session) {
    session = await startSession(client, channel, rootTs, bot, rest.slice(0, 40) || "nova");
  }
  const sent = await sendToMaus(session, rest);
  if (sent.status !== 202 && sent.status !== 200) {
    await post(client, channel, rootTs, `*${bot.name}* recusou (${sent.status}): ${(sent.json?.error || sent.text || "").slice(0, 180)}`);
  }
}

// @mention in a channel → open a Slack thread bound to a maus thread.
// A mention INSIDE a thread is left to the message handler below, so the
// event is not processed twice (Slack sends both app_mention and
// message.channels for it).
app.event("app_mention", async ({ event, client }) => {
  if (event.bot_id) return;
  if (ALLOWED.length && !ALLOWED.includes(event.user)) return;
  if (event.thread_ts) return; // thread continuation is handled by app.message
  await resolveAndRun(app.client, client, event.channel, event.ts, event.user, event.text);
});

// Replies in a Slack thread we own → continue the same maus thread.
async function onThreadMessage({ event, client }) {
  if (event.bot_id || event.subtype) return;
  if (!event.thread_ts) return;
  const key = sessionKey(event.channel, event.thread_ts);
  const session = state.sessions[key];
  if (!session) return; // not our thread
  if (ALLOWED.length && !ALLOWED.includes(event.user)) return;
  const text = stripMention(event.text);
  if (!text) return;
  const sent = await sendToMaus(session, text);
  if (sent.status !== 202 && sent.status !== 200) {
    await post(client, event.channel, event.thread_ts, `*${session.botName}* recusou: ${(sent.json?.error || "").slice(0, 160)}`);
  }
}
app.message(async ({ message, client }) => {
  if (message.bot_id || message.subtype) return;
  if (message.channel_type === "im") {
    // DMs: a plain message starts/continues a thread of its own.
    const rootTs = message.thread_ts || message.ts;
    const key = sessionKey(message.channel, rootTs);
    if (state.sessions[key]) return onThreadMessage({ event: message, client });
    await resolveAndRun(app.client, client, message.channel, rootTs, message.user, message.text);
    return;
  }
  return onThreadMessage({ event: message, client });
});

(async () => {
  await app.start();
  console.log(`[slack-bridge] online (channel agent) via ${OMB}`);
  setInterval(() => { void pollOnce(app.client); }, POLL_MS).unref?.();
  void pollOnce(app.client);
})();
