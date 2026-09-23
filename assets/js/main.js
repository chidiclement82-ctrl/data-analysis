/* Ogarider — site behaviour */
(function () {
  "use strict";

  // Header background on scroll -----------------------------------------
  var header = document.querySelector(".site-header");
  function onScroll() { header.classList.toggle("scrolled", window.scrollY > 40); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile navigation ---------------------------------------------------
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  function setNav(open) {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  }
  toggle.addEventListener("click", function () {
    setNav(toggle.getAttribute("aria-expanded") !== "true");
  });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) setNav(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setNav(false); });

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

  function renderMenu(menu) {
    var restaurants = restaurantsOf(menu).filter(function (r) { return (r.categories || []).length; });
    var picker = document.getElementById("menu-restaurants");
    clear(picker);
    picker.hidden = restaurants.length < 2;
    restaurants.forEach(function (r, i) {
      var btn = el("button", "restaurant-card");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      if (r.image) {
        var img = el("img"); img.src = r.image; img.alt = ""; img.loading = "lazy";
        btn.appendChild(img);
      } else {
        btn.appendChild(el("span", "restaurant-card-ph", (r.name || "?").charAt(0)));
      }
      btn.appendChild(el("span", "restaurant-card-name", r.name || "Restaurant"));
      btn.addEventListener("click", function () { showRestaurant(menu, restaurants, i); });
      picker.appendChild(btn);
    });
    showRestaurant(menu, restaurants, 0);
  }

  function showRestaurant(menu, restaurants, index) {
    var r = restaurants[index];
    Array.prototype.forEach.call(document.querySelectorAll(".restaurant-card"), function (c, i) {
      c.setAttribute("aria-pressed", String(i === index));
    });
    var info = document.getElementById("restaurant-info");
    clear(info);
    if (r && (r.name || r.description || r.image)) {
      if (r.image) { var img = el("img", "restaurant-photo"); img.src = r.image; img.alt = r.name || ""; info.appendChild(img); }
      var text = el("div");
      if (r.name) text.appendChild(el("h3", null, r.name));
      if (r.description) text.appendChild(el("p", null, r.description));
      info.appendChild(text);
    }
    info.hidden = !info.childNodes.length;
    renderCategories(menu, r ? r.categories : [], index);
  }

  function renderCategories(menu, categories, rIndex) {
    var tabList = document.getElementById("menu-tabs");
    var panels = document.getElementById("menu-panels");
    var cur = menu.currency || "₦";
    clear(tabList);
    clear(panels);
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
      (cat.items || []).forEach(function (item) {
        var li = el("li", (item.available === false ? "sold-out " : "") + (item.image ? "has-img" : ""));
        if (item.image) {
          var img = el("img", "dish-photo"); img.src = item.image; img.alt = item.name || ""; img.loading = "lazy";
          li.appendChild(img);
        }
        var body = el("div", "dish-body");
        var head = el("div", "item-head");
        head.appendChild(el("h3", null, item.name));
        head.appendChild(el("span", "price", item.available === false
          ? "Sold out" : cur + Number(item.price || 0).toLocaleString("en-NG")));
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

  // Homepage photo (set on the admin page). Shown once it has loaded, so the
  // top of the page never flashes an empty background.
  function showHeroPhoto(menu) {
    var src = menu.site && menu.site.image;
    if (!src) return;
    var hero = document.querySelector(".hero");
    var img = new Image();
    img.onload = function () {
      // Use the full address: a relative url() inside a CSS variable would be
      // resolved against the stylesheet's folder, not the page.
      hero.style.setProperty("--hero-photo", 'url("' + img.src + '")');
      hero.classList.add("has-photo");
    };
    img.src = src;
  }

  // "Our kitchen" photo in the Our Story section (set on the admin page).
  function showKitchenPhoto(menu) {
    var src = menu.site && menu.site.kitchenImage;
    if (!src) return;
    var panel = document.getElementById("kitchen-photo");
    var img = new Image();
    img.alt = "Our kitchen";
    img.onload = function () {
      panel.classList.remove("art-fire");
      panel.classList.add("has-photo");
      panel.removeAttribute("role");
      panel.removeAttribute("aria-label");
      panel.insertBefore(img, panel.firstChild);
    };
    img.src = src;
  }

  // The timestamp skips the browser/CDN cache so price changes show right away.
  // XMLHttpRequest rather than fetch() so older phone browsers load it too.
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "menu.json?v=" + Date.now());
  xhr.onload = function () {
    try {
      if (xhr.status !== 200) throw new Error("HTTP " + xhr.status);
      var menu = JSON.parse(xhr.responseText);
      showHeroPhoto(menu); showKitchenPhoto(menu); renderMenu(menu);
    } catch (err) { menuFailed(err); }
  };
  xhr.onerror = menuFailed;
  xhr.send();
  function menuFailed(err) {
    if (window.console) console.error(err);
    clear(document.getElementById("menu-panels"),
      el("p", "menu-note", "Sorry, the menu couldn't load. Please refresh the page."));
  }

  // Helpers ---------------------------------------------------------------
  function toMinutes(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  // Closing times past midnight (e.g. "01:00") count as the next day.
  function closeMinutes(hours) {
    var open = toMinutes(hours[0]), close = toMinutes(hours[1]);
    return close <= open ? close + 24 * 60 : close;
  }
  function formatTime(mins) {
    var h = Math.floor(mins / 60) % 24, m = mins % 60;
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 || 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + suffix;
  }


  // Opening hours, read from the table in index.html -----------------------
  // HOURS[day] = [open, close] in "HH:MM", or null when closed (0 = Sunday).
  var HOURS = {};
  Array.prototype.forEach.call(document.querySelectorAll(".hours tr[data-day]"), function (row) {
    var day = +row.dataset.day;
    var cell = row.querySelector("td");
    if (row.hasAttribute("data-closed") || !row.dataset.open || !row.dataset.close) {
      HOURS[day] = null;
      cell.textContent = "Closed";
    } else {
      HOURS[day] = [row.dataset.open, row.dataset.close];
      cell.textContent = formatTime(toMinutes(row.dataset.open)) + " – " + formatTime(toMinutes(row.dataset.close));
    }
  });

  // Open-now badge + highlight today ------------------------------------
  var now = new Date();
  var today = now.getDay();
  var todayRow = document.querySelector('.hours tr[data-day="' + today + '"]');
  if (todayRow) todayRow.classList.add("today");

  var badge = document.getElementById("open-now");
  var hoursToday = HOURS[today];
  var nowMins = now.getHours() * 60 + now.getMinutes();
  var yesterday = HOURS[(today + 6) % 7];
  var open = (!!hoursToday && nowMins >= toMinutes(hoursToday[0]) && nowMins < closeMinutes(hoursToday)) ||
    // still open from a late night that started yesterday
    (!!yesterday && closeMinutes(yesterday) > 24 * 60 && nowMins < closeMinutes(yesterday) - 24 * 60);
  badge.textContent = open ? "Open now" : "Closed now";
  badge.classList.add(open ? "is-open" : "is-closed");

  // Footer year -----------------------------------------------------------
  document.getElementById("year").textContent = now.getFullYear();

  // Reveal-on-scroll ------------------------------------------------------
  if ("IntersectionObserver" in window) {
    var els = document.querySelectorAll(".section-head, .split > *, .card, .quote-grid figure");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }
})();
