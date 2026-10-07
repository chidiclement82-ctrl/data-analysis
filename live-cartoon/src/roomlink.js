// Finds a TikTok LIVE room ID from the link you get with Share → Copy link on
// your LIVE (or a room ID typed in directly). This lets the cartoon connect
// even when TikTok blocks the server from looking the LIVE up by username.

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ROOM_ID = /^\d{12,25}$/;

// Pulls a room ID out of a URL or page text, or returns null.
export function roomIdFrom(text) {
  const s = String(text || '');
  const m = s.match(/room_?id(?:%22|%3D|["'=:\s])+(\d{12,25})/i)
    || s.match(/"roomId"\s*:\s*"(\d{12,25})"/)
    || s.match(/\/(?:reflow|live)\/(\d{12,25})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function tiktokUrl(text) {
  const raw = String(text || '').match(/https?:\/\/\S+/)?.[0];
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Only ever fetch TikTok's own addresses.
    return url.protocol === 'https:' && /(^|\.)tiktok\.com$/i.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export async function resolveRoomId(input, fetchImpl = fetch) {
  const text = String(input || '').trim();
  if (ROOM_ID.test(text)) return text;
  const direct = roomIdFrom(text);
  if (direct) return direct;

  let url = tiktokUrl(text);
  if (!url) throw new Error("That isn't a TikTok link. On your LIVE, tap Share → Copy link, then paste it here.");

  // Short links (vt.tiktok.com/…) redirect to the full LIVE address, which carries the room ID.
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetchImpl(url.href, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html' } });
    const location = res.headers.get('location');
    if (location) {
      const next = new URL(location, url);
      const id = roomIdFrom(next.href);
      if (id) return id;
      if (!/(^|\.)tiktok\.com$/i.test(next.hostname)) break;
      url = next;
      continue;
    }
    const id = roomIdFrom(await res.text());
    if (id) return id;
    break;
  }
  throw new Error("Couldn't find the LIVE room in that link. Copy the link from your LIVE while you're live (Share → Copy link) and try again.");
}
