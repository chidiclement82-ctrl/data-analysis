/* Dashboard rendering. Reads window.DASHBOARD_DATA (see data/data.js). */
(function () {
  "use strict";

  var D = window.DASHBOARD_DATA;
  if (!D) {
    document.body.innerHTML =
      '<div class="wrap"><p style="color:#d03b3b">Could not load data/data.js</p></div>';
    return;
  }

  /* ---------- formatting helpers ---------- */
  function fmt(value, kind) {
    switch (kind) {
      case "currency":
        return value >= 1000
          ? "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 })
          : "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case "percent":
        return value.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
      default:
        return value.toLocaleString("en-US");
    }
  }
  function money(n) {
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  /* ---------- resolve theme colors from CSS variables ---------- */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------- header ---------- */
  document.getElementById("title").textContent = D.meta.title;
  document.getElementById("subtitle").textContent = D.meta.subtitle;
  document.getElementById("updated").textContent = "Last updated " + D.meta.updated;

  /* ---------- KPI tiles ---------- */
  var kpiWrap = document.getElementById("kpis");
  D.kpis.forEach(function (k) {
    var up = k.dir === "up";
    var isGood = k.good;
    var tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML =
      '<p class="label">' + k.label + "</p>" +
      '<div class="value">' + fmt(k.value, k.format) + "</div>" +
      '<span class="delta ' + (isGood ? "good" : "bad") + '">' +
        '<span class="arrow">' + (up ? "▲" : "▼") + "</span>" +
        Math.abs(k.delta).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "% vs prior" +
      "</span>";
    kpiWrap.appendChild(tile);
  });

  /* ---------- Chart.js shared defaults ---------- */
  function applyChartDefaults() {
    Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.color = cssVar("--text-secondary");
    Chart.defaults.font.size = 12;
  }

  var trendChart, catChart;

  function buildCharts() {
    applyChartDefaults();
    var grid = cssVar("--grid");
    var muted = cssVar("--text-muted");
    var s1 = cssVar("--series-1");
    var s2 = cssVar("--series-2");
    var surface = cssVar("--surface-1");

    var commonScales = {
      x: { grid: { display: false }, ticks: { color: muted }, border: { color: cssVar("--baseline") } },
      y: {
        beginAtZero: true,
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: muted,
          callback: function (v) { return "$" + (v / 1000) + "k"; },
        },
      },
    };

    var tooltip = {
      backgroundColor: surface,
      titleColor: cssVar("--text-primary"),
      bodyColor: cssVar("--text-secondary"),
      borderColor: cssVar("--border"),
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
      displayColors: true,
      callbacks: { label: function (c) { return c.dataset.label + ": " + money(c.parsed.y); } },
    };

    /* Revenue trend — two-series line, one shared y-axis (same units) */
    trendChart = new Chart(document.getElementById("trend"), {
      type: "line",
      data: {
        labels: D.months,
        datasets: [
          {
            label: "This year", data: D.revenueThisYear,
            borderColor: s1, backgroundColor: s1,
            borderWidth: 2, tension: 0.3,
            pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2,
          },
          {
            label: "Last year", data: D.revenueLastYear,
            borderColor: s2, backgroundColor: s2,
            borderWidth: 2, borderDash: [5, 4], tension: 0.3,
            pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: commonScales,
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: cssVar("--text-secondary") } },
          tooltip: tooltip,
        },
      },
    });

    /* Revenue by category — single-series bar (one hue, no legend needed) */
    catChart = new Chart(document.getElementById("categories"), {
      type: "bar",
      data: {
        labels: D.categories,
        datasets: [{
          label: "Revenue", data: D.categoryRevenue,
          backgroundColor: s1, borderRadius: 4, borderSkipped: false, maxBarThickness: 44,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: commonScales,
        plugins: { legend: { display: false }, tooltip: tooltip },
      },
    });
  }

  function destroyCharts() {
    if (trendChart) trendChart.destroy();
    if (catChart) catChart.destroy();
  }

  buildCharts();

  /* ---------- table view (accessibility: data is never chart-only) ---------- */
  var tbody = document.getElementById("table-body");
  D.months.forEach(function (m, i) {
    var ty = D.revenueThisYear[i], ly = D.revenueLastYear[i];
    var pct = ly ? ((ty - ly) / ly) * 100 : 0;
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + m + "</td>" +
      "<td>" + money(ty) + "</td>" +
      "<td>" + money(ly) + "</td>" +
      '<td style="color:' + (pct >= 0 ? "var(--good)" : "var(--bad)") + '">' +
        (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%</td>";
    tbody.appendChild(tr);
  });

  /* ---------- theme toggle ---------- */
  var toggle = document.getElementById("theme-toggle");
  function currentTheme() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function setLabel() {
    toggle.textContent = currentTheme() === "dark" ? "☀ Light" : "☾ Dark";
  }
  setLabel();
  toggle.addEventListener("click", function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("dash-theme", next); } catch (e) {}
    setLabel();
    destroyCharts();
    buildCharts();
  });

  /* restore saved theme */
  try {
    var saved = localStorage.getItem("dash-theme");
    if (saved) { document.documentElement.setAttribute("data-theme", saved); setLabel(); destroyCharts(); buildCharts(); }
  } catch (e) {}

  /* re-theme charts if the OS scheme changes and no manual override is set */
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (!document.documentElement.getAttribute("data-theme")) { setLabel(); destroyCharts(); buildCharts(); }
  });
})();
