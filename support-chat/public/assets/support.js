/* Customer chat page (/), end-to-end encrypted.

   The customer's browser makes its own key pair for each chat and keeps the
   private half in IndexedDB, where page scripts can use it but can't read it
   out. Messages are sealed here with a key only this browser and the support
   team can make (see e2ee.js); the relay just stores and forwards them. */

import * as e2ee from "./e2ee.js";
import { $, el, loadConfig, relayClient, photoPayload, renderMessages, sortMessages, autosize } from "./support-common.js";

const store = e2ee.idbStore("secure-chat");
const STATES = ["loading", "unavailable", "start", "chat"];

let config = null;
let relay = null;
let chat = null;       // { id, token, privateKey, publicJwk, teamKey, teamKeyId, createdAt }
let key = null;        // AES key for this chat
let items = new Map(); // message id -> { id, seq, from, ts, payload | error, pending, failed }
let readByTeam = 0;
let lastSeq = 0;
let stopListening = null;
let typingTimer = null;
let lastTypingSent = 0;
const SOLVED = "The team marked this chat as solved. Write again any time if you need more help.";

function show(name) {
  STATES.forEach((s) => { $("state-" + s).hidden = s !== name; });
}

function banner(text, action) {
  const b = $("chat-banner");
  b.textContent = text || "";
  if (action) {
    const btn = el("button", "link-btn", action.label);
    btn.type = "button";
    btn.addEventListener("click", action.run);
    b.append(" ", btn);
  }
  b.hidden = !text;
}

function draw() {
  renderMessages($("chat-log"), sortMessages([...items.values()]), {
    me: "customer",
    readUpTo: readByTeam,
    labels: { them: config.brandName },
    onRetry: (item) => { item.failed = false; item.pending = true; draw(); flushOutbox(); },
  });
}

// Start ----------------------------------------------------------------------

async function init() {
  try {
    config = await loadConfig();
  } catch (err) {
    console.error(err);
    return show("unavailable");
  }
  document.title = config.brandName + " · Secure chat";
  if (config.contactUrl && /^(https?:|tel:|mailto:)/.test(config.contactUrl)) {
    $("contact-link").href = config.contactUrl;
    $("contact-link").textContent = config.contactLabel || "Contact us";
    $("contact-link").hidden = false;
  }
  if (!config.teamKey) return show("unavailable");
  relay = relayClient("");
  if (config.replyTime) $("chat-sub").textContent = config.replyTime;
  if (config.retentionDays) $("retention").textContent = config.retentionDays;

  try {
    chat = await store.get("chat");
  } catch (err) {
    console.error(err);
    $("unavailable-text").textContent = "This browser won't let the page store a chat key (private browsing can do this). Please try a normal window.";
    return show("unavailable");
  }
  if (chat) return openChat();
  show("start");
}

$("start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.elements.name.value.trim();
  const order = form.elements.order.value.trim();
  const text = form.elements.message.value.trim();
  const status = $("start-status");
  form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
  if (!name) { form.elements.name.setAttribute("aria-invalid", "true"); form.elements.name.focus(); status.textContent = "Please add your name."; status.className = "form-status error"; return; }
  if (!text) { form.elements.message.setAttribute("aria-invalid", "true"); form.elements.message.focus(); status.textContent = "Please write your message."; status.className = "form-status error"; return; }

  $("start-btn").disabled = true;
  status.textContent = "Locking your chat…";
  status.className = "form-status";
  try {
    const teamKey = e2ee.cleanPublicJwk(config.teamKey);
    const teamKeyId = await e2ee.keyId(teamKey);
    const mine = await e2ee.generateKeyPair();
    relay.setToken(null);
    const { id, token } = await relay.api("/api/conversations", { method: "POST", body: { customerKey: mine.publicJwk, agentKeyId: teamKeyId } });
    chat = { id, token, privateKey: mine.privateKey, publicJwk: mine.publicJwk, teamKey, teamKeyId, createdAt: Date.now() };
    await store.set("chat", chat);
    await store.set("outbox", []);
    await openChat({ quiet: true });
    await send({ type: "profile", name, order, page: "support" });
    await send({ type: "text", text });
    form.reset();
    status.textContent = "";
  } catch (err) {
    console.error(err);
    status.textContent = err.status === 429 ? err.message : "Couldn't start the chat. Check your internet connection and try again.";
    status.className = "form-status error";
    if (chat && !key) { chat = null; await store.del("chat").catch(() => {}); }
  } finally {
    $("start-btn").disabled = false;
  }
});

// The chat -------------------------------------------------------------------

async function openChat({ quiet } = {}) {
  relay.setToken(chat.token);
  key = await e2ee.conversationKey(chat.privateKey, chat.teamKey, chat.id);
  items = new Map();
  readByTeam = 0;
  lastSeq = 0;
  show("chat");
  banner("");

  for (const pending of (await store.get("outbox")) || []) {
    items.set(pending.env.id, { id: pending.env.id, from: "customer", ts: pending.env.ts, payload: pending.payload, pending: true });
  }

  const teamKeyId = await e2ee.keyId(config.teamKey).catch(() => null);
  if (teamKeyId && teamKeyId !== chat.teamKeyId) {
    banner("Our support team has a new security key, so this chat is closed.", { label: "Start a new chat", run: forgetChat });
    $("composer").hidden = true;
  } else {
    $("composer").hidden = false;
  }

  if (!quiet) await sync();
  draw();
  if (stopListening) stopListening();
  stopListening = relay.listen(onEvent, onStatus);
  flushOutbox();
}

async function decrypt(env) {
  try {
    return { id: env.id, seq: env.seq, from: env.from, ts: env.ts, payload: await e2ee.open(key, env) };
  } catch (err) {
    return { id: env.id, seq: env.seq, from: env.from, ts: env.ts, error: true };
  }
}

async function addMessage(env) {
  if (env.conv !== chat.id) return;
  const item = await decrypt(env);
  items.set(item.id, item);
  lastSeq = Math.max(lastSeq, env.seq);
}

// Fetches anything we missed (first load, or after being offline).
async function sync() {
  try {
    const data = await relay.api(`/api/conversations/${chat.id}/messages?after=${lastSeq}`);
    for (const env of data.messages) await addMessage(env);
    readByTeam = data.read.agent;
    if (data.status === "closed") banner(SOLVED);
    else if ($("chat-banner").textContent === SOLVED) banner("");
    else if ($("chat-banner").textContent.startsWith("You're offline")) banner("");
    if (data.typing && data.now - data.typing.agent < 6000) showTyping(6000 - (data.now - data.typing.agent));
    draw();
    markRead();
  } catch (err) {
    if (err.status === 404 || err.status === 401) return chatGone();
    banner("You're offline. Messages will send when you're back online.");
  }
}

function showTyping(ms) {
  $("chat-typing").hidden = false;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { $("chat-typing").hidden = true; }, ms);
}

function onStatus(state) {
  if (state === "tick") {
    if (chat) sync().then(flushOutbox);
  } else if (state === "live") {
    if ($("chat-banner").textContent.startsWith("You're offline")) banner("");
    sync().then(flushOutbox);
  } else if (state === "offline") {
    banner("You're offline. Messages will send when you're back online.");
  } else if (state === "unauthorized") {
    chatGone();
  }
}

async function onEvent(event, data) {
  if (!chat || (data.conv && data.conv !== chat.id)) return;
  if (event === "message") {
    await addMessage(data.message);
    if (data.message.from === "agent") $("chat-typing").hidden = true;
    draw();
    markRead();
  } else if (event === "read" && data.role === "agent") {
    readByTeam = Math.max(readByTeam, data.seq);
    draw();
  } else if (event === "typing" && data.role === "agent") {
    showTyping(5000);
  } else if (event === "status") {
    if (data.status === "closed") banner(SOLVED);
    else banner("");
  } else if (event === "deleted") {
    chatGone();
  }
}

// Tells the team we've read their messages, while the page is on screen.
let readSent = 0;
function markRead() {
  if (document.visibilityState !== "visible" || !chat) return;
  let top = 0;
  for (const i of items.values()) if (i.from === "agent" && i.seq > top) top = i.seq;
  if (top <= readSent) return;
  readSent = top;
  relay.api(`/api/conversations/${chat.id}/read`, { method: "POST", body: { seq: top } }).catch(() => { readSent = 0; });
}
document.addEventListener("visibilitychange", markRead);

// Sending ----------------------------------------------------------------------

async function send(payload) {
  const env = await e2ee.seal(key, { conv: chat.id, from: "customer", payload });
  items.set(env.id, { id: env.id, from: "customer", ts: env.ts, payload, pending: true });
  const outbox = (await store.get("outbox")) || [];
  outbox.push({ env, payload });
  await store.set("outbox", outbox);
  draw();
  await flushOutbox();
}

// Sends sealed messages waiting in the outbox, oldest first. Safe to call
// again at any time: the relay ignores a message id it already has.
let flushing = null;
function flushOutbox() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  let outbox = (await store.get("outbox")) || [];
  while (outbox.length) {
    const { env } = outbox[0];
    const item = items.get(env.id);
    if (item && item.failed) break;
    try {
      const res = await relay.api(`/api/conversations/${chat.id}/messages`, { method: "POST", body: env });
      if (item) { item.pending = false; item.seq = res.seq; }
      lastSeq = Math.max(lastSeq, res.seq);
    } catch (err) {
      if (err.status === 404 || err.status === 401) return chatGone();
      if (err.status && err.status < 500 && err.status !== 429) {
        if (item) { item.pending = false; item.failed = true; }
        draw();
        if (err.status === 413) banner("That photo is too big to send. Try a smaller one.");
      }
      return draw();
    }
    outbox = outbox.slice(1);
    await store.set("outbox", outbox);
    draw();
  }
}

const text = $("composer-text");
const fit = autosize(text);

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value || !chat) return;
  text.value = "";
  fit();
  text.focus();
  await send({ type: "text", text: value });
});

text.addEventListener("keydown", (e) => {
  // Enter sends on a computer; on phones the keyboard's Enter adds a new line.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

text.addEventListener("input", () => {
  if (!chat || Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  relay.api(`/api/conversations/${chat.id}/typing`, { method: "POST" }).catch(() => {});
});

$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !chat) return;
  try {
    await send(await photoPayload(file));
  } catch (err) {
    banner(err.message || "That photo couldn't be sent.");
  }
});

// Security info, menu, deleting ------------------------------------------------

$("lock-btn").addEventListener("click", async () => {
  $("safety-number").textContent = await e2ee.safetyNumber(chat.publicJwk, chat.teamKey);
  $("lock-dialog").showModal();
});

const menu = $("chat-menu");
$("menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $("menu-btn").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", () => { menu.hidden = true; $("menu-btn").setAttribute("aria-expanded", "false"); });

$("delete-chat-btn").addEventListener("click", async () => {
  if (!confirm("Delete this chat for you and for the team? This can't be undone.")) return;
  try {
    await relay.api(`/api/conversations/${chat.id}`, { method: "DELETE" });
  } catch (err) {
    if (err.status !== 404 && err.status !== 401) { banner("Couldn't delete the chat. Check your connection and try again."); return; }
  }
  await forgetChat();
});

async function forgetChat() {
  if (stopListening) stopListening();
  stopListening = null;
  chat = null;
  key = null;
  items = new Map();
  readSent = 0;
  await store.del("chat");
  await store.del("outbox");
  $("chat-log").textContent = "";
  show("start");
}

async function chatGone() {
  if (!chat) return;
  await forgetChat();
  const status = $("start-status");
  status.textContent = "Your previous chat has ended and was deleted. You can start a new one.";
  status.className = "form-status";
}

init();
