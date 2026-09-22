/* Shared setup for the order chat (order.html) and staff inbox (admin.html). */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// For local testing only: open the page on localhost with ?emulator to use
// the Firebase emulators (`npx firebase emulators:start`) instead of the real project.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const useEmulators = local && new URLSearchParams(location.search).has("emulator");

export const configured = useEmulators || Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export let auth = null;
export let db = null;

if (configured) {
  // Only apiKey and projectId are required; authDomain follows from the project ID.
  const config = useEmulators
    ? { apiKey: "demo-key", projectId: "demo-restaurant" }
    : { ...firebaseConfig, authDomain: firebaseConfig.authDomain || firebaseConfig.projectId + ".firebaseapp.com" };
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

export const STATUSES = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled"
};

export function money(n) {
  return "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

export function timeOf(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " +
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Builds a chat bubble. Everything is set with textContent, so nothing a
// customer types can inject HTML.
export function messageNode(msg, mine) {
  const li = el("li", "msg " + (mine ? "msg-mine" : "msg-theirs"));
  const bubble = el("div", "bubble");
  if (Array.isArray(msg.items) && msg.items.length) {
    const card = el("div", "order-card");
    card.appendChild(el("p", "order-card-title", "Order"));
    const list = el("ul", "order-lines");
    msg.items.forEach((it) => {
      const row = el("li");
      row.appendChild(el("span", "qty", it.qty + "×"));
      row.appendChild(el("span", "name", it.name));
      row.appendChild(el("span", "amt", money(it.price * it.qty)));
      list.appendChild(row);
    });
    card.appendChild(list);
    const total = el("p", "order-total");
    total.appendChild(el("span", null, "Estimated total"));
    total.appendChild(el("strong", null, money(msg.total || 0)));
    card.appendChild(total);
    bubble.appendChild(card);
  }
  if (msg.text) bubble.appendChild(el("p", "text", msg.text));
  li.appendChild(bubble);
  li.appendChild(el("time", "msg-time", timeOf(msg.createdAt)));
  return li;
}

// Reads the menu straight from index.html so it only has to be edited in one place.
// Items whose price isn't a single amount (e.g. "$12–18") are left out of the picker.
export async function loadMenu() {
  const res = await fetch("index.html", { cache: "no-cache" });
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  return Array.from(doc.querySelectorAll('[role="tabpanel"]')).map((panel) => {
    const tab = doc.getElementById(panel.getAttribute("aria-labelledby"));
    const items = Array.from(panel.querySelectorAll(".menu-list > li")).map((li) => {
      const priceText = (li.querySelector(".price") || {}).textContent || "";
      const match = priceText.trim().match(/^\$(\d+(?:\.\d{1,2})?)$/);
      return {
        name: (li.querySelector("h3") || {}).textContent?.trim() || "",
        desc: (li.querySelector("p") || {}).textContent?.trim() || "",
        price: match ? parseFloat(match[1]) : null
      };
    }).filter((it) => it.name && it.price != null);
    return { category: tab ? tab.textContent.trim() : "Menu", items };
  }).filter((c) => c.items.length);
}

export function scrolledToBottom(list) {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
}
