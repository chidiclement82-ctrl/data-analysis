/* Food Is Ready — site behaviour */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // SETTINGS — the only things you normally need to change in this file.
  // ---------------------------------------------------------------------
  // WhatsApp number that receives booking requests, with country code.
  // The guest's WhatsApp opens with the booking written out; they press send.
  var BOOKING_WHATSAPP = "+234 705 994 6531";
  // Optional: paste a Formspree (formspree.io) form URL here, e.g.
  // "https://formspree.io/f/abcdwxyz", to receive bookings by email instead.
  var FORM_ENDPOINT = "";
  // Opening hours are read from the hours table in index.html.
  var LAST_SEATING_MINUTES_BEFORE_CLOSE = 90;
  var SLOT_MINUTES = 30;

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
  var TAG_CLASS = { Spicy: "tag tag-spicy", Popular: "tag tag-popular" };

  function renderMenu(menu) {
    var tabList = document.getElementById("menu-tabs");
    var panels = document.getElementById("menu-panels");
    var cur = menu.currency || "₦";
    tabList.replaceChildren();
    panels.replaceChildren();
    (menu.categories || []).forEach(function (cat, i) {
      var id = "menu-" + i;
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
        var li = el("li", item.available === false ? "sold-out" : null);
        var head = el("div", "item-head");
        head.appendChild(el("h3", null, item.name));
        head.appendChild(el("span", "price", item.available === false
          ? "Sold out" : cur + Number(item.price || 0).toLocaleString("en-NG")));
        li.appendChild(head);
        if (item.description) li.appendChild(el("p", null, item.description));
        if (item.tags && item.tags.length) {
          var tags = el("span", "tags");
          item.tags.forEach(function (t) { tags.appendChild(el("span", TAG_CLASS[t] || "tag", t)); });
          li.appendChild(tags);
        }
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
  fetch("menu.json?v=" + Date.now())
    .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
    .then(renderMenu)
    .catch(function (err) {
      console.error(err);
      document.getElementById("menu-panels").replaceChildren(
        el("p", "menu-note", "Sorry, the menu couldn't load. Please refresh the page."));
    });

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
  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

  // Reservation form ----------------------------------------------------
  var form = document.getElementById("reserve-form");
  var dateInput = form.elements.date;
  var timeSelect = form.elements.time;
  var status = form.querySelector(".form-status");

  var maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 60);
  dateInput.min = isoDate(now);
  dateInput.max = isoDate(maxDate);

  function fillTimes() {
    timeSelect.innerHTML = "";
    var placeholder = new Option("Choose…", "");
    timeSelect.add(placeholder);
    if (!dateInput.value) return;

    var day = new Date(dateInput.value + "T12:00").getDay();
    var hours = HOURS[day];
    if (!hours) {
      placeholder.text = "Closed this day";
      timeSelect.disabled = true;
      return;
    }
    timeSelect.disabled = false;
    var isToday = dateInput.value === isoDate(new Date());
    var earliest = isToday ? new Date().getHours() * 60 + new Date().getMinutes() + 60 : 0;
    var last = closeMinutes(hours) - LAST_SEATING_MINUTES_BEFORE_CLOSE;
    var count = 0;
    for (var t = toMinutes(hours[0]); t <= last; t += SLOT_MINUTES) {
      if (t < earliest) continue;
      timeSelect.add(new Option(formatTime(t), formatTime(t)));
      count++;
    }
    if (!count) {
      placeholder.text = "No times left today";
      timeSelect.disabled = true;
    }
  }
  dateInput.addEventListener("change", fillTimes);

  function setStatus(msg, type) {
    status.textContent = msg;
    status.className = "form-status" + (type ? " " + type : "");
  }

  form.addEventListener("input", function (e) {
    if (e.target.getAttribute("aria-invalid") === "true" && e.target.checkValidity()) {
      e.target.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var firstInvalid = null;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.willValidate) return;
      var ok = el.checkValidity() && !(el.required && !String(el.value).trim());
      if (ok) el.removeAttribute("aria-invalid");
      else { el.setAttribute("aria-invalid", "true"); if (!firstInvalid) firstInvalid = el; }
    });
    if (timeSelect.disabled) {
      setStatus("We're closed or fully booked for that day — please choose another date.", "error");
      dateInput.focus();
      return;
    }
    if (firstInvalid) {
      setStatus("Please fill in the highlighted fields.", "error");
      firstInvalid.focus();
      return;
    }

    var d = form.elements;
    var prettyDate = new Date(d.date.value + "T12:00").toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
    var subject = "Table request: " + d.guests.value + " guests, " + prettyDate + " at " + d.time.value;
    var body = [
      "Name: " + d.name.value.trim(),
      "Phone: " + d.phone.value.trim(),
      "Email: " + d.email.value.trim(),
      "Date: " + prettyDate,
      "Time: " + d.time.value,
      "Guests: " + d.guests.value,
      "",
      "Notes: " + (d.notes.value.trim() || "—")
    ].join("\n");

    var firstName = d.name.value.trim().split(" ")[0];

    if (FORM_ENDPOINT) {
      if (d._gotcha.value) return; // a bot filled the hidden field
      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      setStatus("Sending your request…");
      var data = new FormData(form);
      data.append("_subject", subject);
      fetch(FORM_ENDPOINT, { method: "POST", body: data, headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          form.reset();
          fillTimes();
          setStatus("Thanks, " + firstName + "! We've got your request and will confirm shortly.", "success");
        })
        .catch(function () {
          setStatus("Sorry, something went wrong. Please call us to book.", "error");
        })
        .then(function () { button.disabled = false; });
      return;
    }

    // No form service set up: open WhatsApp with the request written out.
    var url = "https://wa.me/" + BOOKING_WHATSAPP.replace(/\D/g, "") +
      "?text=" + encodeURIComponent(subject + "\n\n" + body);
    var win = window.open(url, "_blank");
    if (win) win.opener = null;
    else window.location.href = url; // pop-up blocked: open in this tab

    setStatus("Thanks, " + firstName + "! WhatsApp is opening with your booking request. Just press send, and we'll confirm shortly.", "success");
  });

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
