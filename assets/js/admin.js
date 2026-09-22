/* Menu admin (admin.html): edits menu.json in the GitHub repo.
   Saving commits the file to the main branch, which republishes the site. */

const OWNER = "chidiclement82-ctrl";
const REPO = "data-analysis";
const BRANCH = "main";
const FILE = "menu.json";
const API = "https://api.github.com/repos/" + OWNER + "/" + REPO;
const TOKEN_KEY = "menu-admin-token";
const TAGS = ["Spicy", "Popular", "Vegetarian"];

const $ = (id) => document.getElementById(id);
let token = null;
let menu = null;   // the menu being edited
let sha = null;    // version of menu.json we loaded, required by GitHub to save
let dirty = false;

function show(name) {
  ["login", "loading", "editor"].forEach((s) => { $("state-" + s).hidden = s !== name; });
  $("signout-btn").hidden = name !== "editor";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function gh(path, options = {}) {
  return fetch(API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    cache: "no-store"
  });
}

// GitHub sends file contents as base64; decode/encode as UTF-8 so ₦ survives.
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Sign in -------------------------------------------------------------------
const loginForm = $("login-form");
const loginStatus = loginForm.querySelector(".form-status");
function loginMessage(text, type) { loginStatus.textContent = text; loginStatus.className = "form-status " + (type || ""); }

async function signIn(candidate, silent) {
  token = candidate;
  show("loading");
  $("loading-text").textContent = "Signing in…";
  try {
    const res = await gh("");
    if (res.status === 401) throw new Error("bad-token");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const repo = await res.json();
    if (!repo.permissions || !repo.permissions.push) throw new Error("no-access");
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) { /* storage unavailable */ }
    await loadMenu();
  } catch (err) {
    console.error(err);
    token = null;
    // Forget the token only if GitHub rejected it, not on a network hiccup.
    if (err.message === "bad-token" || err.message === "no-access") {
      try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* storage unavailable */ }
    }
    show("login");
    if (!silent) {
      loginMessage(
        err.message === "bad-token" ? "That token isn't valid. Check you copied all of it, or make a new one." :
        err.message === "no-access" ? "That token can't change this website. Make a new one with the public_repo box ticked." :
        "Couldn't connect to GitHub. Check your internet connection and try again.", "error");
    } else {
      loginMessage("Please sign in again.", "error");
      try { loginForm.elements.token.value = localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { /* storage unavailable */ }
    }
  }
}

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = loginForm.elements.token.value.trim();
  if (!value) { loginMessage("Paste your access token first.", "error"); return; }
  loginMessage("");
  signIn(value);
});

$("signout-btn").addEventListener("click", () => {
  if (dirty && !confirm("You have unsaved changes. Sign out anyway?")) return;
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* storage unavailable */ }
  token = null; menu = null; dirty = false;
  loginForm.reset();
  loginMessage("");
  show("login");
});

// Load and save -------------------------------------------------------------
async function loadMenu() {
  $("loading-text").textContent = "Loading the menu…";
  show("loading");
  const res = await gh("/contents/" + FILE + "?ref=" + BRANCH);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const file = await res.json();
  sha = file.sha;
  menu = JSON.parse(fromBase64(file.content));
  menu.categories = menu.categories || [];
  setDirty(false);
  render();
  show("editor");
}

function setDirty(value) {
  dirty = value;
  $("save-btn").disabled = !value;
  $("save-state").textContent = value ? "You have unsaved changes" : "All changes saved";
  if (value) setSaveStatus("");
}

function setSaveStatus(text, type) {
  const s = $("save-status");
  s.textContent = text;
  s.className = "form-status" + (type ? " " + type : "");
}

function problems() {
  for (const cat of menu.categories) {
    if (!(cat.name || "").trim()) return "Every menu section needs a name.";
    for (const item of cat.items) {
      if (!(item.name || "").trim()) return "Every dish in \"" + cat.name + "\" needs a name.";
      if (!(item.price >= 0)) return "\"" + item.name + "\" needs a price (numbers only, e.g. 6500).";
    }
  }
  return null;
}

$("save-btn").addEventListener("click", async () => {
  const problem = problems();
  if (problem) { setSaveStatus(problem, "error"); return; }
  const btn = $("save-btn");
  btn.disabled = true;
  setSaveStatus("Saving…");
  try {
    const res = await gh("/contents/" + FILE, {
      method: "PUT",
      body: JSON.stringify({
        message: "Update menu from admin page",
        content: toBase64(JSON.stringify(menu, null, 2) + "\n"),
        sha,
        branch: BRANCH
      })
    });
    if (res.status === 409 || res.status === 422) {
      setSaveStatus("The menu was changed somewhere else since you opened it. Copy your changes, then reload this page.", "error");
      btn.disabled = false;
      return;
    }
    if (res.status === 401) { setSaveStatus("Your sign-in has expired. Sign out and sign in again.", "error"); btn.disabled = false; return; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    sha = (await res.json()).content.sha;
    setDirty(false);
    setSaveStatus("Saved! Your website will show the new menu in about a minute.", "success");
  } catch (err) {
    console.error(err);
    setSaveStatus("Couldn't save. Check your internet connection and try again.", "error");
    btn.disabled = false;
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

// Editor --------------------------------------------------------------------
function changed() { setDirty(true); }

function field(label, input) {
  const wrap = el("label", "admin-field");
  wrap.appendChild(el("span", null, label));
  wrap.appendChild(input);
  return wrap;
}

function textInput(obj, key, placeholder, maxLength) {
  const input = el("input");
  input.value = obj[key] || "";
  input.placeholder = placeholder || "";
  if (maxLength) input.maxLength = maxLength;
  input.addEventListener("input", () => { obj[key] = input.value; changed(); });
  return input;
}

function moveButtons(list, index, label) {
  const up = el("button", "icon-btn", "↑");
  const down = el("button", "icon-btn", "↓");
  up.type = down.type = "button";
  up.setAttribute("aria-label", "Move " + label + " up");
  down.setAttribute("aria-label", "Move " + label + " down");
  up.disabled = index === 0;
  down.disabled = index === list.length - 1;
  up.addEventListener("click", () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; changed(); render(); });
  down.addEventListener("click", () => { [list[index + 1], list[index]] = [list[index], list[index + 1]]; changed(); render(); });
  return [up, down];
}

function itemRow(cat, item, i) {
  const row = el("li", "admin-item" + (item.available === false ? " sold-out" : ""));

  const price = el("input");
  price.type = "number";
  price.min = "0";
  price.step = "50";
  price.inputMode = "numeric";
  price.value = item.price;
  price.addEventListener("input", () => { item.price = price.value === "" ? NaN : Number(price.value); changed(); });

  const top = el("div", "admin-row");
  const name = field("Dish name", textInput(item, "name", "e.g. Jollof Rice", 80));
  name.classList.add("grow");
  const priceField = field("Price (" + (menu.currency || "₦") + ")", price);
  priceField.classList.add("price-field");
  top.append(name, priceField);

  const desc = field("Description", textInput(item, "description", "What's in it?", 200));

  const opts = el("div", "admin-opts");
  const avail = el("label", "admin-check");
  const availBox = el("input");
  availBox.type = "checkbox";
  availBox.checked = item.available !== false;
  availBox.addEventListener("change", () => {
    item.available = availBox.checked;
    row.classList.toggle("sold-out", !availBox.checked);
    changed();
  });
  avail.append(availBox, " Available (untick = sold out)");
  opts.appendChild(avail);
  TAGS.forEach((tag) => {
    const lab = el("label", "admin-check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = (item.tags || []).includes(tag);
    box.addEventListener("change", () => {
      const tags = new Set(item.tags || []);
      if (box.checked) tags.add(tag); else tags.delete(tag);
      item.tags = TAGS.filter((t) => tags.has(t));
      changed();
    });
    lab.append(box, " " + tag);
    opts.appendChild(lab);
  });

  const actions = el("div", "admin-actions");
  const del = el("button", "link-btn danger", "Delete dish");
  del.type = "button";
  del.addEventListener("click", () => {
    if (!confirm("Delete \"" + (item.name || "this dish") + "\"?")) return;
    cat.items.splice(i, 1); changed(); render();
  });
  actions.append(...moveButtons(cat.items, i, item.name || "dish"), del);

  row.append(top, desc, opts, actions);
  return row;
}

function render() {
  const root = $("categories");
  root.replaceChildren();
  menu.categories.forEach((cat, ci) => {
    cat.items = cat.items || [];
    const card = el("section", "wa-card admin-cat");

    const head = el("div", "admin-row");
    const catName = field("Section name", textInput(cat, "name", "e.g. Soups & Swallow", 60));
    catName.classList.add("grow", "cat-name");
    head.appendChild(catName);
    card.appendChild(head);
    card.appendChild(field("Note under this section (optional)", textInput(cat, "note", "e.g. Every soup comes with one swallow", 200)));

    const list = el("ul", "admin-items");
    cat.items.forEach((item, i) => list.appendChild(itemRow(cat, item, i)));
    card.appendChild(list);

    const add = el("button", "btn btn-small btn-outline", "+ Add dish");
    add.type = "button";
    add.addEventListener("click", () => {
      cat.items.push({ name: "", description: "", price: 0, tags: [], available: true });
      changed(); render();
      const inputs = card.ownerDocument.querySelectorAll(".admin-cat")[ci].querySelectorAll(".admin-item");
      inputs[inputs.length - 1].querySelector("input").focus();
    });

    const catActions = el("div", "admin-actions");
    const delCat = el("button", "link-btn danger", "Delete section");
    delCat.type = "button";
    delCat.addEventListener("click", () => {
      if (!confirm("Delete the whole \"" + (cat.name || "section") + "\" section and its " + cat.items.length + " dishes?")) return;
      menu.categories.splice(ci, 1); changed(); render();
    });
    catActions.append(add, ...moveButtons(menu.categories, ci, cat.name || "section"), delCat);
    card.appendChild(catActions);
    root.appendChild(card);
  });
}

$("add-category").addEventListener("click", () => {
  menu.categories.push({ name: "", items: [] });
  changed(); render();
  const cats = document.querySelectorAll(".admin-cat");
  cats[cats.length - 1].querySelector("input").focus();
});

// Start -----------------------------------------------------------------------
let saved = null;
try { saved = localStorage.getItem(TOKEN_KEY); } catch (_) { /* storage unavailable */ }
if (saved) signIn(saved, true);
else show("login");
