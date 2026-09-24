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
let current = 0;   // index of the restaurant being edited
const previews = new Map(); // uploaded photo path -> local preview URL (until the site republishes)

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
      // Keep a token from a sign-in link so "Sign in" can simply be tapped again.
      if (err.message !== "bad-token" && err.message !== "no-access") loginForm.elements.token.value = candidate;
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
  // Older menu.json files had sections at the top level: wrap them in one restaurant.
  if (!menu.restaurants) {
    menu.restaurants = [{ name: "Ogarider Kitchen", description: "", image: "", categories: menu.categories || [] }];
    delete menu.categories;
  }
  menu.site = Object.assign({ image: "", kitchenImage: "" }, menu.site);
  current = Math.min(current, menu.restaurants.length - 1);
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
  for (const r of menu.restaurants) {
    if (!(r.name || "").trim()) return "Every restaurant needs a name.";
    for (const cat of r.categories || []) {
    if (!(cat.name || "").trim()) return "Every menu section in \"" + r.name + "\" needs a name.";
    for (const item of cat.items || []) {
      if (!(item.name || "").trim()) return "Every dish in \"" + cat.name + "\" needs a name.";
      if (!(item.price >= 0)) return "\"" + item.name + "\" needs a price (numbers only, e.g. 6500).";
    }
    }
  }
  if (uploading) return "Wait for the photo to finish uploading.";
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

// Photos --------------------------------------------------------------------
// Photos are shrunk in the browser (max 900px, JPEG) and uploaded straight into
// assets/images/menu/ in the repository; menu.json stores the path.
let uploading = 0;

function slug(text) {
  return (text || "photo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photo";
}

async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  return blob;
}

async function uploadPhoto(file, name) {
  const blob = await shrink(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const path = "assets/images/menu/" + slug(name) + "-" + Date.now() + ".jpg";
  const res = await gh("/contents/" + path, {
    method: "PUT",
    body: JSON.stringify({ message: "Add photo for " + (name || "menu"), content: btoa(bin), branch: BRANCH })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  previews.set(path, URL.createObjectURL(blob));
  return path;
}

function photoField(obj, label, nameOf, key = "image") {
  const wrap = el("div", "admin-photo");
  const preview = el("div", "admin-photo-preview");
  const status = el("span", "admin-photo-status");
  const input = el("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  const pick = el("button", "btn btn-small btn-outline");
  pick.type = "button";
  const remove = el("button", "link-btn danger", "Remove photo");
  remove.type = "button";

  function paint() {
    preview.replaceChildren();
    if (obj[key]) {
      const img = el("img");
      img.src = previews.get(obj[key]) || obj[key];
      img.alt = "";
      preview.appendChild(img);
    } else {
      preview.appendChild(el("span", null, "No photo"));
    }
    pick.textContent = obj[key] ? "Change photo" : "+ Add photo";
    remove.hidden = !obj[key];
  }

  pick.addEventListener("click", () => input.click());
  remove.addEventListener("click", () => { obj[key] = ""; changed(); paint(); });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { status.textContent = "Please choose a photo."; return; }
    uploading++;
    pick.disabled = true;
    status.textContent = "Uploading…";
    try {
      obj[key] = await uploadPhoto(file, nameOf());
      status.textContent = "Photo added. Tap Save & publish to show it.";
      changed();
    } catch (err) {
      console.error(err);
      status.textContent = "Couldn't upload that photo. Check your connection and try again.";
    } finally {
      uploading--;
      pick.disabled = false;
      paint();
    }
  });

  const controls = el("div", "admin-photo-controls");
  controls.append(el("span", "admin-photo-label", label), pick, remove, status);
  wrap.append(preview, controls, input);
  paint();
  return wrap;
}

// Food photos that slide across the top of a restaurant's menu (up to 5).
const GALLERY_MAX = 5;
function galleryField(r) {
  if (!Array.isArray(r.gallery)) r.gallery = [];
  const wrap = el("div", "admin-gallery");
  const label = el("span", "admin-photo-label");
  const strip = el("div", "admin-gallery-strip");
  const status = el("span", "admin-photo-status");
  const input = el("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.hidden = true;
  const pick = el("button", "btn btn-small btn-outline", "+ Add food photos");
  pick.type = "button";

  function paint() {
    label.textContent = "Food photos (" + r.gallery.length + " of " + GALLERY_MAX + "). They slide across the top of this restaurant's menu.";
    strip.replaceChildren();
    r.gallery.forEach((path, i) => {
      const cell = el("div", "admin-gallery-cell");
      const img = el("img");
      img.src = previews.get(path) || path;
      img.alt = "";
      const del = el("button", "admin-gallery-del", "×");
      del.type = "button";
      del.setAttribute("aria-label", "Remove food photo " + (i + 1));
      del.addEventListener("click", () => { r.gallery.splice(i, 1); changed(); paint(); });
      cell.append(img, del);
      strip.appendChild(cell);
    });
    pick.hidden = r.gallery.length >= GALLERY_MAX;
  }

  pick.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const files = Array.from(input.files).filter((f) => f.type.startsWith("image/"))
      .slice(0, GALLERY_MAX - r.gallery.length);
    input.value = "";
    if (!files.length) return;
    uploading++;
    pick.disabled = true;
    let failed = 0;
    // One at a time: GitHub rejects several uploads to the same branch at once.
    for (let i = 0; i < files.length; i++) {
      status.textContent = "Uploading photo " + (i + 1) + " of " + files.length + "…";
      try {
        r.gallery.push(await uploadPhoto(files[i], (r.name || "restaurant") + " food"));
        changed();
        paint();
      } catch (err) {
        console.error(err);
        failed++;
      }
    }
    uploading--;
    pick.disabled = false;
    status.textContent = failed
      ? "Couldn't upload " + failed + " photo" + (failed > 1 ? "s" : "") + ". Check your connection and try again."
      : "Photos added. Tap Save & publish to show them.";
    paint();
  });

  wrap.append(label, strip, pick, status, input);
  paint();
  return wrap;
}

// Editor --------------------------------------------------------------------
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
  const name = field("Food name", textInput(item, "name", "e.g. Jollof Rice", 80));
  name.classList.add("grow");
  const priceField = field("Price (" + (menu.currency || "₦") + ")", price);
  priceField.classList.add("price-field");
  top.append(name, priceField);

  const desc = field("Description", textInput(item, "description", "What's in it?", 200));
  const photo = photoField(item, "Food photo", () => item.name);

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
  const del = el("button", "link-btn danger", "Delete food");
  del.type = "button";
  del.addEventListener("click", () => {
    if (!confirm("Delete \"" + (item.name || "this food") + "\"?")) return;
    cat.items.splice(i, 1); changed(); render();
  });
  actions.append(...moveButtons(cat.items, i, item.name || "food"), del);

  row.append(top, desc, photo, opts, actions);
  return row;
}

function restaurantBar() {
  const bar = $("restaurant-bar");
  bar.replaceChildren();

  const pickRow = el("div", "admin-row");
  const select = el("select", "admin-select");
  menu.restaurants.forEach((r, i) => select.add(new Option(r.name || "New restaurant", String(i))));
  select.value = String(current);
  select.addEventListener("change", () => { current = Number(select.value); render(); });
  const pickField = field("Restaurant you're editing", select);
  pickField.classList.add("grow");
  const add = el("button", "btn btn-small", "+ Add restaurant");
  add.type = "button";
  add.addEventListener("click", () => {
    menu.restaurants.push({ name: "", description: "", image: "", gallery: [], categories: [{ name: "Menu", items: [] }] });
    current = menu.restaurants.length - 1;
    changed(); render();
    bar.querySelector(".restaurant-name input").focus();
  });
  pickRow.append(pickField, add);
  bar.appendChild(pickRow);

  const r = menu.restaurants[current];
  if (!r) return;
  const card = el("section", "wa-card admin-restaurant");
  const nameField = field("Restaurant name", textInput(r, "name", "e.g. Mama Put Kitchen", 60));
  nameField.classList.add("restaurant-name", "cat-name");
  nameField.querySelector("input").addEventListener("input", () => {
    select.options[current].text = r.name || "New restaurant";
  });
  card.appendChild(nameField);
  card.appendChild(field("Short description (optional)", textInput(r, "description", "e.g. Home-style soups and swallow", 160)));
  card.appendChild(photoField(r, "Restaurant photo or logo", () => r.name));
  card.appendChild(galleryField(r));

  const actions = el("div", "admin-actions");
  const del = el("button", "link-btn danger", "Delete restaurant");
  del.type = "button";
  del.disabled = menu.restaurants.length < 2;
  del.title = del.disabled ? "You need at least one restaurant" : "";
  del.addEventListener("click", () => {
    const count = (r.categories || []).reduce((n, c) => n + (c.items || []).length, 0);
    if (!confirm("Delete \"" + (r.name || "this restaurant") + "\" and its " + count + " foods?")) return;
    menu.restaurants.splice(current, 1);
    current = Math.max(0, current - 1);
    changed(); render();
  });
  // Reorder restaurants, keeping the moved one selected.
  const list = menu.restaurants;
  const move = (delta) => {
    const to = current + delta;
    [list[current], list[to]] = [list[to], list[current]];
    current = to;
    changed(); render();
  };
  const up = el("button", "icon-btn", "↑");
  const down = el("button", "icon-btn", "↓");
  up.type = down.type = "button";
  up.setAttribute("aria-label", "Move restaurant up");
  down.setAttribute("aria-label", "Move restaurant down");
  up.disabled = current === 0;
  down.disabled = current === list.length - 1;
  up.addEventListener("click", () => move(-1));
  down.addEventListener("click", () => move(1));
  actions.append(up, down, del);
  card.appendChild(actions);
  bar.appendChild(card);
}

function siteSettings() {
  const box = $("site-settings");
  box.replaceChildren();
  const card = el("section", "wa-card admin-site");
  card.appendChild(el("h2", null, "Homepage photos"));
  card.appendChild(el("p", "muted", "The top photo sits behind \"FOOD IS READY\"; a wide photo works best. The kitchen photo shows next to \"Our Story\"."));
  card.appendChild(photoField(menu.site, "Top of the homepage", () => "homepage"));
  card.appendChild(photoField(menu.site, "\"Our kitchen\" photo", () => "kitchen", "kitchenImage"));
  box.appendChild(card);
}

function render() {
  siteSettings();
  restaurantBar();
  const r = menu.restaurants[current];
  r.categories = r.categories || [];
  $("sections-title").textContent = "Foods at " + (r.name || "this restaurant");
  const root = $("categories");
  root.replaceChildren();
  r.categories.forEach((cat, ci) => {
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

    const add = el("button", "btn btn-small btn-outline", "+ Add food");
    add.type = "button";
    add.addEventListener("click", () => {
      cat.items.push({ name: "", description: "", price: 0, tags: [], available: true, image: "" });
      changed(); render();
      const items = document.querySelectorAll(".admin-cat")[ci].querySelectorAll(".admin-item");
      items[items.length - 1].querySelector("input").focus();
    });

    const catActions = el("div", "admin-actions");
    const delCat = el("button", "link-btn danger", "Delete section");
    delCat.type = "button";
    delCat.addEventListener("click", () => {
      if (!confirm("Delete the whole \"" + (cat.name || "section") + "\" section and its " + cat.items.length + " foods?")) return;
      r.categories.splice(ci, 1); changed(); render();
    });
    catActions.append(add, ...moveButtons(r.categories, ci, cat.name || "section"), delCat);
    card.appendChild(catActions);
    root.appendChild(card);
  });
}

$("add-category").addEventListener("click", () => {
  menu.restaurants[current].categories.push({ name: "", items: [] });
  changed(); render();
  const cats = document.querySelectorAll(".admin-cat");
  cats[cats.length - 1].querySelector("input").focus();
});

// Sign in on another phone -----------------------------------------------------
// The link carries the token after "#", which browsers never send to a server.
function signInLink() {
  return location.origin + location.pathname + "#signin=" + encodeURIComponent(token);
}
function phoneMessage(text, type) { $("phone-status").textContent = text; $("phone-status").className = "form-status " + (type || ""); }

$("phone-signin").addEventListener("toggle", () => {
  const box = $("phone-qr");
  if (!$("phone-signin").open) { box.replaceChildren(); phoneMessage(""); return; }
  if (!token || typeof window.qrcode !== "function") return;
  const qr = window.qrcode(0, "M");
  qr.addData(signInLink());
  qr.make();
  const img = new Image();
  img.src = qr.createDataURL(6, 4);
  img.alt = "Sign-in code for the admin page";
  box.replaceChildren(img);
});

$("copy-signin").addEventListener("click", async () => {
  const link = signInLink();
  try {
    await navigator.clipboard.writeText(link);
    phoneMessage("Link copied. Open it on your phone, then delete the message you sent it in.", "success");
  } catch (_) {
    prompt("Copy this link and open it on your phone:", link);
  }
});

// Start -----------------------------------------------------------------------
let saved = null;
// Opened from a sign-in link: take the token and remove it from the address bar.
const fromLink = /^#signin=(.+)$/.exec(location.hash);
if (fromLink) {
  history.replaceState(null, "", location.pathname + location.search);
  saved = decodeURIComponent(fromLink[1]);
} else {
  try { saved = localStorage.getItem(TOKEN_KEY); } catch (_) { /* storage unavailable */ }
}
if (saved) signIn(saved, !fromLink);
else show("login");
