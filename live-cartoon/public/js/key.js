// The access key for an online (or Wi-Fi) server. It can arrive once as
// ?key=… in the link; it's then remembered on this device and removed from
// the address bar, so it never shows on a screen-shared LIVE.

const STORE = 'live-cartoon-key';

function remember(key) {
  try { localStorage.setItem(STORE, key); } catch { /* private mode: ask again next time */ }
}

export function getKey() {
  const params = new URLSearchParams(location.search);
  const fromLink = params.get('key');
  if (fromLink) {
    remember(fromLink);
    params.delete('key');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    return fromLink;
  }
  try { return localStorage.getItem(STORE) || ''; } catch { return ''; }
}

// Shows the key form (an element with an <input> and a submit button) and
// calls onKey once the person enters one.
export function askForKey(form, onKey, wrong = false) {
  form.hidden = false;
  form.querySelector('.key-error').hidden = !wrong;
  const input = form.querySelector('input');
  input.value = '';
  input.focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    remember(key);
    form.hidden = true;
    onKey(key);
  };
}

export function wsUrl(role, key) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?role=${role}${key ? `&key=${encodeURIComponent(key)}` : ''}`;
}
