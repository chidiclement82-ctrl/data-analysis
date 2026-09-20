/*
 * Dashboard data — edit this file to show your own numbers.
 * -----------------------------------------------------------
 * This file assigns one object to `window.DASHBOARD_DATA`.
 * Loading data this way (instead of fetch) means the dashboard
 * also works when you just double-click index.html locally.
 *
 * Swap the sample values below for yours. The shapes are:
 *   kpis[]      -> the stat tiles at the top
 *   months[]    -> x-axis labels for the revenue trend
 *   revenueThisYear[] / revenueLastYear[]  -> the two line series
 *   categories[] / categoryRevenue[]       -> the bar chart
 */
window.DASHBOARD_DATA = {
  meta: {
    title: "Sales Analytics",
    subtitle: "Sample data — replace with your own in data/data.js",
    updated: "2026-09-20",
  },

  // Top stat tiles. `delta` is the % change vs the prior period.
  // `dir` is "up" or "down"; `good` says whether that direction is positive.
  kpis: [
    { label: "Total Revenue",     value: 1284500, format: "currency", delta: 12.4, dir: "up",   good: true  },
    { label: "Orders",            value: 8642,    format: "number",   delta: 8.1,  dir: "up",   good: true  },
    { label: "Avg Order Value",   value: 148.6,   format: "currency", delta: 3.9,  dir: "up",   good: true  },
    { label: "Refund Rate",       value: 2.3,     format: "percent",  delta: 0.6,  dir: "down", good: true  },
  ],

  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

  revenueThisYear: [78000, 82000, 91000, 88000, 99000, 112000, 121000, 118000, 134000, 129000, 141000, 156000],
  revenueLastYear: [70000, 71000, 80000, 79000, 85000, 96000, 101000, 104000, 110000, 108000, 118000, 128000],

  categories:      ["Electronics", "Apparel", "Home", "Beauty", "Sports", "Books"],
  categoryRevenue: [412000, 298000, 231000, 154000, 121000, 68500],
};
