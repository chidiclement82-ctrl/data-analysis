/* Order on WhatsApp (order.html) */

// ---------------------------------------------------------------------------
// EDIT: the WhatsApp number that receives orders, with country code,
// e.g. "+234 801 234 5678". Spaces and dashes are fine.
// While it's empty, the page shows "Online ordering is coming soon".
// ---------------------------------------------------------------------------
var WHATSAPP_NUMBER = "+234 705 994 6531";
var RESTAURANT_NAME = "Ogarider";

// Written in plain, older-style JavaScript so the page also works on older
// phones and light browsers (Opera Mini, UC Browser, old Android/iPhone).
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  var digits = WHATSAPP_NUMBER.replace(/\D/g, "");
  var form = $("order-form");
  var cart = {}; // key -> { restaurant, name, price, qty }
  var cartOrder = []; // keys in the order they were first added

  var currency = "₦";
  function money(n) {
    // Thousands separators by hand: toLocaleString is patchy on old phones.
    return currency + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) parent.appendChild(arguments[i]);
  }

  function clear(node, child) {
    while (node.firstChild) node.removeChild(node.firstChild);
    if (child) node.appendChild(child);
  }

  function waLink(text) {
    return "https://wa.me/" + digits + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  if (digits.length < 8) {
    $("state-unavailable").hidden = false;
    return;
  }
  form.hidden = false;
  $("wa-chat-link").href = waLink("Hi " + RESTAURANT_NAME + "! I have a question:");
  loadMenu(renderMenu, function (err) {
    if (window.console) console.error(err);
    clear($("menu-picker"), el("p", "muted", "Couldn't load the menu. Write what you'd like in the note below instead."));
  });

  // Reads the menu from menu.json (edited on admin.html). Sold-out dishes are
  // shown but can't be added. Older files had sections at the top level.
  function loadMenu(done, failed) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "menu.json?v=" + Date.now());
    xhr.onload = function () {
      var restaurants;
      try {
        if (xhr.status !== 200) throw new Error("HTTP " + xhr.status);
        restaurants = parseMenu(JSON.parse(xhr.responseText));
      } catch (err) { failed(err); return; }
      done(restaurants);
    };
    xhr.onerror = failed;
    xhr.send();
  }

  function parseMenu(menu) {
    currency = menu.currency || currency;
    var restaurants = menu.restaurants || [{ name: "", categories: menu.categories || [] }];
    return restaurants.map(function (r) {
      return {
        name: r.name || "",
        image: r.image || "",
        categories: (r.categories || []).map(function (c) {
          return {
            name: c.name,
            items: (c.items || []).filter(function (it) { return it.name; }).map(function (it) {
              return {
                name: it.name, desc: it.description || "", price: Number(it.price) || 0,
                image: it.image || "", soldOut: it.available === false
              };
            })
          };
        }).filter(function (c) { return c.items.length; })
      };
    }).filter(function (r) { return r.categories.length; });
  }

  function renderMenu(restaurants) {
    var picker = $("menu-picker");
    clear(picker);
    if (!restaurants.length) {
      picker.appendChild(el("p", "muted", "Write what you'd like in the note below and we'll confirm on WhatsApp."));
      return;
    }
    var many = restaurants.length > 1;
    restaurants.forEach(function (r) {
      if (many || r.name) {
        var head = el("div", "picker-restaurant");
        if (r.image) { var img = el("img"); img.src = r.image; img.alt = ""; img.loading = "lazy"; head.appendChild(img); }
        head.appendChild(el("h3", null, r.name || "Restaurant"));
        picker.appendChild(head);
      }
      r.categories.forEach(function (section) {
        picker.appendChild(el("h4", "picker-cat", section.name));
        var ul = el("ul", "picker-list");
        section.items.forEach(function (item) { ul.appendChild(pickerItem(r.name, item)); });
        picker.appendChild(ul);
      });
    });
  }

  function pickerItem(restaurant, item) {
    var key = restaurant + "\u0000" + item.name;
    var li = el("li", "picker-item");
    if (item.image) {
      var img = el("img", "picker-photo"); img.src = item.image; img.alt = ""; img.loading = "lazy";
      li.appendChild(img);
    }
    var info = el("div", "picker-info");
    var head = el("p", "picker-name");
    append(head, el("span", null, item.name), el("span", "picker-price", money(item.price)));
    info.appendChild(head);
    if (item.desc) info.appendChild(el("p", "picker-desc", item.desc));
    if (item.soldOut) {
      li.className += " sold-out";
      append(li, info, el("span", "sold-out-label", "Sold out"));
      return li;
    }

    var stepper = el("div", "stepper");
    var minus = el("button", "icon-btn", "−");
    var qty = el("span", "stepper-qty", "0");
    var plus = el("button", "icon-btn", "+");
    minus.type = plus.type = "button";
    minus.setAttribute("aria-label", "Remove one " + item.name);
    plus.setAttribute("aria-label", "Add one " + item.name);
    function change(delta) {
      var next = Math.max(0, Math.min(20, (cart[key] ? cart[key].qty : 0) + delta));
      if (next) {
        if (!cart[key]) cartOrder.push(key);
        cart[key] = { restaurant: restaurant, name: item.name, price: item.price, qty: next };
      } else if (cart[key]) {
        delete cart[key];
        cartOrder.splice(cartOrder.indexOf(key), 1);
      }
      qty.textContent = next;
      li.className = "picker-item" + (next > 0 ? " in-cart" : "");
      updateSummary();
    }
    minus.addEventListener("click", function () { change(-1); });
    plus.addEventListener("click", function () { change(1); });
    append(stepper, minus, qty, plus);
    append(li, info, stepper);
    return li;
  }

  function totals() {
    var items = cartOrder.map(function (k) { return cart[k]; });
    var count = 0, total = 0;
    items.forEach(function (i) { count += i.qty; total += i.qty * i.price; });
    return { items: items, count: count, total: total };
  }

  function updateSummary() {
    var t = totals();
    $("summary").textContent = t.count
      ? t.count + " item" + (t.count > 1 ? "s" : "") + " · " + money(t.total)
      : "No dishes picked yet";
    if (t.count) setStatus("");
  }

  function setStatus(msg, type) {
    var s = $("order-status");
    s.textContent = msg;
    s.className = "form-status" + (type ? " " + type : "");
  }

  // Radio group value, without RadioNodeList.value (missing on old browsers).
  function fulfilment() {
    var checked = form.querySelector('input[name="fulfilment"]:checked');
    return checked ? checked.value : "pickup";
  }

  // Details ------------------------------------------------------------------
  var addressField = form.querySelector(".address-field");
  form.addEventListener("change", function (e) {
    if (e.target.name !== "fulfilment") return;
    var delivery = fulfilment() === "delivery";
    addressField.hidden = !delivery;
    form.elements.address.required = delivery;
  });

  // Clear a field's error highlight (and the message) as soon as it's fixed.
  form.addEventListener("input", function (e) {
    if (e.target.hasAttribute("aria-invalid") && e.target.value.trim()) {
      e.target.removeAttribute("aria-invalid");
      if (!form.querySelector("[aria-invalid]")) setStatus("");
    }
    if (e.target.name === "note" && e.target.value.trim()) setStatus("");
  });

  try {
    var saved = JSON.parse(localStorage.getItem("order-details") || "{}");
    if (saved.name) form.elements.name.value = saved.name;
    if (saved.address) form.elements.address.value = saved.address;
  } catch (_) { /* storage unavailable */ }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = form.elements;
    var t = totals();
    var note = f.note.value.trim();
    var delivery = fulfilment() === "delivery";

    var firstInvalid = null;
    ["name", "address"].forEach(function (n) {
      var bad = f[n].required && !f[n].value.trim();
      if (bad) f[n].setAttribute("aria-invalid", "");
      else f[n].removeAttribute("aria-invalid");
      if (bad && !firstInvalid) firstInvalid = f[n];
    });
    if (!t.count && !note) {
      setStatus("Pick at least one dish, or write your order in the note.", "error");
      return;
    }
    if (firstInvalid) {
      setStatus("Please fill in the highlighted fields.", "error");
      firstInvalid.focus();
      return;
    }

    var lines = ["Hello " + RESTAURANT_NAME + "! I'd like to order:"];
    // Group dishes by restaurant so the kitchen knows where each one comes from.
    var groups = [], byRestaurant = {};
    t.items.forEach(function (i) {
      if (!byRestaurant[i.restaurant]) { byRestaurant[i.restaurant] = []; groups.push(i.restaurant); }
      byRestaurant[i.restaurant].push(i);
    });
    var named = groups.length > 1 || (t.items[0] && t.items[0].restaurant);
    groups.forEach(function (restaurant) {
      lines.push("");
      if (named && restaurant) lines.push("*" + restaurant + "*");
      byRestaurant[restaurant].forEach(function (i) {
        lines.push("• " + i.qty + "× " + i.name + " — " + money(i.qty * i.price));
      });
    });
    if (t.count) lines.push("", "Total: " + money(t.total));
    lines.push("", "Name: " + f.name.value.trim());
    lines.push(delivery ? "Delivery to: " + f.address.value.trim() : "Pickup");
    if (note) lines.push("Note: " + note);

    try {
      localStorage.setItem("order-details", JSON.stringify({ name: f.name.value.trim(), address: f.address.value.trim() }));
    } catch (_) { /* storage unavailable */ }

    var url = waLink(lines.join("\n"));
    var win = window.open(url, "_blank");
    if (win) win.opener = null;
    else window.location.href = url; // pop-up blocked: open in this tab
    setStatus("WhatsApp is opening with your order. Just press send!", "success");
  });
})();
