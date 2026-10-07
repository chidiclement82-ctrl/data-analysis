// Connects to ONE TikTok account's LIVE (the username in .env) and passes on
// its chat, follows and gifts. When the account isn't live it keeps checking,
// so you can start this before you go live.

import { EventEmitter } from 'node:events';
import {
  TikTokLiveConnection, WebcastEvent, ControlEvent, UserOfflineError,
  SignatureRateLimitError, SignAPIError, PremiumFeatureError, InvalidUniqueIdError, ConnectTimeoutError,
} from 'tiktok-live-connector';
import { resolveRoomId } from './roomlink.js';

const RETRY_MS = 20_000;

// Plain-language reason a connection attempt failed, shown on the control panel.
export function explain(err, username) {
  const msg = String(err?.message || err || '');
  if (err instanceof UserOfflineError) return `@${username} isn't live yet. Checking again every ${RETRY_MS / 1000} s…`;
  if (err instanceof InvalidUniqueIdError) return `"${username}" doesn't look like a TikTok username. Check TIKTOK_USERNAME on Render (no @, no spaces).`;
  if (err instanceof SignatureRateLimitError || /rate.?limit|429/i.test(msg)) {
    return 'The free TikTok connection service is busy right now. Get a free key at eulerstream.com and add it on Render as EULER_API_KEY. Retrying…';
  }
  if (err instanceof PremiumFeatureError) return 'That TikTok connection needs a paid Euler Stream plan. Retrying with the free one…';
  if (err instanceof SignAPIError) return `The TikTok connection service refused (${msg.replace(/\.+$/, '')}). Adding a free EULER_API_KEY on Render usually fixes this. Retrying…`;
  if (err instanceof ConnectTimeoutError) return 'TikTok took too long to answer. Retrying…';
  if (/room id/i.test(msg)) {
    // Each way of looking up the LIVE failed; say why for each.
    const reasons = (err?.config?.requestErrs || []).map(lookupReason).filter(Boolean);
    const why = reasons.length ? ` (${[...new Set(reasons)].join('; ')})` : '';
    return `Couldn't find a LIVE for @${username}${why}. Are you live, and is the username right? If you are, paste your LIVE link below. Checking again…`;
  }
  return `Couldn't connect (${msg.replace(/\.+$/, '')}). Retrying…`;
}

function lookupReason(e) {
  const m = String(e?.message || '');
  if (/fetchRoomIdFromEuler|Euler/i.test(m)) {
    if (/permission/i.test(m)) return "Euler Stream key can't look up rooms";
    return 'Euler Stream lookup failed';
  }
  if (/SIGI_STATE|captcha|blocked|\b403\b|Forbidden/i.test(m)) return 'TikTok blocked the server';
  if (/API/i.test(m)) return 'TikTok API look-up failed';
  return null;
}

export class TikTokLink extends EventEmitter {
  constructor({ username, signApiKey, createConnection } = {}) {
    super();
    // Swappable for tests.
    this.createConnection = createConnection || ((user, opts) => new TikTokLiveConnection(user, opts));
    this.attempt = 0; // bumps on every connect/stop, so a slow old attempt can't overwrite a newer one
    this.username = String(username || '').replace(/^@/, '').trim();
    this.signApiKey = signApiKey || undefined;
    this.state = 'off'; // off | waiting | connecting | live | error
    this.detail = '';
    this.viewers = 0;
    this.timer = null;
    this.conn = null;
    this.roomId = null; // set from a pasted LIVE link; skips the username look-up
  }

  setState(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.emit('status', this.status());
  }

  status() {
    return { username: this.username, state: this.state, detail: this.detail, viewers: this.viewers };
  }

  start() {
    if (!this.username) return this.setState('off', 'Add TIKTOK_USERNAME to .env');
    this.connect();
  }

  // The control panel's "Reconnect to TikTok": drop whatever is happening and try now.
  reconnect() {
    if (!this.username) return this.setState('off', 'Add TIKTOK_USERNAME on Render (Environment), then press Reconnect.');
    this.connect();
  }

  // Connect straight to the room in a pasted LIVE link (Share → Copy link).
  async useLiveLink(link) {
    this.setState('connecting', 'Reading your LIVE link…');
    try {
      this.roomId = await resolveRoomId(link);
    } catch (err) {
      return this.retry(err.message);
    }
    console.log('[tiktok] using room from LIVE link:', this.roomId);
    this.connect();
  }

  retry(detail) {
    this.setState('waiting', detail);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), RETRY_MS);
  }

  async connect() {
    clearTimeout(this.timer);
    const attempt = ++this.attempt;
    const roomId = this.roomId;
    this.setState('connecting', roomId ? 'Connecting to the LIVE from your link…' : `Looking for @${this.username}'s LIVE…`);
    this.conn?.disconnect()?.catch?.(() => {}); // drop the previous stream's connection
    // With a room from a link, skip the room-info check too: it's another look-up TikTok may block.
    const conn = this.createConnection(this.username || 'tiktok', { signApiKey: this.signApiKey, fetchRoomInfoOnConnect: !roomId });
    this.conn = conn;
    const current = () => this.attempt === attempt;

    conn.on(WebcastEvent.CHAT, (d) => {
      const text = String(d.comment ?? '').trim();
      if (!text) return;
      this.emit('comment', {
        id: String(d.common?.msgId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        userId: String(d.user?.userId ?? d.user?.uniqueId ?? 'unknown'),
        name: d.user?.nickname || d.user?.uniqueId || 'someone',
        handle: d.user?.uniqueId || '',
        text,
        ts: Date.now(),
      });
    });
    conn.on(WebcastEvent.FOLLOW, (d) => this.emit('follow', { name: d.user?.nickname || d.user?.uniqueId || 'someone' }));
    conn.on(WebcastEvent.GIFT, (d) => {
      // Streakable gifts fire repeatedly; only count the end of the streak.
      if (d.giftDetails?.giftType === 1 && !d.repeatEnd) return;
      this.emit('gift', {
        name: d.user?.nickname || d.user?.uniqueId || 'someone',
        gift: d.giftDetails?.giftName || 'a gift',
        count: d.repeatCount || 1,
      });
    });
    conn.on(WebcastEvent.ROOM_USER, (d) => {
      if (typeof d.viewerCount === 'number') {
        this.viewers = d.viewerCount;
        this.emit('status', this.status());
      }
    });
    conn.on(WebcastEvent.STREAM_END, () => {
      if (!current()) return;
      this.roomId = null; // the next LIVE is a new room
      this.retry('Your LIVE ended. Waiting for the next one…');
    });
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (current() && this.state === 'live') this.retry('Disconnected from TikTok. Reconnecting…');
    });
    conn.on(ControlEvent.ERROR, (e) => console.warn('[tiktok]', e?.info || e?.message || e));

    try {
      await conn.connect(roomId || undefined);
      if (!current()) return conn.disconnect()?.catch?.(() => {}); // a newer attempt took over
      this.setState('live', `Connected to @${this.username}'s LIVE`);
    } catch (err) {
      if (!current()) return;
      console.warn('[tiktok] connect failed:', err?.name, err?.message);
      for (const e of err?.config?.requestErrs || []) console.warn('[tiktok]   tried:', e?.message);
      if (roomId) {
        this.roomId = null; // the link's room didn't work (LIVE over?); go back to looking up by username
        return this.retry(`Couldn't join the LIVE from that link (${String(err?.message || err).replace(/\.+$/, '')}). Copy a fresh link from your LIVE and try again.`);
      }
      this.retry(explain(err, this.username));
    }
  }

  async stop() {
    clearTimeout(this.timer);
    this.attempt++;
    const conn = this.conn;
    this.conn = null;
    if (conn) await conn.disconnect().catch(() => {});
    this.setState('off');
  }
}
