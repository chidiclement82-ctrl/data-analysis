// Decides which TikTok comments the cartoon answers, and in what order.
// Busy chats get far more comments than the cartoon can say out loud, so it
// skips spam, gives everyone a turn, and favours real questions.

const EMOJI_OR_SPACE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s\p{P}]*$/u;

export function normalise(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// `blocked` is a list of lower-case words or phrases. A comment containing any
// of them is never shown to the AI or read out.
export function isBlocked(text, blocked = []) {
  const t = ` ${normalise(text).toLowerCase()} `;
  return blocked.some((w) => w && t.includes(w));
}

export function isWorthAnswering(text, { blocked = [] } = {}) {
  const t = normalise(text);
  if (t.length < 3 || t.length > 300) return false;
  if (EMOJI_OR_SPACE.test(t)) return false; // only emojis or punctuation
  if (/^(.)\1+$/u.test(t.replace(/\s/g, ''))) return false; // "aaaaaa"
  if (/(https?:\/\/|www\.)/i.test(t)) return false; // links
  if (isBlocked(t, blocked)) return false;
  return true;
}

// Higher score = answered sooner.
export function score(comment, { cartoonName = '', now = Date.now() } = {}) {
  const t = comment.text.toLowerCase();
  let s = 0;
  if (t.includes('?')) s += 3;
  if (/^(what|why|how|who|when|where|which|can|could|do|does|did|is|are|will|would|should)\b/.test(t)) s += 2;
  if (cartoonName && t.includes(cartoonName.toLowerCase())) s += 6; // talking to the cartoon directly
  if (t.split(' ').length >= 4) s += 1;
  s -= (now - comment.ts) / 15000; // a point lost every 15 s of waiting
  return s;
}

export class CommentQueue {
  constructor({ maxSize = 30, maxAgeMs = 90_000, perUserCooldownMs = 45_000, cartoonName = '', blocked = [] } = {}) {
    Object.assign(this, { maxSize, maxAgeMs, perUserCooldownMs, cartoonName, blocked });
    this.items = [];
    this.lastAnswered = new Map(); // user id -> time of their last answer
  }

  // Returns true when the comment was queued.
  add(comment) {
    if (!isWorthAnswering(comment.text, { blocked: this.blocked })) return false;
    // Keep only each viewer's newest comment, so one person can't fill the queue.
    this.items = this.items.filter((c) => c.userId !== comment.userId);
    this.items.push(comment);
    if (this.items.length > this.maxSize) this.items.shift();
    return true;
  }

  remove(id) {
    const i = this.items.findIndex((c) => c.id === id);
    return i === -1 ? null : this.items.splice(i, 1)[0];
  }

  clear() {
    this.items = [];
  }

  markAnswered(userId, now = Date.now()) {
    this.lastAnswered.set(userId, now);
  }

  // Takes the best comment out of the queue, or null when there's nothing to answer.
  next(now = Date.now()) {
    this.items = this.items.filter((c) => now - c.ts <= this.maxAgeMs);
    const ready = this.items.filter((c) => now - (this.lastAnswered.get(c.userId) ?? -Infinity) >= this.perUserCooldownMs);
    if (!ready.length) return null;
    const best = ready.reduce((a, b) =>
      score(b, { cartoonName: this.cartoonName, now }) > score(a, { cartoonName: this.cartoonName, now }) ? b : a);
    return this.remove(best.id);
  }
}
