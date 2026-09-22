/* Order on WhatsApp (order.html) */

// ---------------------------------------------------------------------------
// EDIT: the WhatsApp number that receives orders, with country code,
// e.g. "+234 801 234 5678". Spaces and dashes are fine.
// While it's empty, the page shows "Online ordering is coming soon".
// ---------------------------------------------------------------------------
const WHATSAPP_NUMBER = "+234 705 994 6531";
const RESTAURANT_NAME = "Food Is Ready";

const $ = (id) => document.getElementById(id);
const digits = WHATSAPP_NUMBER.replace(/\D/g, "");
const form = $("order-form");
const cart = new Map(); // name -> { name, price, qty }

function money(n) {
  return "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function waLink(text) {
  return "https://wa.me/" + digits + (text ? "?text=" + encodeURIComponent(text) : "");
}

if (digits.length < 8) {
  $("state-unavailable").hidden = false;
} else {
  form.hidden = false;
  $("wa-chat-link").href = waLink("Hi " + RESTAURANT_NAME + "! I have a question:");
  loadMenu().then(renderMenu).catch((err) => {
    console.error(err);
    $("menu-picker").replaceChildren(el("p", "muted", "Couldn't load the menu. Write what you'd like in the note below instead."));
  });
}

// Reads the menu straight from index.html so it only has to be edited in one place.
// Items whose price isn't a single amount (e.g. "$12–18") are left out of the picker.
async function loadMenu() {
  const res = await fetch("index.html", { cache: "no-cache" });
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  return Array.from(doc.querySelectorAll('[role="tabpanel"]')).map((panel) => {
    const tab = doc.getElementById(panel.getAttribute("aria-labelledby"));
    const items = Array.from(panel.querySelectorAll(".menu-list > li")).map((li) => {
      const match = (li.querySelector(".price")?.textContent || "").trim().match(/^\$(\d+(?:\.\d{1,2})?)$/);
      return {
        name: li.querySelector("h3")?.textContent.trim() || "",
        desc: li.querySelector("p")?.textContent.trim() || "",
        price: match ? parseFloat(match[1]) : null
      };
    }).filter((it) => it.name && it.price != null);
    return { category: tab ? tab.textContent.trim() : "Menu", items };
  }).filter((c) => c.items.length);
}

function renderMenu(menu) {
  const picker = $("menu-picker");
  picker.replaceChildren();
  menu.forEach((section) => {
    picker.appendChild(el("h3", "picker-cat", section.category));
    const ul = el("ul", "picker-list");
    section.items.forEach((item) => {
      const li = el("li", "picker-item");
      const info = el("div", "picker-info");
      const head = el("p", "picker-name");
      head.append(el("span", null, item.name), el("span", "picker-price", money(item.price)));
      info.appendChild(head);
      if (item.desc) info.appendChild(el("p", "picker-desc", item.desc));

      const stepper = el("div", "stepper");
      const minus = el("button", "icon-btn", "−");
      const qty = el("span", "stepper-qty", "0");
      const plus = el("button", "icon-btn", "+");
      minus.type = plus.type = "button";
      minus.setAttribute("aria-label", "Remove one " + item.name);
      plus.setAttribute("aria-label", "Add one " + item.name);
      const change = (delta) => {
        const next = Math.max(0, Math.min(20, (cart.get(item.name)?.qty || 0) + delta));
        if (next) cart.set(item.name, { name: item.name, price: item.price, qty: next });
        else cart.delete(item.name);
        qty.textContent = next;
        li.classList.toggle("in-cart", next > 0);
        updateSummary();
      };
      minus.addEventListener("click", () => change(-1));
      plus.addEventListener("click", () => change(1));
      stepper.append(minus, qty, plus);
      li.append(info, stepper);
      ul.appendChild(li);
    });
    picker.appendChild(ul);
  });
}

function totals() {
  const items = Array.from(cart.values());
  return {
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    total: items.reduce((n, i) => n + i.qty * i.price, 0)
  };
}

function updateSummary() {
  const { count, total } = totals();
  $("summary").textContent = count
    ? count + " item" + (count > 1 ? "s" : "") + " · " + money(total)
    : "No dishes picked yet";
  if (count) setStatus("");
}

function setStatus(msg, type) {
  const s = $("order-status");
  s.textContent = msg;
  s.className = "form-status" + (type ? " " + type : "");
}

// Details ------------------------------------------------------------------
const addressField = form.querySelector(".address-field");
form.addEventListener("change", (e) => {
  if (e.target.name !== "fulfilment") return;
  const delivery = form.elements.fulfilment.value === "delivery";
  addressField.hidden = !delivery;
  form.elements.address.required = delivery;
});

// Clear a field's error highlight (and the message) as soon as it's fixed.
form.addEventListener("input", (e) => {
  if (e.target.hasAttribute("aria-invalid") && e.target.value.trim()) {
    e.target.removeAttribute("aria-invalid");
    if (!form.querySelector("[aria-invalid]")) setStatus("");
  }
  if (e.target.name === "note" && e.target.value.trim()) setStatus("");
});

try {
  const saved = JSON.parse(localStorage.getItem("order-details") || "{}");
  if (saved.name) form.elements.name.value = saved.name;
  if (saved.address) form.elements.address.value = saved.address;
} catch (_) { /* storage unavailable */ }

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = form.elements;
  const { items, count, total } = totals();
  const note = f.note.value.trim();
  const delivery = f.fulfilment.value === "delivery";

  let firstInvalid = null;
  ["name", "address"].forEach((n) => {
    const bad = f[n].required && !f[n].value.trim();
    f[n].toggleAttribute("aria-invalid", bad);
    if (bad && !firstInvalid) firstInvalid = f[n];
  });
  if (!count && !note) {
    setStatus("Pick at least one dish, or write your order in the note.", "error");
    return;
  }
  if (firstInvalid) {
    setStatus("Please fill in the highlighted fields.", "error");
    firstInvalid.focus();
    return;
  }

  const lines = ["Hello " + RESTAURANT_NAME + "! I'd like to order:", ""];
  items.forEach((i) => lines.push("• " + i.qty + "× " + i.name + " — " + money(i.qty * i.price)));
  if (count) lines.push("", "Total: " + money(total));
  lines.push("", "Name: " + f.name.value.trim());
  lines.push(delivery ? "Delivery to: " + f.address.value.trim() : "Pickup");
  if (note) lines.push("Note: " + note);

  try {
    localStorage.setItem("order-details", JSON.stringify({ name: f.name.value.trim(), address: f.address.value.trim() }));
  } catch (_) { /* storage unavailable */ }

  const url = waLink(lines.join("\n"));
  const win = window.open(url, "_blank");
  if (win) win.opener = null;
  else window.location.href = url; // pop-up blocked: open in this tab
  setStatus("WhatsApp is opening with your order. Just press send!", "success");
});
