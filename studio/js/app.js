// Hash router and app shell.

import { icon, $ } from './ui.js';
import { api } from './api.js';
import { renderLanding } from './views/landing.js';
import { renderCreate } from './views/create.js';
import { renderFaceSwap } from './views/faceswap.js';
import { renderVoice } from './views/voice.js';
import { renderEditorPage } from './views/editor.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSafety } from './views/safety.js';

const routes = {
  '': renderLanding,
  create: renderCreate,
  'face-swap': renderFaceSwap,
  voice: renderVoice,
  editor: renderEditorPage,
  dashboard: renderDashboard,
  safety: renderSafety,
};

let cleanup = null;

export function navigate(path) { location.hash = '#/' + path.replace(/^#?\/?/, ''); }

export function updateModePill() {
  const pill = $('#mode-pill');
  pill.replaceChildren();
  const b = (t) => { const el = document.createElement('b'); el.textContent = t; return el; };
  const vp = api.voiceProvider;
  pill.append('Face: ', b(api.mode === 'cloud' ? 'AI server' : 'Preview'), ' · Voice: ', b(vp === 'elevenlabs' ? 'ElevenLabs' : 'Preview'));
  pill.title = vp === 'local'
    ? 'Voice cloning is off. Add an ElevenLabs API key in Dashboard → Account.'
    : 'Real voice cloning is on.';
}

async function render() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const [name, ...rest] = pathPart.split('/');
  const view = routes[name] ?? routes[''];
  const params = Object.fromEntries(new URLSearchParams(query));

  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;
  speechSynthesis?.cancel?.();

  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  $('#nav').classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');

  const app = $('#app');
  app.replaceChildren();
  window.scrollTo(0, 0);
  try {
    cleanup = await view(app, { args: rest.filter(Boolean), params });
  } catch (e) {
    console.error(e);
    app.replaceChildren();
    const box = document.createElement('div');
    box.className = 'page';
    box.innerHTML = '<div class="empty"><h3>Something went wrong</h3><p></p><a class="btn" href="#/">Back home</a></div>';
    box.querySelector('p').textContent = e.message;
    app.append(box);
  }
  app.focus({ preventScroll: true });
}

$('#brand-mark').append(icon('sparkle', 16));
$('#menu-btn').append(icon('menu'));
$('#menu-btn').addEventListener('click', () => {
  const open = $('#nav').classList.toggle('open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
});
updateModePill();
window.addEventListener('hashchange', render);
render();
