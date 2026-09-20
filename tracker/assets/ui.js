/* Small shared UI helpers used by both pages. */

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer;
export function toast(message, isError) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("err", !!isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

export function initTheme() {
  const KEY = "mt_theme";
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (e) {}

  function current() {
    const set = root.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function label() {
    const btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = current() === "dark" ? "☀" : "☾";
  }
  label();

  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      label();
    });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!root.getAttribute("data-theme")) label();
  });
}
