/* Order on WhatsApp (order.html) */

// ---------------------------------------------------------------------------
// EDIT: the WhatsApp number that receives orders, with country code,
// e.g. "+234 801 234 5678". Spaces and dashes are fine.
// While it's empty, the page shows "Online ordering is coming soon".
// ---------------------------------------------------------------------------
const WHATSAPP_NUMBER = "+234 705 994 6531";
const RESTAURANT_NAME = "Ogarider";

const $ = (id) => document.getElementById(id);
const digits = WHATSAPP_NUMBER.replace(/\D/g, "");
const form = $("order-form");
const cart = new Map(); // name -> { name, price, qty }

let currency = "₦";
function money(n) {
  return currency + Math.round(n).toLocaleString("en-NG");
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

// Reads the menu from menu.json (edited on admin.html). Sold-out dishes are
// shown but can't be added. Older files had sections at the top level.
async function loadMenu() {
  const res = await fetch("menu.json?v=" + Date.now());
  if (!res.ok) throw new Error("HTTP " + res.status);
  const menu = await res.json();
  currency = menu.currency || currency;
  const restaurants = menu.restaurants || [{ name: "", categories: menu.categories || [] }];
  return restaurants.map((r) => ({
    name: r.name || "",
    image: r.image || "",
    categories: (r.categories || []).map((c) => ({
      name: c.name,
      items: (c.items || []).filter((it) => it.name).map((it) => ({
        name: it.name, desc: it.description || "", price: Number(it.price) || 0,
        image: it.image || "", soldOut: it.available === false
      }))
    })).filter((c) => c.items.length)
  })).filter((r) => r.categories.length);
}

function renderMenu(restaurants) {
  const picker = $("menu-picker");
  picker.replaceChildren();
  const many = restaurants.length > 1;
  restaurants.forEach((r) => {
    if (many || r.name) {
      const head = el("div", "picker-restaurant");
      if (r.image) { const img = el("img"); img.src = r.image; img.alt = ""; img.loading = "lazy"; head.appendChild(img); }
      head.appendChild(el("h3", null, r.name || "Restaurant"));
      picker.appendChild(head);
    }
    r.categories.forEach((section) => {
      picker.appendChild(el("h4", "picker-cat", section.name));
      const ul = el("ul", "picker-list");
      section.items.forEach((item) => ul.appendChild(pickerItem(r.name, item)));
      picker.appendChild(ul);
    });
  });
}

function pickerItem(restaurant, item) {
  const key = restaurant + "\u0000" + item.name;
  const li = el("li", "picker-item");
  if (item.image) {
    const img = el("img", "picker-photo"); img.src = item.image; img.alt = ""; img.loading = "lazy";
    li.appendChild(img);
  }
  const info = el("div", "picker-info");
  const head = el("p", "picker-name");
  head.append(el("span", null, item.name), el("span", "picker-price", money(item.price)));
  info.appendChild(head);
  if (item.desc) info.appendChild(el("p", "picker-desc", item.desc));
  if (item.soldOut) {
    li.classList.add("sold-out");
    li.append(info, el("span", "sold-out-label", "Sold out"));
    return li;
  }

  const stepper = el("div", "stepper");
  const minus = el("button", "icon-btn", "−");
  const qty = el("span", "stepper-qty", "0");
  const plus = el("button", "icon-btn", "+");
  minus.type = plus.type = "button";
  minus.setAttribute("aria-label", "Remove one " + item.name);
  plus.setAttribute("aria-label", "Add one " + item.name);
  const change = (delta) => {
    const next = Math.max(0, Math.min(20, (cart.get(key)?.qty || 0) + delta));
    if (next) cart.set(key, { restaurant, name: item.name, price: item.price, qty: next });
    else cart.delete(key);
    qty.textContent = next;
    li.classList.toggle("in-cart", next > 0);
    updateSummary();
  };
  minus.addEventListener("click", () => change(-1));
  plus.addEventListener("click", () => change(1));
  stepper.append(minus, qty, plus);
  li.append(info, stepper);
  return li;
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

  const lines = ["Hello " + RESTAURANT_NAME + "! I'd like to order:"];
  // Group dishes by restaurant so the kitchen knows where each one comes from.
  const byRestaurant = new Map();
  items.forEach((i) => {
    if (!byRestaurant.has(i.restaurant)) byRestaurant.set(i.restaurant, []);
    byRestaurant.get(i.restaurant).push(i);
  });
  const named = byRestaurant.size > 1 || (items[0] && items[0].restaurant);
  byRestaurant.forEach((list, restaurant) => {
    lines.push("");
    if (named && restaurant) lines.push("*" + restaurant + "*");
    list.forEach((i) => lines.push("• " + i.qty + "× " + i.name + " — " + money(i.qty * i.price)));
  });
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
