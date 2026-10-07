// The page's line to the cartoon server. It uses a WebSocket when it can,
// and falls back to plain web requests (long polling) when the browser or
// network blocks WebSockets: some phone browsers, data-saver modes and
// in-app browsers do.
//
// openChannel(role, key, { onOpen, onMessage, onClose(code) }) returns
// { send(msg), close() }. onClose gets 4003 when the key was refused.

import { wsUrl } from './key.js';

const WS_OPEN_TIMEOUT_MS = 6000;
let useHttp = false; // once WebSockets fail on this page, stop trying them

export function openChannel(role, key, handlers) {
  return useHttp ? httpChannel(role, key, handlers) : wsChannel(role, key, handlers);
}

export function transportName() {
  return useHttp ? 'backup connection' : 'live connection';
}

function wsChannel(role, key, handlers) {
  let ws;
  let opened = false;
  let fellBack = null;
  const fallBack = () => {
    if (fellBack) return;
    useHttp = true;
    try { ws.close(); } catch { /* already closed */ }
    fellBack = httpChannel(role, key, handlers);
  };
  try {
    ws = new WebSocket(wsUrl(role, key));
  } catch {
    fallBack();
    return { send: (m) => fellBack.send(m), close: () => fellBack.close() };
  }
  const timer = setTimeout(() => { if (!opened) fallBack(); }, WS_OPEN_TIMEOUT_MS);
  ws.onopen = () => { opened = true; clearTimeout(timer); handlers.onOpen?.(); };
  ws.onmessage = (e) => { try { handlers.onMessage(JSON.parse(e.data)); } catch { /* bad message */ } };
  ws.onclose = (e) => {
    clearTimeout(timer);
    if (fellBack) return;
    if (e.code === 4003) return handlers.onClose?.(4003);
    if (!opened) return fallBack(); // never connected: WebSockets are blocked here
    handlers.onClose?.(e.code);
  };
  return {
    send(msg) {
      if (fellBack) return fellBack.send(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() { fellBack ? fellBack.close() : ws.close(); },
  };
}

function httpChannel(role, key, handlers) {
  let id = null;
  let closed = false;
  const done = (code) => {
    if (closed) return;
    closed = true;
    handlers.onClose?.(code);
  };

  (async () => {
    try {
      const res = await fetch(`/api/connect?role=${role}&key=${encodeURIComponent(key || '')}`, { method: 'POST', cache: 'no-store' });
      if (res.status === 403) return done(4003);
      if (!res.ok) return done(1006);
      ({ id } = await res.json());
      handlers.onOpen?.();
      while (!closed) {
        const poll = await fetch(`/api/poll?id=${id}`, { cache: 'no-store' });
        if (!poll.ok) return done(1006); // session expired or server restarted
        for (const msg of await poll.json()) {
          if (closed) return;
          try { handlers.onMessage(msg); } catch { /* bad message */ }
        }
      }
    } catch {
      done(1006);
    }
  })();

  return {
    send(msg) {
      if (!id || closed) return;
      fetch(`/api/send?id=${id}`, { method: 'POST', body: JSON.stringify(msg), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    },
    close() { closed = true; },
  };
}

// Whether this server needs the access key (it does when hosted online).
export async function needsKey() {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    return (await res.json()).needsKey === true;
  } catch {
    return false;
  }
}
