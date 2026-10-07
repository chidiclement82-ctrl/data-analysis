// Connects to ONE TikTok account's LIVE (the username in .env) and passes on
// its chat, follows and gifts. When the account isn't live it keeps checking,
// so you can start this before you go live.

import { EventEmitter } from 'node:events';
import { TikTokLiveConnection, WebcastEvent, ControlEvent, UserOfflineError } from 'tiktok-live-connector';

const RETRY_MS = 20_000;

export class TikTokLink extends EventEmitter {
  constructor({ username, signApiKey } = {}) {
    super();
    this.username = String(username || '').replace(/^@/, '').trim();
    this.signApiKey = signApiKey || undefined;
    this.state = 'off'; // off | waiting | connecting | live | error
    this.detail = '';
    this.viewers = 0;
    this.timer = null;
    this.conn = null;
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

  retry(detail) {
    this.setState('waiting', detail);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), RETRY_MS);
  }

  async connect() {
    clearTimeout(this.timer);
    this.setState('connecting', `Looking for @${this.username}'s LIVE…`);
    this.conn?.disconnect().catch(() => {}); // drop the previous stream's connection
    const conn = new TikTokLiveConnection(this.username, { signApiKey: this.signApiKey });
    this.conn = conn;

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
    conn.on(WebcastEvent.STREAM_END, () => this.retry('Your LIVE ended. Waiting for the next one…'));
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (this.conn === conn && this.state === 'live') this.retry('Disconnected from TikTok. Reconnecting…');
    });
    conn.on(ControlEvent.ERROR, (e) => console.warn('[tiktok]', e?.info || e?.message || e));

    try {
      await conn.connect();
      this.setState('live', `Connected to @${this.username}'s LIVE`);
    } catch (err) {
      if (err instanceof UserOfflineError) this.retry(`@${this.username} isn't live yet. Checking again every ${RETRY_MS / 1000} s…`);
      else if (/room id/i.test(err?.message)) this.retry(`Couldn't find a LIVE for @${this.username}. Are you live, and is the username right? Checking again…`);
      else this.retry(`Couldn't connect (${String(err?.message || err).replace(/\.+$/, '')}). Retrying…`);
    }
  }

  async stop() {
    clearTimeout(this.timer);
    const conn = this.conn;
    this.conn = null;
    if (conn) await conn.disconnect().catch(() => {});
    this.setState('off');
  }
}
