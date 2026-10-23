// Conversations and their sealed messages, kept in memory and saved to one
// JSON file. The relay never sees what is inside a message: only who sent it
// (customer or team), when, and the ciphertext.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createStore({ dataDir, retentionDays = 30, now = () => Date.now() } = {}) {
  const file = dataDir ? join(dataDir, 'conversations.json') : null;
  const conversations = new Map();
  let saveTimer = null;

  if (file) {
    mkdirSync(dataDir, { recursive: true });
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      for (const c of saved.conversations || []) conversations.set(c.id, c);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`Couldn't read ${file}, starting empty:`, err.message);
    }
  }

  function saveSoon() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(flush, 300);
    saveTimer.unref?.();
  }

  function flush() {
    if (!file) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ conversations: [...conversations.values()] }));
    renameSync(tmp, file); // atomic: a crash never leaves half a file
  }

  // Chats nobody has touched for retentionDays are deleted for good.
  function prune() {
    const cutoff = now() - retentionDays * 86400000;
    let removed = 0;
    for (const [id, c] of conversations) {
      if (c.lastAt < cutoff) { conversations.delete(id); removed++; }
    }
    if (removed) saveSoon();
    return removed;
  }

  function summary(c) {
    const last = c.messages[c.messages.length - 1];
    return {
      id: c.id,
      customerKey: c.customerKey,
      agentKeyId: c.agentKeyId,
      status: c.status,
      createdAt: c.createdAt,
      lastAt: c.lastAt,
      lastSeq: last ? last.seq : 0,
      lastFrom: last ? last.from : null,
      read: c.read,
      count: c.messages.length,
    };
  }

  return {
    flush,
    prune,
    summary,
    get: (id) => conversations.get(id),
    list: () => [...conversations.values()].sort((a, b) => b.lastAt - a.lastAt),

    create({ id, customerKey, agentKeyId, tokenHash }) {
      const t = now();
      const c = {
        id, customerKey, agentKeyId, tokenHash,
        status: 'open', createdAt: t, lastAt: t, nextSeq: 1,
        read: { customer: 0, agent: 0 },
        messages: [],
      };
      conversations.set(id, c);
      saveSoon();
      return c;
    },

    // Adds a sealed message. Sending the same message id twice (a retry after
    // a dropped connection) returns the first copy instead of a duplicate.
    append(c, env) {
      const dup = c.messages.find((m) => m.id === env.id);
      if (dup) return { message: dup, duplicate: true };
      const message = { seq: c.nextSeq++, at: now(), v: env.v, id: env.id, conv: env.conv, from: env.from, ts: env.ts, iv: env.iv, ct: env.ct };
      c.messages.push(message);
      c.lastAt = message.at;
      // The sender has obviously seen everything up to their own message.
      c.read[env.from] = message.seq;
      if (env.from === 'customer' && c.status === 'closed') c.status = 'open';
      saveSoon();
      return { message, duplicate: false };
    },

    after(c, seq = 0) {
      return c.messages.filter((m) => m.seq > seq);
    },

    markRead(c, role, seq) {
      const top = c.nextSeq - 1;
      const value = Math.min(Math.max(0, Math.floor(seq)), top);
      if (value <= c.read[role]) return false;
      c.read[role] = value;
      saveSoon();
      return true;
    },

    setStatus(c, status) {
      if (c.status === status) return false;
      c.status = status;
      c.lastAt = now();
      saveSoon();
      return true;
    },

    remove(id) {
      const had = conversations.delete(id);
      if (had) saveSoon();
      return had;
    },
  };
}
