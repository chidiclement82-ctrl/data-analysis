/* Support inbox for the Ogarider team (support-agent.html).

   The team key's private half is kept on each staff device in IndexedDB,
   where scripts can use it but can't read it out. It arrives there by
   creating it (first time) or loading the passphrase-protected backup file.
   Customer chats are unlocked on this device only; the relay never sees them. */

import * as e2ee from "./e2ee.js";
import { $, el, loadConfig, relayClient, photoPayload, renderMessages, sortMessages, autosize, preview, timeOf, dayOf } from "./support-common.js";

const OWNER = "chidiclement82-ctrl";
const REPO = "data-analysis";
const BRANCH = "main";
const GITHUB_TOKEN_KEY = "menu-admin-token"; // shared with admin.html
const SESSION_KEY = "support-agent-session";
const NAME_KEY = "support-agent-name";
const QUICK_KEY = "support-quick-replies";
const SOUND_KEY = "support-sound";
const SKIP_PUBLISH_KEY = "support-skip-publish"; // { keyId, relay } when publishing was skipped
const DEFAULT_QUICK = [
  "Hi! Thanks for reaching out, I'm looking into this now.",
  "Could you send us your order number, please?",
  "So sorry about that! We'll make it right.",
  "Your rider is on the way.",
  "Is there anything else we can help with?",
];

const keyStore = e2ee.idbStore("ogarider-support-team");
const STATES = ["loading", "setup", "publish", "login", "inbox"];

let config = {};
let relay = null;
let team = null;      // { privateKey, publicJwk }
let teamKeyId = null;
let lastBackup = null; // the backup made on this visit, to download again
let stopListening = null;
let filter = "open";
let selected = null;  // conversation id on screen
const convs = new Map(); // id -> { summary, key, items: Map, loaded, typingUntil }

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage off */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* storage off */ } },
};

function show(name) {
  STATES.forEach((s) => { $("state-" + s).hidden = s !== name; });
  $("signout-btn").hidden = name !== "inbox";
  $("settings-btn").hidden = name !== "inbox";
}

function say(id, text, type) {
  $(id).textContent = text;
  $(id).className = "form-status " + (type || "");
}

// Start ------------------------------------------------------------------------

async function init() {
  try { config = await loadConfig(); } catch (_) { config = {}; }
  try {
    team = await keyStore.get("teamKey");
  } catch (err) {
    console.error(err);
    say("restore-status", "This browser won't store keys (private browsing?). Use a normal window.", "error");
  }
  if (!team) return show("setup");
  teamKeyId = await e2ee.keyId(team.publicJwk);
  next();
}

// After the key is in place: make sure it's published, then sign in.
async function next() {
  const published = config.teamKey ? await e2ee.keyId(config.teamKey).catch(() => null) : null;
  let skipped = null;
  try { skipped = JSON.parse(ls.get(SKIP_PUBLISH_KEY) || "null"); } catch (_) { /* ignore */ }
  if (skipped && skipped.keyId !== teamKeyId) skipped = null;
  if ((published !== teamKeyId || !config.relayUrl) && !skipped) return showPublish(published);
  relay = relayClient((skipped && skipped.relay) || config.relayUrl);
  const saved = JSON.parse(ls.get(SESSION_KEY) || "null");
  if (saved && saved.exp > Date.now() && saved.relay === relay.base) {
    relay.setToken(saved.token);
    return openInbox();
  }
  showLogin();
}

function showLogin() {
  const form = $("login-form");
  form.elements.agent.value = ls.get(NAME_KEY) || "";
  show("login");
  (form.elements.agent.value ? form.elements.password : form.elements.agent).focus();
}

// Team key: restore or create --------------------------------------------------

$("restore-btn").addEventListener("click", async () => {
  const file = $("backup-file").files[0];
  const pass = $("backup-pass").value;
  if (!file) return say("restore-status", "Choose the backup file first.", "error");
  if (!pass) return say("restore-status", "Type the passphrase.", "error");
  say("restore-status", "Unlocking… (this takes a few seconds)");
  $("restore-btn").disabled = true;
  try {
    const backup = JSON.parse(await file.text());
    const restored = await e2ee.importBackup(backup, pass);
    await keyStore.set("teamKey", restored);
    team = restored;
    teamKeyId = await e2ee.keyId(team.publicJwk);
    $("backup-pass").value = "";
    say("restore-status", "");
    next();
  } catch (err) {
    say("restore-status", err.message === "wrong passphrase" ? "That passphrase doesn't open this backup." : "That isn't a team key backup file.", "error");
  } finally {
    $("restore-btn").disabled = false;
  }
});

$("create-btn").addEventListener("click", async () => {
  const pass = $("new-pass").value;
  if (pass.length < 12) return say("create-status", "Use at least 12 characters. A few random words works well.", "error");
  if (pass !== $("new-pass2").value) return say("create-status", "The two passphrases don't match.", "error");
  if (config.teamKey && !confirm("The website already has a team key. Making a new one means chats sealed for the old key can only be read on devices that still have it. Continue?")) return;
  say("create-status", "Creating… (this takes a few seconds)");
  $("create-btn").disabled = true;
  try {
    const fresh = await e2ee.generateKeyPair(true);
    lastBackup = await e2ee.exportBackup(fresh.privateKey, fresh.publicJwk, pass);
    // Store it here non-extractable: from now on only the backup file holds it in readable form.
    const restored = await e2ee.importBackup(lastBackup, pass);
    await keyStore.set("teamKey", restored);
    team = restored;
    teamKeyId = await e2ee.keyId(team.publicJwk);
    downloadBackup();
    $("new-pass").value = $("new-pass2").value = "";
    say("create-status", "");
    next();
  } catch (err) {
    console.error(err);
    say("create-status", "Couldn't create the key in this browser.", "error");
  } finally {
    $("create-btn").disabled = false;
  }
});

function downloadBackup() {
  if (!lastBackup) return;
  const blob = new Blob([JSON.stringify(lastBackup, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ogarider-support-team-key.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("backup-again-btn").addEventListener("click", downloadBackup);

// Publishing the public key to support.json ----------------------------------

function publishedConfig(relayUrl) {
  return {
    relayUrl: relayUrl.replace(/\/+$/, ""),
    teamName: config.teamName || "Ogarider support",
    replyTime: config.replyTime || "We usually reply within a few minutes",
    retentionDays: config.retentionDays || 30,
    teamKey: team.publicJwk,
    teamKeyId,
  };
}

async function showPublish(published) {
  $("publish-why").textContent = !config.teamKey
    ? "Customers' browsers lock messages for the key published in support.json on the website. Publish this device's key so customers can start chats."
    : published !== teamKeyId
      ? "The website publishes a different team key from the one on this device. Chats sealed for that key won't open here. Publish this key if it's the new team key; otherwise restore the right backup."
      : "Add the chat server's address so customers' browsers know where to send messages.";
  $("publish-fp").textContent = await e2ee.keyFingerprint(team.publicJwk);
  $("publish-relay").value = config.relayUrl || "";
  $("publish-token").value = ls.get(GITHUB_TOKEN_KEY) || "";
  $("backup-again-btn").hidden = !lastBackup;
  updatePublishJson();
  show("publish");
}

function updatePublishJson() {
  $("publish-json").value = JSON.stringify(publishedConfig($("publish-relay").value.trim()), null, 2) + "\n";
}
$("publish-relay").addEventListener("input", updatePublishJson);

$("publish-btn").addEventListener("click", async () => {
  const relayUrl = $("publish-relay").value.trim();
  const token = $("publish-token").value.trim();
  if (!/^https:\/\/[^\s/]+/.test(relayUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(relayUrl)) {
    return say("publish-status", "Paste the chat server's https:// address.", "error");
  }
  if (!token) return say("publish-status", "Paste your GitHub access token.", "error");
  say("publish-status", "Checking the chat server…");
  try {
    const res = await fetch(relayUrl.replace(/\/+$/, "") + "/healthz");
    if (!res.ok) throw new Error();
  } catch (_) {
    return say("publish-status", "Couldn't reach the chat server at that address. Check it, and that ALLOWED_ORIGINS includes this website.", "error");
  }
  say("publish-status", "Publishing…");
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/support.json`;
  const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + token };
  try {
    let sha;
    const current = await fetch(api + "?ref=" + BRANCH, { headers, cache: "no-store" });
    if (current.status === 401) throw new Error("That GitHub token isn't valid.");
    if (current.ok) sha = (await current.json()).sha;
    const body = JSON.stringify(publishedConfig(relayUrl), null, 2) + "\n";
    const bytes = new TextEncoder().encode(body);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const put = await fetch(api, {
      method: "PUT",
      headers,
      body: JSON.stringify({ message: "Support chat: publish team key", content: btoa(bin), branch: BRANCH, sha }),
    });
    if (put.status === 401 || put.status === 403 || put.status === 404) throw new Error("That GitHub token can't change this website.");
    if (!put.ok) throw new Error("GitHub said " + put.status);
    ls.set(GITHUB_TOKEN_KEY, token);
    config = publishedConfig(relayUrl);
    ls.del(SKIP_PUBLISH_KEY);
    say("publish-status", "Published. The website picks it up in about a minute.", "success");
    setTimeout(next, 1200);
  } catch (err) {
    say("publish-status", err.message || "Couldn't publish.", "error");
  }
});

$("publish-skip").addEventListener("click", () => {
  const relayUrl = $("publish-relay").value.trim();
  if (!relayUrl) return say("publish-status", "Add the chat server's address first, so the inbox knows where to connect.", "error");
  ls.set(SKIP_PUBLISH_KEY, JSON.stringify({ keyId: teamKeyId, relay: relayUrl }));
  next();
});

// Signing in ---------------------------------------------------------------------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const agent = form.elements.agent.value.trim();
  const password = form.elements.password.value;
  if (!agent) return say("login-status", "Add your first name.", "error");
  if (!password) return say("login-status", "Type the team password.", "error");
  say("login-status", "Signing in…");
  try {
    relay.setToken(null);
    const { token, expiresIn } = await relay.api("/api/agent/login", { method: "POST", body: { password } });
    relay.setToken(token);
    ls.set(NAME_KEY, agent);
    ls.set(SESSION_KEY, JSON.stringify({ token, exp: Date.now() + expiresIn - 60000, relay: relay.base }));
    form.elements.password.value = "";
    say("login-status", "");
    openInbox();
  } catch (err) {
    say("login-status", err.status ? err.message : "Couldn't reach the chat server.", "error");
  }
});

$("signout-btn").addEventListener("click", async () => {
  await relay.api("/api/agent/logout", { method: "POST" }).catch(() => {});
  signedOut();
});

function signedOut(message) {
  if (stopListening) stopListening();
  stopListening = null;
  ls.del(SESSION_KEY);
  relay.setToken(null);
  convs.clear();
  selected = null;
  showLogin();
  if (message) say("login-status", message, "error");
}

// The inbox ------------------------------------------------------------------------

async function openInbox() {
  show("inbox");
  try {
    await refreshList();
  } catch (err) {
    if (err.status === 401) return signedOut("Your sign-in ran out. Sign in again.");
    $("inbox-live").textContent = "Can't reach the chat server. Retrying…";
  }
  if (stopListening) stopListening();
  stopListening = relay.listen(onEvent, onStatus);
  renderQuickReplies();
}

async function refreshList() {
  const { conversations } = await relay.api("/api/agent/conversations");
  const seen = new Set();
  for (const summary of conversations) {
    seen.add(summary.id);
    await upsert(summary);
  }
  for (const id of [...convs.keys()]) if (!seen.has(id)) convs.delete(id);
  // Load messages a few chats at a time.
  const todo = [...convs.values()];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c = todo.shift(); c; c = todo.shift()) await sync(c);
  }));
  drawList();
  if (selected && !convs.has(selected)) closeChat();
  if (selected) drawChat();
}

async function upsert(summary) {
  let c = convs.get(summary.id);
  if (!c) {
    c = { summary, key: null, items: new Map(), lastSeq: 0, typingUntil: 0 };
    convs.set(summary.id, c);
    if (summary.agentKeyId === teamKeyId) {
      try { c.key = await e2ee.conversationKey(team.privateKey, summary.customerKey, summary.id); } catch (_) { c.key = null; }
    }
  }
  c.summary = summary;
  return c;
}

async function addMessage(c, env) {
  let item;
  try {
    if (!c.key) throw new Error("locked");
    item = { id: env.id, seq: env.seq, from: env.from, ts: env.ts, payload: await e2ee.open(c.key, env) };
  } catch (_) {
    item = { id: env.id, seq: env.seq, from: env.from, ts: env.ts, error: true };
  }
  const had = c.items.get(item.id);
  c.items.set(item.id, item);
  c.lastSeq = Math.max(c.lastSeq, env.seq);
  return !had;
}

async function sync(c) {
  try {
    const data = await relay.api(`/api/conversations/${c.summary.id}/messages?after=${c.lastSeq}`);
    for (const env of data.messages) await addMessage(c, env);
    c.summary.read = data.read;
    c.summary.status = data.status;
  } catch (err) {
    if (err.status === 404) convs.delete(c.summary.id);
    else throw err;
  }
}

function profileOf(c) {
  let p = null;
  for (const i of c.items.values()) if (i.payload && i.payload.type === "profile") p = i.payload;
  return p || {};
}

function nameOf(c) {
  if (!c.key) return "Locked chat";
  return profileOf(c).name || "Customer";
}

function unread(c) {
  let n = 0;
  for (const i of c.items.values()) if (i.from === "customer" && i.seq > (c.summary.read ? c.summary.read.agent : 0)) n++;
  return n;
}

function lastItem(c) {
  let last = null;
  for (const i of c.items.values()) if (!(i.payload && i.payload.type === "profile") && (!last || (i.seq || Infinity) > (last.seq || Infinity))) last = i;
  return last;
}

function matches(c, q) {
  if (!q) return true;
  const hay = [nameOf(c), profileOf(c).order || ""];
  for (const i of c.items.values()) if (i.payload && i.payload.type === "text") hay.push(i.payload.text);
  return hay.join("\n").toLowerCase().includes(q);
}

function drawList() {
  const list = $("conv-list");
  const q = $("inbox-search").value.trim().toLowerCase();
  const all = [...convs.values()].sort((a, b) => b.summary.lastAt - a.summary.lastAt);
  const openCount = all.filter((c) => c.summary.status === "open").length;
  $("count-open").textContent = openCount ? String(openCount) : "";
  const shown = all.filter((c) => (filter === "all" || c.summary.status === filter) && matches(c, q));
  list.textContent = "";
  if (!shown.length) {
    list.appendChild(el("li", "conv-none muted", q ? "No chats match." : filter === "open" ? "No open chats. 🎉" : "Nothing here yet."));
  }
  for (const c of shown) {
    const li = el("li");
    const btn = el("button", "conv" + (c.summary.id === selected ? " is-selected" : "") + (c.key ? "" : " is-locked"));
    btn.type = "button";
    const top = el("div", "conv-top");
    top.append(el("strong", "conv-name", nameOf(c)), el("span", "conv-time", c.summary.lastAt > Date.now() - 86400000 ? timeOf(c.summary.lastAt) : dayOf(c.summary.lastAt)));
    const bottom = el("div", "conv-bottom");
    const last = lastItem(c);
    const order = profileOf(c).order;
    let line = last ? (last.from === "agent" ? "You: " : "") + preview(last) : "…";
    if (!c.key) line = "Sealed for a different team key";
    bottom.appendChild(el("span", "conv-preview", (order ? "#" + order + " · " : "") + line));
    const n = unread(c);
    if (n) bottom.appendChild(el("span", "conv-badge", String(n)));
    if (Date.now() < c.typingUntil) bottom.firstChild.textContent = "typing…";
    btn.append(top, bottom);
    btn.addEventListener("click", () => selectChat(c.summary.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
  const total = all.reduce((sum, c) => sum + unread(c), 0);
  document.title = (total ? `(${total}) ` : "") + "Support inbox — Ogarider";
}

document.querySelectorAll(".inbox-tabs [data-filter]").forEach((tab) => {
  tab.addEventListener("click", () => {
    filter = tab.dataset.filter;
    document.querySelectorAll(".inbox-tabs [data-filter]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    drawList();
  });
});
$("inbox-search").addEventListener("input", drawList);

// One chat ---------------------------------------------------------------------------

function selectChat(id) {
  selected = id;
  $("state-inbox").classList.add("is-viewing");
  $("inbox-empty").hidden = true;
  ["chat-bar", "chat-log", "composer"].forEach((x) => { $(x).hidden = false; });
  $("composer-text").value = drafts.get(id) || "";
  fit();
  drawChat({ scroll: true });
  drawList();
  markRead();
  if (window.matchMedia("(hover: hover)").matches) $("composer-text").focus();
}

function closeChat() {
  selected = null;
  $("state-inbox").classList.remove("is-viewing");
  $("inbox-empty").hidden = false;
  ["chat-bar", "chat-log", "composer", "chat-banner", "chat-typing", "quick-replies"].forEach((x) => { $(x).hidden = true; });
  drawList();
}
$("back-btn").addEventListener("click", closeChat);

function drawChat({ scroll } = {}) {
  const c = convs.get(selected);
  if (!c) return closeChat();
  const p = profileOf(c);
  $("chat-name").textContent = nameOf(c);
  $("chat-sub").textContent = [p.order ? "Order " + p.order : "", "started " + dayOf(c.summary.createdAt).toLowerCase() + " " + timeOf(c.summary.createdAt)].filter(Boolean).join(" · ");
  $("solve-btn").textContent = c.summary.status === "closed" ? "Reopen" : "Mark solved";
  const banner = $("chat-banner");
  if (!c.key) {
    banner.textContent = "This chat was sealed for a different team key. Restore that key's backup on this device to read it.";
    banner.hidden = false;
  } else if (c.summary.status === "closed") {
    banner.textContent = "Solved. If the customer writes again it reopens by itself.";
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  $("composer").hidden = !c.key;
  $("quick-replies").hidden = !c.key || !quickReplies().length;
  $("chat-typing").hidden = Date.now() >= c.typingUntil;
  const log = $("chat-log");
  renderMessages(log, sortMessages([...c.items.values()]), {
    me: "agent",
    readUpTo: c.summary.read ? c.summary.read.customer : 0,
    labels: { them: nameOf(c) },
    onRetry: (item) => { item.failed = false; item.pending = true; drawChat(); flushOutbox(c); },
  });
  if (scroll) log.scrollTop = log.scrollHeight;
}

function markRead() {
  const c = convs.get(selected);
  if (!c || document.visibilityState !== "visible") return;
  let top = 0;
  for (const i of c.items.values()) if (i.from === "customer" && i.seq > top) top = i.seq;
  if (!c.summary.read || top <= c.summary.read.agent) return;
  c.summary.read.agent = top;
  drawList();
  relay.api(`/api/conversations/${c.summary.id}/read`, { method: "POST", body: { seq: top } }).catch(() => {});
}
document.addEventListener("visibilitychange", markRead);

// Sending --------------------------------------------------------------------------------

const outboxes = new Map(); // conv id -> [{ env, payload }]

async function send(payload) {
  const c = convs.get(selected);
  if (!c || !c.key) return;
  const env = await e2ee.seal(c.key, { conv: c.summary.id, from: "agent", payload });
  c.items.set(env.id, { id: env.id, from: "agent", ts: env.ts, payload, pending: true });
  if (!outboxes.has(c.summary.id)) outboxes.set(c.summary.id, []);
  outboxes.get(c.summary.id).push({ env, payload });
  drawChat({ scroll: true });
  await flushOutbox(c);
}

async function flushOutbox(c) {
  const queue = outboxes.get(c.summary.id) || [];
  while (queue.length) {
    const { env } = queue[0];
    const item = c.items.get(env.id);
    try {
      const res = await relay.api(`/api/conversations/${c.summary.id}/messages`, { method: "POST", body: env });
      if (item) { item.pending = false; item.seq = res.seq; }
      c.lastSeq = Math.max(c.lastSeq, res.seq);
      queue.shift();
    } catch (err) {
      if (err.status === 401) return signedOut("Your sign-in ran out. Sign in again.");
      if (err.status === 404) { convs.delete(c.summary.id); closeChat(); return; }
      if (item && err.status && err.status < 500 && err.status !== 429) { item.pending = false; item.failed = true; queue.shift(); }
      break;
    }
  }
  if (selected === c.summary.id) drawChat();
  drawList();
}

const text = $("composer-text");
const fit = autosize(text);
const drafts = new Map();
let lastTypingSent = 0;

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value || !selected) return;
  text.value = "";
  drafts.delete(selected);
  fit();
  await send({ type: "text", text: value, by: ls.get(NAME_KEY) || undefined });
});

text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

text.addEventListener("input", () => {
  if (selected) drafts.set(selected, text.value);
  if (!selected || Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  relay.api(`/api/conversations/${selected}/typing`, { method: "POST" }).catch(() => {});
});

$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    await send({ ...(await photoPayload(file)), by: ls.get(NAME_KEY) || undefined });
  } catch (err) {
    alert(err.message || "That photo couldn't be sent.");
  }
});

// Quick replies --------------------------------------------------------------------------

function quickReplies() {
  const saved = ls.get(QUICK_KEY);
  return saved == null ? DEFAULT_QUICK : saved.split("\n").map((s) => s.trim()).filter(Boolean);
}

function renderQuickReplies() {
  const box = $("quick-replies");
  box.textContent = "";
  for (const reply of quickReplies()) {
    const chip = el("button", "chip", reply);
    chip.type = "button";
    chip.addEventListener("click", () => {
      text.value = text.value ? text.value.replace(/\s*$/, " ") + reply : reply;
      if (selected) drafts.set(selected, text.value);
      fit();
      text.focus();
    });
    box.appendChild(chip);
  }
}

// Chat actions -------------------------------------------------------------------------------

$("solve-btn").addEventListener("click", async () => {
  const c = convs.get(selected);
  if (!c) return;
  const status = c.summary.status === "closed" ? "open" : "closed";
  try {
    const res = await relay.api(`/api/conversations/${c.summary.id}/status`, { method: "POST", body: { status } });
    c.summary.status = res.status;
    drawChat();
    drawList();
  } catch (err) {
    alert(err.message);
  }
});

$("lock-btn").addEventListener("click", async () => {
  const c = convs.get(selected);
  if (!c) return;
  $("safety-number").textContent = await e2ee.safetyNumber(team.publicJwk, c.summary.customerKey);
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
  const c = convs.get(selected);
  if (!c || !confirm(`Delete the chat with ${nameOf(c)} for everyone? This can't be undone.`)) return;
  try {
    await relay.api(`/api/conversations/${c.summary.id}`, { method: "DELETE" });
  } catch (err) {
    if (err.status !== 404) return alert(err.message);
  }
  convs.delete(c.summary.id);
  closeChat();
});

// Live updates and alerts -----------------------------------------------------------------------

function onStatus(state) {
  if (state === "live") {
    $("inbox-live").textContent = "";
    refreshList().catch(() => {});
  } else if (state === "offline") {
    $("inbox-live").textContent = "Reconnecting…";
  } else if (state === "unauthorized") {
    signedOut("Your sign-in ran out. Sign in again.");
  }
}

async function onEvent(event, data) {
  if (event === "conversation") {
    const isNew = !convs.has(data.id);
    const c = await upsert(data);
    if (isNew) { await sync(c).catch(() => {}); }
    drawList();
    if (selected === data.id) drawChat();
  } else if (event === "message") {
    let c = convs.get(data.conv);
    if (!c) return;
    const fresh = await addMessage(c, data.message);
    c.summary.lastAt = data.message.at;
    if (data.message.from === "customer") {
      c.typingUntil = 0;
      if (fresh) alertNew(c, c.items.get(data.message.id));
    }
    if (selected === data.conv) { drawChat(); markRead(); }
    drawList();
  } else if (event === "read") {
    const c = convs.get(data.conv);
    if (!c) return;
    c.summary.read = { ...c.summary.read, [data.role]: Math.max(c.summary.read[data.role] || 0, data.seq) };
    if (selected === data.conv) drawChat();
    drawList();
  } else if (event === "typing" && data.role === "customer") {
    const c = convs.get(data.conv);
    if (!c) return;
    c.typingUntil = Date.now() + 5000;
    if (selected === data.conv) $("chat-typing").hidden = false;
    drawList();
    setTimeout(() => { if (selected === data.conv) $("chat-typing").hidden = Date.now() >= c.typingUntil; drawList(); }, 5100);
  } else if (event === "status") {
    const c = convs.get(data.conv);
    if (!c) return;
    c.summary.status = data.status;
    if (selected === data.conv) drawChat();
    drawList();
  } else if (event === "deleted") {
    convs.delete(data.conv);
    if (selected === data.conv) closeChat();
    else drawList();
  }
}

function alertNew(c, item) {
  const onScreen = selected === c.summary.id && document.visibilityState === "visible";
  if (onScreen) return;
  if (ls.get(SOUND_KEY) !== "off") beep();
  if ("Notification" in window && Notification.permission === "granted") {
    // The notification text is shown by this device only; it never leaves it.
    const n = new Notification(nameOf(c), { body: item && !item.error ? preview(item).slice(0, 140) : "New message", tag: c.summary.id, icon: "assets/icon-192.png" });
    n.onclick = () => { window.focus(); selectChat(c.summary.id); n.close(); };
  }
}

let audio = null;
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.4);
  } catch (_) { /* no sound */ }
}

// Settings ---------------------------------------------------------------------------------------

$("settings-btn").addEventListener("click", async () => {
  const form = $("settings-form");
  form.elements.quick.value = quickReplies().join("\n");
  form.elements.sound.checked = ls.get(SOUND_KEY) !== "off";
  $("settings-fp").textContent = await e2ee.keyFingerprint(team.publicJwk);
  $("notify-btn").hidden = !("Notification" in window) || Notification.permission === "granted";
  $("settings-dialog").showModal();
});

$("settings-dialog").addEventListener("close", () => {
  if ($("settings-dialog").returnValue !== "save") return;
  const form = $("settings-form");
  ls.set(QUICK_KEY, form.elements.quick.value);
  ls.set(SOUND_KEY, form.elements.sound.checked ? "on" : "off");
  renderQuickReplies();
  if (selected) drawChat();
});

$("notify-btn").addEventListener("click", async () => {
  const result = await Notification.requestPermission();
  $("notify-btn").textContent = result === "granted" ? "Notifications are on" : "Notifications are blocked in this browser's settings";
});

$("forget-key-btn").addEventListener("click", async () => {
  if (!confirm("Remove the team key from this device? You'll need the backup file and passphrase to read chats here again.")) return;
  await keyStore.del("teamKey");
  ls.del(SESSION_KEY);
  location.reload();
});

init();
