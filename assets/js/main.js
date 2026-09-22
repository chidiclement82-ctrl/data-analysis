/* Ember & Vine — site behaviour */
(function () {
  "use strict";

  // Restaurant settings — keep in sync with the hours table in index.html.
  // Day numbers follow JavaScript: 0 = Sunday … 6 = Saturday. Times are 24h "HH:MM".
  var HOURS = {
    0: ["11:30", "21:00"],
    1: null,
    2: ["17:00", "22:00"],
    3: ["17:00", "22:00"],
    4: ["17:00", "22:00"],
    5: ["17:00", "23:00"],
    6: ["17:00", "23:00"]
  };
  var BOOKING_EMAIL = "hello@emberandvine.com";
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

  // Menu tabs (with arrow-key support) ----------------------------------
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
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

  // Helpers ---------------------------------------------------------------
  function toMinutes(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  function formatTime(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 || 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + suffix;
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Open-now badge + highlight today ------------------------------------
  var now = new Date();
  var today = now.getDay();
  var todayRow = document.querySelector('.hours tr[data-day="' + today + '"]');
  if (todayRow) todayRow.classList.add("today");

  var badge = document.getElementById("open-now");
  var hoursToday = HOURS[today];
  var nowMins = now.getHours() * 60 + now.getMinutes();
  var open = !!hoursToday && nowMins >= toMinutes(hoursToday[0]) && nowMins < toMinutes(hoursToday[1]);
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
    var last = toMinutes(hours[1]) - LAST_SEATING_MINUTES_BEFORE_CLOSE;
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

    // Opens the guest's email app with the request filled in.
    // To receive bookings without email apps, see "Reservations" in README.md.
    window.location.href = "mailto:" + BOOKING_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    setStatus("Thanks, " + d.name.value.trim().split(" ")[0] + "! Your email app should open with your request. Just press send, and we'll confirm shortly.", "success");
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
