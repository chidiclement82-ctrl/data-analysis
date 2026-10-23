/* Shared by the customer page (/) and the team inbox (/team):
   talking to the relay, the live event stream, photos, and drawing messages. */

import { toB64, fromB64 } from "./e2ee.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// The chat's name, contact link and the team's public key, from the server's
// settings. Fills in every [data-brand] on the page.
export async function loadConfig() {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json " + res.status);
  const config = await res.json();
  document.querySelectorAll("[data-brand]").forEach((n) => { n.textContent = config.brandName; });
  return config;
}

// Relay API ------------------------------------------------------------------

export function relayClient(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  let token = null;

  async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || "The chat server said " + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Live events over a streamed fetch (so the token goes in a header, not the
  // address). Reconnects by itself; onStatus gets "live" or "offline".
  function listen(onEvent, onStatus) {
    let stopped = false;
    let ctrl = null;
    let delay = 1000;
    (async function loop() {
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const res = await fetch(base + "/api/events", { headers: { Authorization: "Bearer " + token }, signal: ctrl.signal, cache: "no-store" });
          if (res.status === 404) return poll(onStatus);
          if (res.status === 401) { onStatus("unauthorized"); return; }
          if (!res.ok || !res.body) throw new Error("stream " + res.status);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              let event = "message";
              let data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
              }
              if (!data) continue;
              if (event === "ready") { delay = 1000; onStatus("live"); }
              try { onEvent(event, JSON.parse(data)); } catch (err) { console.error(err); }
            }
          }
        } catch (err) {
          if (stopped) return;
        }
        onStatus("offline");
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
      }
    })();
    return () => { stopped = true; if (ctrl) ctrl.abort(); };

    // Hosts without a live stream (serverless): ask for news every few
    // seconds while the page is on screen, less often in the background.
    async function poll() {
      let wake = null;
      const onVisible = () => { if (document.visibilityState === "visible" && wake) wake(); };
      document.addEventListener("visibilitychange", onVisible);
      while (!stopped) {
        onStatus("tick");
        const ms = document.visibilityState === "visible" ? 4000 : 30000;
        await new Promise((r) => { wake = r; setTimeout(r, ms); });
        wake = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
    }
  }

  return {
    base,
    api,
    listen,
    setToken(t) { token = t; },
    get token() { return token; },
  };
}

// Photos -------------------------------------------------------------------

// Shrinks a photo to at most 1600px and re-encodes it as JPEG. That also
// strips its hidden details (location, camera) before it is encrypted.
export async function photoPayload(file) {
  if (!/^image\//.test(file.type)) throw new Error("Only photos can be sent.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That photo couldn't be opened."));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return { type: "image", mime: "image/jpeg", w, h, data: toB64(new Uint8Array(await blob.arrayBuffer())) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const imageUrls = new Map(); // message id -> blob URL (made once per photo)
function imageUrl(id, payload) {
  if (!imageUrls.has(id)) {
    const mime = /^image\/(jpeg|png|webp|gif)$/.test(payload.mime) ? payload.mime : "image/jpeg";
    imageUrls.set(id, URL.createObjectURL(new Blob([fromB64(payload.data)], { type: mime })));
  }
  return imageUrls.get(id);
}

// Drawing messages -----------------------------------------------------------

export function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dayOf(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

// Text with web links made clickable (built from text nodes, never as HTML).
function richText(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/);
  parts.forEach((part, i) => {
    if (i % 2) {
      const a = el("a", null, part);
      a.href = part;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      frag.appendChild(a);
    } else if (part) {
      frag.appendChild(document.createTextNode(part));
    }
  });
  return frag;
}

// A plain-text line for chat lists and notifications.
export function preview(item) {
  if (item.error) return "🔒 Couldn't unlock this message";
  const p = item.payload || {};
  if (p.type === "text") return p.text;
  if (p.type === "image") return "📷 Photo";
  if (p.type === "profile") return "Started a chat";
  return "Message";
}

/* Draws a list of decrypted messages into `box`.
   items: [{ id, seq?, from, ts, payload?, error?, pending?, failed? }]
   me: "customer" or "agent" (whose messages go on the right)
   readUpTo: the other side's read position (for the double tick)
   labels: { them: name shown on their messages } */
export function renderMessages(box, items, { me, readUpTo = 0, labels = {}, onRetry } = {}) {
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.textContent = "";
  let lastDay = null;
  for (const item of items) {
    const day = dayOf(item.ts);
    if (day !== lastDay) {
      box.appendChild(el("div", "msg-day", day));
      lastDay = day;
    }
    const p = item.payload || {};
    if (!item.error && p.type === "profile") {
      const who = me === "customer" ? "You" : (p.name || "The customer");
      let text = who + " started this chat";
      if (p.order) text += " about order " + p.order;
      box.appendChild(el("div", "msg-note", text + "."));
      continue;
    }
    const mine = item.from === me;
    const row = el("div", "msg " + (mine ? "msg-me" : "msg-them"));
    const bubble = el("div", "msg-bubble");
    if (!mine && labels.them) bubble.appendChild(el("div", "msg-by", p.by ? p.by + " · " + labels.them : labels.them));
    else if (mine && me === "agent" && p.by) bubble.appendChild(el("div", "msg-by", p.by));

    if (item.error) {
      bubble.classList.add("msg-locked");
      bubble.appendChild(el("p", "msg-text", "🔒 This message couldn't be unlocked. It may have been changed on the way, or sealed with a different key."));
    } else if (p.type === "text") {
      const t = el("p", "msg-text");
      t.appendChild(richText(p.text));
      bubble.appendChild(t);
    } else if (p.type === "image" && typeof p.data === "string") {
      const a = el("a", "msg-photo");
      a.href = imageUrl(item.id, p);
      a.target = "_blank";
      a.rel = "noopener";
      const img = el("img");
      img.src = a.href;
      img.alt = "Photo";
      img.loading = "lazy";
      if (p.w && p.h) { img.width = p.w; img.height = p.h; }
      a.appendChild(img);
      bubble.appendChild(a);
    } else {
      bubble.appendChild(el("p", "msg-text muted", "This message needs a newer version of the page."));
    }

    const meta = el("div", "msg-meta", timeOf(item.ts));
    if (mine) {
      const tick = el("span", "msg-tick");
      if (item.failed) {
        tick.textContent = "Not sent";
        tick.classList.add("failed");
        if (onRetry) {
          const retry = el("button", "msg-retry", "Retry");
          retry.type = "button";
          retry.addEventListener("click", () => onRetry(item));
          meta.appendChild(retry);
        }
      } else if (item.pending) {
        tick.textContent = "🕓";
        tick.title = "Sending";
      } else if (item.seq && item.seq <= readUpTo) {
        tick.textContent = "✓✓";
        tick.title = "Seen";
        tick.classList.add("seen");
      } else {
        tick.textContent = "✓";
        tick.title = "Delivered";
      }
      meta.appendChild(tick);
    }
    bubble.appendChild(meta);
    row.appendChild(bubble);
    box.appendChild(row);
  }
  if (nearBottom || items.some((i) => i.pending)) box.scrollTop = box.scrollHeight;
}

// Grows a textarea with its text, up to a few lines.
export function autosize(textarea) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
  };
  textarea.addEventListener("input", fit);
  return fit;
}

// Orders decrypted messages: delivered ones by relay order, unsent ones last.
export function sortMessages(items) {
  return items.sort((a, b) => (a.seq || Infinity) - (b.seq || Infinity) || a.ts - b.ts);
}
