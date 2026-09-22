/* Ember & Vine — site behaviour */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // SETTINGS — the only things you normally need to change in this file.
  // ---------------------------------------------------------------------
  // Where booking requests go. Guests' email apps open addressed to this.
  var BOOKING_EMAIL = "hello@emberandvine.com";
  // Optional: paste a Formspree (formspree.io) form URL here, e.g.
  // "https://formspree.io/f/abcdwxyz", to receive bookings straight to your
  // inbox without the guest needing an email app. Leave "" to use email.
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

    // No form service set up: open the guest's email app with the request filled in.
    window.location.href = "mailto:" + BOOKING_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    setStatus("Thanks, " + firstName + "! Your email app should open with your request. Just press send, and we'll confirm shortly.", "success");
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
