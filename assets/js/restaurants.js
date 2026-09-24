/* Ogarider — restaurants page (restaurants.html): the list of restaurants and each one's menu */
(function () {
  "use strict";

  // Menu, loaded from menu.json (edited on admin.html) ------------------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  // Empties a node, optionally leaving one child. (replaceChildren() is
  // missing on older phone browsers.)
  function clear(node, child) {
    while (node.firstChild) node.removeChild(node.firstChild);
    if (child) node.appendChild(child);
  }
  var TAG_CLASS = { Spicy: "tag tag-spicy", Popular: "tag tag-popular" };

  // Older menu.json files had sections at the top level; treat that as one restaurant.
  function restaurantsOf(menu) {
    return menu.restaurants || [{ name: "", description: "", image: "", categories: menu.categories || [] }];
  }

  // Web-address name for a restaurant, e.g. "Kilimanjaro Restaurant" -> "kilimanjaro-restaurant".
  // order.js makes the same names, so "Order" links open the same restaurant there.
  function slugs(restaurants) {
    var seen = {};
    return restaurants.map(function (r, i) {
      var slug = (r.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "restaurant-" + (i + 1);
      if (seen[slug]) slug += "-" + (i + 1);
      seen[slug] = true;
      return slug;
    });
  }

  function foodsIn(r) {
    var foods = [];
    (r.categories || []).forEach(function (c) {
      (c.items || []).forEach(function (it) { if (it.name) foods.push(it); });
    });
    return foods;
  }

  function money(menu, n) {
    return (menu.currency || "₦") + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function photoOrLetter(r, className) {
    if (r.image) {
      var img = el("img", className); img.src = r.image; img.alt = ""; img.loading = "lazy";
      return img;
    }
    return el("span", className + " is-letter", (r.name || "?").charAt(0).toUpperCase());
  }

  var MENU = null, RESTAURANTS = [], SLUGS = [];

  // The list of restaurant cards customers scroll through.
  function renderList() {
    var list = document.getElementById("restaurant-list");
    clear(list);
    if (!RESTAURANTS.length) {
      list.appendChild(el("li", "menu-note", "Restaurants are coming soon. Message us on WhatsApp to order."));
      return;
    }
    RESTAURANTS.forEach(function (r, i) {
      var foods = foodsIn(r);
      var li = el("li", "restaurant-tile");
      var a = el("a");
      a.href = "#restaurant=" + SLUGS[i];
      a.appendChild(photoOrLetter(r, "restaurant-tile-img"));
      var body = el("div", "restaurant-tile-body");
      body.appendChild(el("h3", null, r.name || "Restaurant"));
      if (r.description) body.appendChild(el("p", null, r.description));
      var meta = el("div", "restaurant-tile-meta");
      var prices = foods.filter(function (f) { return f.available !== false && Number(f.price) > 0; })
        .map(function (f) { return Number(f.price); });
      meta.appendChild(el("span", null, foods.length
        ? foods.length + (foods.length === 1 ? " food" : " foods") + (prices.length ? " · from " + money(MENU, Math.min.apply(null, prices)) : "")
        : "Menu coming soon"));
      meta.appendChild(el("span", "restaurant-tile-cta", "See menu →"));
      body.appendChild(meta);
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  // Food photos that slide sideways by themselves (added on the admin page).
  // The photos are repeated to fill the width, then the whole strip is doubled
  // and moved left by half its length, so the loop never shows a gap.
  function foodSlider(r) {
    var photos = (r.gallery || []).filter(function (p) { return p; });
    if (!photos.length) return null;
    var slider = el("div", "food-slider");
    var track = el("div", "food-slider-track");
    var half = [];
    while (half.length < 12) half = half.concat(photos);
    half.concat(half).forEach(function (src, i) {
      var img = el("img"); img.src = src; img.alt = i < photos.length ? "Food at " + (r.name || "this restaurant") : "";
      if (i >= photos.length) img.setAttribute("aria-hidden", "true");
      track.appendChild(img);
    });
    if (photos.length > 1) {
      track.className += " is-moving";
      track.style.animationDuration = (half.length * 3) + "s";
    }
    slider.appendChild(track);
    return slider;
  }

  // One restaurant's menu.
  function showRestaurant(index) {
    var r = RESTAURANTS[index];
    var info = document.getElementById("restaurant-info");
    clear(info);
    info.appendChild(photoOrLetter(r, "restaurant-head-img"));
    var text = el("div", "restaurant-head-text");
    text.appendChild(el("h3", null, r.name || "Restaurant"));
    if (r.description) text.appendChild(el("p", null, r.description));
    var slider = foodSlider(r);
    if (slider) text.appendChild(slider);
    info.appendChild(text);
    document.getElementById("restaurant-order-btn").href = "order.html#restaurant=" + SLUGS[index];
    document.getElementById("restaurant-order-btn").textContent = "Order from " + (r.name || "this restaurant");
    var categories = (r.categories || []).filter(function (c) { return (c.items || []).some(function (it) { return it.name; }); });
    renderCategories(MENU, categories, index);
    if (!categories.length) {
      document.getElementById("menu-panels").appendChild(
        el("p", "menu-note", "This restaurant's menu is coming soon. Tap Order to ask us on WhatsApp what's available today."));
    }
  }

  // Which view to show comes from the address: "#restaurant=<name>" opens a
  // restaurant, anything else shows the list. The phone's Back button works too.
  function route(scroll) {
    if (!MENU) return;
    var m = /^#restaurant=(.+)$/.exec(location.hash);
    var index = m ? SLUGS.indexOf(decodeURIComponent(m[1])) : -1;
    var list = document.getElementById("restaurant-list");
    var view = document.getElementById("restaurant-view");
    if (index >= 0) showRestaurant(index);
    list.hidden = index >= 0;
    view.hidden = index < 0;
    if (scroll && index >= 0) view.scrollIntoView();
    else if (scroll && wasOpen) document.getElementById("menu").scrollIntoView();
    wasOpen = index >= 0;
  }
  var wasOpen = false;
  window.addEventListener("hashchange", function () { route(true); });

  function renderMenu(menu) {
    MENU = menu;
    RESTAURANTS = restaurantsOf(menu);
    SLUGS = slugs(RESTAURANTS);
    renderList();
    route(/^#restaurant=/.test(location.hash));
  }

  function renderCategories(menu, categories, rIndex) {
    var tabList = document.getElementById("menu-tabs");
    var panels = document.getElementById("menu-panels");
    clear(tabList);
    clear(panels);
    tabList.hidden = (categories || []).length < 2; // no tabs needed for a single section
    (categories || []).forEach(function (cat, i) {
      var id = "menu-" + rIndex + "-" + i;
      var tab = el("button", null, cat.name);
      tab.setAttribute("role", "tab");
      tab.id = "tab-" + id;
      tab.setAttribute("aria-controls", "panel-" + id);
      tabList.appendChild(tab);

      var panel = el("div", "menu-panel");
      panel.setAttribute("role", "tabpanel");
      panel.id = "panel-" + id;
      panel.setAttribute("aria-labelledby", tab.id);
      var ul = el("ul", "menu-list");
      (cat.items || []).filter(function (item) { return item.name; }).forEach(function (item) {
        var li = el("li", (item.available === false ? "sold-out " : "") + (item.image ? "has-img" : ""));
        if (item.image) {
          var img = el("img", "dish-photo"); img.src = item.image; img.alt = item.name || ""; img.loading = "lazy";
          li.appendChild(img);
        }
        var body = el("div", "dish-body");
        var head = el("div", "item-head");
        head.appendChild(el("h3", null, item.name));
        head.appendChild(el("span", "price", item.available === false
          ? "Sold out" : money(menu, Number(item.price) || 0)));
        body.appendChild(head);
        if (item.description) body.appendChild(el("p", null, item.description));
        if (item.tags && item.tags.length) {
          var tags = el("span", "tags");
          item.tags.forEach(function (t) { tags.appendChild(el("span", TAG_CLASS[t] || "tag", t)); });
          body.appendChild(tags);
        }
        li.appendChild(body);
        ul.appendChild(li);
      });
      panel.appendChild(ul);
      if (cat.note) panel.appendChild(el("p", "menu-note", cat.note));
      panels.appendChild(panel);
    });
    initTabs();
  }

  // Menu tabs (with arrow-key support)
  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#menu-tabs [role="tab"]'));
    function selectTab(tab) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute("aria-selected", String(selected));
        t.tabIndex = selected ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
      });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { selectTab(tab); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") next = tabs[0];
        if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); selectTab(next); next.focus(); }
      });
    });
    if (tabs.length) selectTab(tabs[0]);
  }

  // The timestamp skips the browser/CDN cache so price changes show right away.
  // XMLHttpRequest rather than fetch() so older phone browsers load it too.
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "menu.json?v=" + Date.now());
  xhr.onload = function () {
    try {
      if (xhr.status !== 200) throw new Error("HTTP " + xhr.status);
      var menu = JSON.parse(xhr.responseText);
      renderMenu(menu);
    } catch (err) { menuFailed(err); }
  };
  xhr.onerror = menuFailed;
  xhr.send();
  function menuFailed(err) {
    if (window.console) console.error(err);
    clear(document.getElementById("restaurant-list"),
      el("li", "menu-note", "Sorry, the restaurants couldn't load. Please refresh the page."));
  }

})();
