/* Customer order chat (order.html) */
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc, collection, query, orderBy, limitToLast, onSnapshot, getDoc, setDoc,
  updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db, configured, STATUSES, money, el, messageNode, loadMenu, scrolledToBottom } from "./chat-common.js";

const $ = (id) => document.getElementById(id);
const states = ["loading", "unavailable", "start", "chat"];
function show(name) {
  states.forEach((s) => { $("state-" + s).hidden = s !== name; });
}

const GREETING = "Hi! Welcome to Ember & Vine. Tap Menu to pick dishes, or just type your order. We'll confirm it and let you know when it's ready.";

let uid = null;
let chat = null;          // latest chat document data
let unsubChat = null;
let unsubMessages = null;
const cart = new Map();   // name -> { name, price, qty }
let unseen = 0;
const baseTitle = document.title;

if (!configured) {
  show("unavailable");
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); }
      catch (err) { console.error(err); show("unavailable"); }
      return;
    }
    uid = user.uid;
    try {
      const snap = await getDoc(doc(db, "chats", uid));
      if (snap.exists()) openChat();
      else show("start");
    } catch (err) {
      console.error(err);
      show("unavailable");
    }
  });
}

// Start form ---------------------------------------------------------------
const startForm = $("start-form");
const addressField = startForm.querySelector(".address-field");
startForm.addEventListener("change", () => {
  const delivery = startForm.elements.fulfilment.value === "delivery";
  addressField.hidden = !delivery;
  startForm.elements.address.required = delivery;
});

startForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = startForm.elements;
  const status = startForm.querySelector(".form-status");
  let firstInvalid = null;
  ["name", "phone", "address"].forEach((n) => {
    const bad = f[n].required && !f[n].value.trim();
    f[n].toggleAttribute("aria-invalid", bad);
    if (bad && !firstInvalid) firstInvalid = f[n];
  });
  if (firstInvalid) {
    status.textContent = "Please fill in the highlighted fields.";
    status.className = "form-status error";
    firstInvalid.focus();
    return;
  }
  const button = startForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await setDoc(doc(db, "chats", uid), {
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      fulfilment: f.fulfilment.value,
      address: f.fulfilment.value === "delivery" ? f.address.value.trim() : "",
      status: "new",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: "",
      lastSender: "customer",
      unreadForStaff: false,
      unreadForCustomer: false
    });
    openChat();
  } catch (err) {
    console.error(err);
    status.textContent = "Sorry, we couldn't start the chat. Please try again or call us.";
    status.className = "form-status error";
  } finally {
    button.disabled = false;
  }
});

// Chat ---------------------------------------------------------------------
const list = $("messages");

function openChat() {
  show("chat");
  if (unsubChat) return;

  unsubChat = onSnapshot(doc(db, "chats", uid), (snap) => {
    if (!snap.exists()) {
      // Staff removed the conversation: start fresh.
      unsubChat(); unsubMessages && unsubMessages();
      unsubChat = unsubMessages = null;
      show("start");
      return;
    }
    chat = snap.data();
    const pill = $("status-pill");
    pill.textContent = STATUSES[chat.status] || "";
    pill.dataset.status = chat.status;
    $("chat-sub").textContent = (chat.fulfilment === "delivery" ? "Delivery" : "Pickup") + " · " + chat.name;
    if (chat.unreadForCustomer && !document.hidden) markRead();
  });

  const q = query(collection(db, "chats", uid, "messages"), orderBy("createdAt"), limitToLast(300));
  let first = true;
  unsubMessages = onSnapshot(q, (snap) => {
    const stick = first || scrolledToBottom(list);
    list.replaceChildren(messageNode({ text: GREETING }, false));
    snap.forEach((d) => {
      const m = d.data({ serverTimestamps: "estimate" });
      list.appendChild(messageNode(m, m.sender === "customer"));
    });
    if (!first && document.hidden) {
      const incoming = snap.docChanges().filter((c) => c.type === "added" && c.doc.data().sender === "staff").length;
      if (incoming) { unseen += incoming; document.title = "(" + unseen + ") " + baseTitle; }
    }
    if (stick) list.scrollTop = list.scrollHeight;
    first = false;
  });
}

function markRead() {
  updateDoc(doc(db, "chats", uid), { unreadForCustomer: false }).catch(console.error);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    unseen = 0;
    document.title = baseTitle;
    if (chat && chat.unreadForCustomer) markRead();
  }
});

async function send(text, items) {
  const msgRef = doc(collection(db, "chats", uid, "messages"));
  const message = { sender: "customer", text, createdAt: serverTimestamp() };
  const chatUpdate = {
    lastMessage: items ? "🧾 Order: " + items.map((i) => i.qty + "× " + i.name).join(", ") : text,
    lastSender: "customer",
    unreadForStaff: true,
    updatedAt: serverTimestamp()
  };
  if (items) {
    message.items = items;
    message.total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    chatUpdate.status = "new";
  }
  chatUpdate.lastMessage = chatUpdate.lastMessage.slice(0, 500);
  const batch = writeBatch(db);
  batch.set(msgRef, message);
  batch.update(doc(db, "chats", uid), chatUpdate);
  await batch.commit();
}

const composer = $("composer");
const input = $("composer-text");
composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autosize();
  try { await send(text); }
  catch (err) {
    console.error(err);
    input.value = text;
    alert("Your message didn't send. Please check your connection and try again.");
  }
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.requestSubmit(); }
});
function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
input.addEventListener("input", autosize);

// Menu picker ----------------------------------------------------------------
const dialog = $("menu-dialog");
const picker = $("menu-picker");
let menuLoaded = false;

async function openMenu() {
  dialog.showModal();
  if (menuLoaded) return;
  try {
    const menu = await loadMenu();
    picker.replaceChildren();
    menu.forEach((section) => {
      picker.appendChild(el("h3", "picker-cat", section.category));
      const ul = el("ul", "picker-list");
      section.items.forEach((item) => {
        const li = el("li", "picker-item");
        const info = el("div", "picker-info");
        const head = el("p", "picker-name");
        head.appendChild(el("span", null, item.name));
        head.appendChild(el("span", "picker-price", money(item.price)));
        info.appendChild(head);
        if (item.desc) info.appendChild(el("p", "picker-desc", item.desc));
        const stepper = el("div", "stepper");
        const minus = el("button", "icon-btn", "−");
        const qty = el("span", "stepper-qty", "0");
        const plus = el("button", "icon-btn", "+");
        minus.type = plus.type = "button";
        minus.setAttribute("aria-label", "Remove one " + item.name);
        plus.setAttribute("aria-label", "Add one " + item.name);
        qty.setAttribute("aria-live", "polite");
        const change = (delta) => {
          const current = cart.get(item.name)?.qty || 0;
          const next = Math.max(0, Math.min(20, current + delta));
          if (next) cart.set(item.name, { name: item.name, price: item.price, qty: next });
          else cart.delete(item.name);
          qty.textContent = next;
          li.classList.toggle("in-cart", next > 0);
          updateCart();
        };
        minus.addEventListener("click", () => change(-1));
        plus.addEventListener("click", () => change(1));
        stepper.append(minus, qty, plus);
        li.append(info, stepper);
        ul.appendChild(li);
      });
      picker.appendChild(ul);
    });
    menuLoaded = true;
  } catch (err) {
    console.error(err);
    picker.replaceChildren(el("p", "muted", "Couldn't load the menu. You can type your order in the chat instead."));
  }
}

function updateCart() {
  const items = Array.from(cart.values());
  const count = items.reduce((n, i) => n + i.qty, 0);
  const total = items.reduce((n, i) => n + i.qty * i.price, 0);
  const sendBtn = $("send-order");
  sendBtn.disabled = !count;
  sendBtn.textContent = count ? "Send order · " + count + " item" + (count > 1 ? "s" : "") + " · " + money(total) : "Send order";
  $("cart-bar").hidden = !count;
  $("cart-summary").textContent = count + " item" + (count > 1 ? "s" : "") + " · " + money(total);
}

$("open-menu").addEventListener("click", openMenu);
$("cart-review").addEventListener("click", openMenu);
dialog.addEventListener("click", (e) => {
  if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
});

$("send-order").addEventListener("click", async () => {
  const items = Array.from(cart.values());
  if (!items.length) return;
  const btn = $("send-order");
  btn.disabled = true;
  try {
    await send($("order-note").value.trim(), items);
    cart.clear();
    $("order-note").value = "";
    picker.querySelectorAll(".stepper-qty").forEach((q) => { q.textContent = "0"; });
    picker.querySelectorAll(".in-cart").forEach((li) => li.classList.remove("in-cart"));
    updateCart();
    dialog.close();
  } catch (err) {
    console.error(err);
    alert("Your order didn't send. Please check your connection and try again.");
    btn.disabled = false;
  }
});
