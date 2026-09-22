/* Staff inbox (admin.html) */
import {
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc, collection, query, orderBy, limit, limitToLast, onSnapshot, getDoc,
  updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db, configured, STATUSES, el, timeOf, messageNode, scrolledToBottom } from "./chat-common.js";

const $ = (id) => document.getElementById(id);
const states = ["loading", "unavailable", "login", "denied", "inbox"];
function show(name) {
  states.forEach((s) => { $("state-" + s).hidden = s !== name; });
  $("signout-btn").hidden = !(name === "inbox" || name === "denied");
  $("alerts-btn").hidden = !(name === "inbox" && "Notification" in window && Notification.permission === "default");
  document.body.classList.toggle("inbox-open", name === "inbox");
}

const ACTIVE = ["new", "confirmed", "preparing", "ready"];
const baseTitle = document.title;

let chats = [];             // [{ id, ...data }]
let selectedId = null;
let unsubList = null;
let unsubThread = null;
let unsubThreadDoc = null;

if (!configured) show("unavailable");
else {
  onAuthStateChanged(auth, async (user) => {
    stopListening();
    if (!user || user.isAnonymous) { show("login"); return; }
    try {
      const admin = await getDoc(doc(db, "admins", user.uid));
      if (!admin.exists()) {
        $("denied-uid").textContent = user.uid;
        show("denied");
        return;
      }
    } catch (err) {
      console.error(err);
      $("denied-uid").textContent = user.uid;
      $("denied-title").textContent = "Couldn't check staff access";
      $("denied-rules").hidden = false;
      show("denied");
      return;
    }
    show("inbox");
    listenToList();
  });
}

function stopListening() {
  [unsubList, unsubThread, unsubThreadDoc].forEach((u) => u && u());
  unsubList = unsubThread = unsubThreadDoc = null;
  selectedId = null;
}

// Login ----------------------------------------------------------------------
const loginForm = $("login-form");
const loginStatus = loginForm.querySelector(".form-status");
function loginMessage(text, type) { loginStatus.textContent = text; loginStatus.className = "form-status " + (type || ""); }

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { email, password } = loginForm.elements;
  if (!email.value.trim() || !password.value) { loginMessage("Enter your email and password.", "error"); return; }
  const btn = loginForm.querySelector("button[type=submit]");
  btn.disabled = true;
  loginMessage("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    loginForm.reset();
    loginMessage("");
  } catch (err) {
    console.error(err);
    const messages = {
      "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
      "auth/network-request-failed": "Can't reach the server. Check your internet connection and try again.",
      "auth/operation-not-allowed": "Email/Password sign-in is switched off. In Firebase, open Authentication → Sign-in method and enable Email/Password.",
      "auth/configuration-not-found": "Sign-in isn't set up yet. In Firebase, open Authentication and click Get started, then enable Email/Password.",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The apiKey in assets/js/firebase-config.js is wrong. Copy the Web API Key again from Firebase Project settings.",
      "auth/invalid-api-key": "The apiKey in assets/js/firebase-config.js is wrong. Copy the Web API Key again from Firebase Project settings."
    };
    loginMessage(messages[err.code] || "That email and password don't match a staff account.", "error");
  } finally {
    btn.disabled = false;
  }
});

$("reset-btn").addEventListener("click", async () => {
  const email = loginForm.elements.email.value.trim();
  if (!email) { loginMessage("Type your email above first, then tap “Forgot password?”.", "error"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) { console.error(err); }
  // Same message either way, so the form doesn't reveal which emails have accounts.
  loginMessage("If that's a staff email, a password reset link is on its way.", "success");
});

const doSignOut = () => signOut(auth);
$("signout-btn").addEventListener("click", doSignOut);
$("denied-signout").addEventListener("click", doSignOut);

$("alerts-btn").addEventListener("click", async () => {
  await Notification.requestPermission();
  $("alerts-btn").hidden = Notification.permission !== "default";
});

// Conversation list ----------------------------------------------------------
const filter = $("filter");
filter.addEventListener("change", renderList);

function listenToList() {
  let first = true;
  const q = query(collection(db, "chats"), orderBy("updatedAt", "desc"), limit(300));
  unsubList = onSnapshot(q, (snap) => {
    chats = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (!first) {
      snap.docChanges().forEach((c) => {
        const data = c.doc.data();
        if (c.type !== "removed" && data.unreadForStaff && data.lastSender === "customer" && !c.doc.metadata.hasPendingWrites) {
          alertNewMessage(data);
        }
      });
    }
    first = false;
    renderList();
    updateTitle();
  }, (err) => console.error(err));
}

function renderList() {
  const list = $("convo-list");
  const f = filter.value;
  const shown = chats.filter((c) =>
    f === "all" ? true : f === "active" ? ACTIVE.includes(c.status) : c.status === f);
  list.replaceChildren(...shown.map((c) => {
    const li = el("li");
    const btn = el("button", "convo" + (c.id === selectedId ? " selected" : "") + (c.unreadForStaff ? " unread" : ""));
    btn.type = "button";
    const top = el("span", "convo-top");
    top.appendChild(el("span", "convo-name", c.name || "Customer"));
    top.appendChild(el("span", "convo-time", timeOf(c.updatedAt)));
    const bottom = el("span", "convo-bottom");
    bottom.appendChild(el("span", "convo-last", (c.lastSender === "staff" ? "You: " : "") + (c.lastMessage || "Started a chat")));
    const pill = el("span", "status-pill", STATUSES[c.status] || "");
    pill.dataset.status = c.status;
    bottom.appendChild(pill);
    btn.append(top, bottom);
    btn.addEventListener("click", () => selectChat(c.id));
    li.appendChild(btn);
    return li;
  }));
  $("list-empty").hidden = shown.length > 0;
}

function updateTitle() {
  const unread = chats.filter((c) => c.unreadForStaff).length;
  document.title = (unread ? "(" + unread + ") " : "") + baseTitle;
}

// New-message alerts: a short chime, plus a system notification if allowed.
let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((freq, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.15;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
  } catch (_) { /* audio not available */ }
}
function alertNewMessage(data) {
  chime();
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification("New message from " + (data.name || "a customer"), { body: data.lastMessage || "", icon: "assets/icon-192.png" });
  }
}

// Conversation thread --------------------------------------------------------
const statusSelect = $("t-status");
Object.entries(STATUSES).forEach(([value, label]) => statusSelect.add(new Option(label, value)));

function selectChat(id) {
  if (unsubThread) unsubThread();
  if (unsubThreadDoc) unsubThreadDoc();
  selectedId = id;
  document.body.classList.add("thread-open");
  ["thread-top", "t-messages", "quick-replies", "t-composer"].forEach((x) => { $(x).hidden = false; });
  $("thread-empty").hidden = true;
  renderList();

  unsubThreadDoc = onSnapshot(doc(db, "chats", id), (snap) => {
    if (!snap.exists()) { closeThread(); return; }
    const c = snap.data();
    $("t-name").textContent = c.name || "Customer";
    const phone = $("t-phone");
    phone.textContent = c.phone || "";
    phone.href = "tel:" + (c.phone || "").replace(/[^\d+]/g, "");
    $("t-fulfilment").textContent = c.fulfilment === "delivery" ? " · Delivery" : " · Pickup";
    $("t-address").textContent = c.fulfilment === "delivery" && c.address ? "📍 " + c.address : "";
    $("t-address").hidden = !$("t-address").textContent;
    statusSelect.value = c.status;
    statusSelect.dataset.status = c.status;
    if (c.unreadForStaff && !document.hidden) {
      updateDoc(doc(db, "chats", id), { unreadForStaff: false }).catch(console.error);
    }
  });

  const list = $("t-messages");
  list.replaceChildren();
  let first = true;
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt"), limitToLast(300));
  unsubThread = onSnapshot(q, (snap) => {
    const stick = first || scrolledToBottom(list);
    list.replaceChildren(...snap.docs.map((d) => {
      const m = d.data({ serverTimestamps: "estimate" });
      return messageNode(m, m.sender === "staff");
    }));
    if (!snap.size) list.appendChild(el("li", "muted empty-note", "No messages yet."));
    if (stick) list.scrollTop = list.scrollHeight;
    first = false;
  });
  if (window.matchMedia("(min-width: 821px)").matches) $("t-text").focus();
}

function closeThread() {
  if (unsubThread) unsubThread();
  if (unsubThreadDoc) unsubThreadDoc();
  unsubThread = unsubThreadDoc = null;
  selectedId = null;
  document.body.classList.remove("thread-open");
  ["thread-top", "t-messages", "quick-replies", "t-composer"].forEach((x) => { $(x).hidden = true; });
  $("thread-empty").hidden = false;
  renderList();
}
$("back-btn").addEventListener("click", closeThread);

// When the tab comes back into view, clear the unread flag on the open chat.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !selectedId) return;
  const c = chats.find((x) => x.id === selectedId);
  if (c && c.unreadForStaff) updateDoc(doc(db, "chats", selectedId), { unreadForStaff: false }).catch(console.error);
});

statusSelect.addEventListener("change", async () => {
  if (!selectedId) return;
  const label = STATUSES[statusSelect.value];
  try {
    await reply("Order status: " + label, { status: statusSelect.value });
  } catch (err) {
    console.error(err);
    alert("Couldn't update the status. Please try again.");
  }
});

async function reply(text, extra) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "chats", selectedId, "messages")), {
    sender: "staff", text, createdAt: serverTimestamp()
  });
  batch.update(doc(db, "chats", selectedId), Object.assign({
    lastMessage: text.slice(0, 500),
    lastSender: "staff",
    unreadForCustomer: true,
    unreadForStaff: false,
    updatedAt: serverTimestamp()
  }, extra || {}));
  await batch.commit();
}

const composer = $("t-composer");
const input = $("t-text");
composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !selectedId) return;
  input.value = "";
  autosize();
  try { await reply(text); }
  catch (err) {
    console.error(err);
    input.value = text;
    alert("Your reply didn't send. Please try again.");
  }
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); }
});
function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
input.addEventListener("input", autosize);

$("quick-replies").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  input.value = b.textContent.trim();
  autosize();
  input.focus();
});
