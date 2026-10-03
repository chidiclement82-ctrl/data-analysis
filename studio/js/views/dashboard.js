import { h, icon, toast, fmtDate, fmtBytes, fmtTime } from '../ui.js';
import { all, get, remove, onChange, getSettings, saveSettings, clearAll, blobUrl } from '../store.js';
import { faceTile, videoTile } from '../library.js';
import { downloadBlob, recordExport } from '../projects.js';
import { drawWave } from '../voice.js';
import { checkRateLimit, openReportDialog } from '../safety.js';
import { api } from '../api.js';
import { navigate, updateModePill } from '../app.js';

const TABS = [
  ['projects', 'grid', 'Projects'],
  ['faces', 'face', 'Faces'],
  ['voices', 'mic', 'Voice models'],
  ['videos', 'film', 'Generated videos'],
  ['exports', 'download', 'Export history'],
  ['account', 'settings', 'Account'],
];

const PLANS = { free: 'Free', creator: 'Creator · $19/mo', studio: 'Studio · $59/mo' };

export async function renderDashboard(app, { args, params }) {
  let tab = TABS.some(t => t[0] === args[0]) ? args[0] : 'projects';
  const stats = h('div', { class: 'stats' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const content = h('div');
  const settings = getSettings();

  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, `Welcome back, ${settings.displayName}`), h('p', { class: 'muted' }, 'Everything you\'ve made, in one place.')),
      h('a', { class: 'btn primary', href: '#/create' }, icon('plus', 16), 'New video')),
    stats, tabs, content));

  async function drawStats() {
    const [projects, faces, voices, videos, exports] = await Promise.all(['projects', 'faces', 'voices', 'videos', 'exports'].map(all));
    const usage = await checkRateLimit();
    const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));
    stats.replaceChildren(
      stat(projects.length, 'Projects'),
      stat(faces.length, 'Saved faces'),
      stat(voices.length, 'Voice models'),
      stat(videos.filter(v => v.kind === 'generated').length, 'Generated videos'),
      stat(exports.length, 'Downloads'),
      h('div', { class: 'stat' }, h('b', {}, `${usage.used}/${usage.limit}`), h('span', {}, 'Videos today'), h('div', { class: 'meter' }, h('i', { style: { width: `${Math.min(100, usage.used / usage.limit * 100)}%` } }))));
  }

  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([id, ic, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'on' : '',
      onclick: () => { tab = id; history.replaceState(null, '', `#/dashboard/${id}`); drawTabs(); drawContent(); } }, icon(ic, 15), label)));
  }

  const confirmDelete = (what) => confirm(`Delete ${what}? This can't be undone.`);
  const empty = (title, text, href, cta) => h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, text), href && h('a', { class: 'btn primary', href }, cta));

  const views = {
    async projects() {
      const projects = await all('projects');
      if (!projects.length) return empty('No projects yet', 'Start with a video and your face. It takes a few minutes.', '#/create', 'Create a video');
      return h('div', { class: 'thumb-grid' }, projects.map(p => h('div', { class: 'tile' },
        h('div', { class: 'media wide' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : icon('film', 28)),
        h('div', { class: 'body' },
          h('span', { class: 'title' }, p.name),
          h('span', { class: 'small muted' }, `Edited ${fmtDate(p.updatedAt)}`),
          h('span', {}, p.outputVideoId ? h('span', { class: 'badge ok' }, 'Generated') : h('span', { class: 'badge' }, 'Draft'))),
        h('div', { class: 'actions' },
          h('a', { class: 'btn sm', href: `#/create/${p.id}` }, 'Continue'),
          h('a', { class: 'btn sm ghost', href: `#/editor/${p.id}` }, 'Edit'),
          h('button', { class: 'btn sm ghost', 'aria-label': 'Delete project', onclick: async () => { if (confirmDelete(`the project "${p.name}"`)) await remove('projects', p.id); } }, icon('trash', 14))))));
    },
    async faces() {
      const faces = await all('faces');
      if (!faces.length) return empty('No faces saved', 'Upload a selfie in Face swap or the Create flow.', '#/face-swap', 'Add a face');
      return h('div', { class: 'thumb-grid' }, faces.map(f => faceTile(f, { actions: [
        h('button', { class: 'btn sm', onclick: () => navigate(`face-swap?face=${f.id}`) }, 'Use'),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Delete face', onclick: async () => { if (confirmDelete(`the face "${f.name}"`)) await remove('faces', f.id); } }, icon('trash', 14)),
      ] })));
    },
    async voices() {
      const voices = await all('voices');
      if (!voices.length) return empty('No voice models', 'Record a 30-second sample to clone your voice.', '#/voice', 'Create a voice');
      return h('div', { class: 'thumb-grid' }, voices.map(v => {
        const c = h('canvas', { class: 'wave' });
        requestAnimationFrame(() => v.peaks && drawWave(c, v.peaks));
        const a = new Audio(blobUrl(v.id, v.sample));
        return h('div', { class: 'tile voice-tile' }, h('div', { class: 'media' }, c),
          h('div', { class: 'body' }, h('span', { class: 'title' }, v.name), h('span', { class: 'small muted' }, `${v.remoteId ? 'Neural clone' : 'Local profile'} · ${v.profile ? fmtTime(v.profile.duration) + ' sample' : ''}`)),
          h('div', { class: 'actions' },
            h('button', { class: 'btn sm', onclick: () => (a.paused ? a.play() : a.pause()) }, icon('play', 14), 'Sample'),
            h('a', { class: 'btn sm ghost', href: '#/voice' }, 'Use'),
            h('button', { class: 'btn sm ghost', 'aria-label': 'Delete voice', onclick: async () => { if (confirmDelete(`the voice "${v.name}"`)) await remove('voices', v.id); } }, icon('trash', 14))));
      }));
    },
    async videos() {
      const videos = (await all('videos')).filter(v => v.kind === 'generated');
      if (!videos.length) return empty('No generated videos', 'Videos you generate appear here, ready to download.', '#/create', 'Create a video');
      return h('div', { class: 'thumb-grid' }, videos.map(v => videoTile(v, { actions: [
        h('button', { class: 'btn sm primary', onclick: async () => { downloadBlob(v.blob, v.name); await recordExport(v); toast('Download started.', 'success'); } }, icon('download', 14), 'Download'),
        h('button', { class: 'btn sm ghost', 'aria-label': 'Delete video', onclick: async () => { if (confirmDelete(`"${v.name}"`)) await remove('videos', v.id); } }, icon('trash', 14)),
      ] })));
    },
    async exports() {
      const exps = await all('exports');
      if (!exps.length) return empty('No downloads yet', 'Every download is logged here with its content ID.', null);
      return h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['File', 'Content ID', 'Quality', 'Format', 'Size', 'Date', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, exps.map(e => h('tr', {},
          h('td', {}, e.name), h('td', {}, h('span', { class: 'badge ai' }, e.contentId)), h('td', {}, e.quality), h('td', {}, e.format.toUpperCase()),
          h('td', {}, fmtBytes(e.size)), h('td', {}, fmtDate(e.createdAt)),
          h('td', {}, h('button', { class: 'btn sm ghost', onclick: async () => {
            const v = await get('videos', e.videoId);
            if (!v) { toast('That video was deleted.', 'error'); return; }
            downloadBlob(v.blob, v.name); await recordExport(v);
          } }, 'Download again')))))));
    },
    async account() {
      const s = getSettings();
      const name = h('input', { type: 'text', value: s.displayName });
      const quality = h('select', {}, [['720', 'HD 720p'], ['1080', 'Full HD 1080p']].map(([v, l]) => h('option', { value: v, selected: s.exportQuality === v }, l)));
      const apiBase = h('input', { type: 'url', value: s.apiBase, placeholder: 'https://api.your-backend.com' });
      const apiStatus = h('span', { class: 'small muted' });
      const plans = h('div', { class: 'chips' });
      let plan = params.plan && PLANS[params.plan] ? params.plan : s.plan;
      const drawPlans = () => plans.replaceChildren(...Object.entries(PLANS).map(([k, l]) => h('button', { class: `chip${plan === k ? ' on' : ''}`, onclick: () => { plan = k; drawPlans(); } }, l)));
      drawPlans();

      const save = () => {
        saveSettings({ displayName: name.value.trim() || 'Creator', exportQuality: quality.value, apiBase: apiBase.value.trim(), plan });
        updateModePill();
        drawStats();
        toast('Settings saved.', 'success');
      };
      const test = async () => {
        saveSettings({ apiBase: apiBase.value.trim() });
        updateModePill();
        apiStatus.textContent = 'Checking…';
        try { const r = await api.health(); apiStatus.textContent = r.mode === 'local' ? 'No provider set: using the in-browser engine.' : 'Connected.'; }
        catch (e) { apiStatus.textContent = `Couldn't connect: ${e.message}`; }
      };
      const exportConsents = async () => {
        const consents = await all('consents');
        downloadBlob(new Blob([JSON.stringify(consents, null, 2)], { type: 'application/json' }), 'visage-consent-records.json');
      };
      return h('div', { class: 'grid-2' },
        h('div', { class: 'card stack' },
          h('h3', {}, 'Profile'),
          h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
          h('label', { class: 'field' }, h('span', {}, 'Default export quality'), quality),
          h('h3', { style: { marginTop: '8px' } }, 'Subscription'),
          plans,
          plan !== s.plan && h('div', { class: 'notice' }, icon('sparkle'), h('span', {}, 'Payments aren\'t connected in this build yet, so saving switches your plan right away. Hook your billing provider into this step before launch.')),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save changes'))),
        h('div', { class: 'stack' },
          h('div', { class: 'card stack' },
            h('h3', {}, 'AI provider'),
            h('p', { class: 'muted small', style: { margin: 0 } }, 'Leave empty to use the in-browser engine. Add your backend URL to run generative face swap and neural voice cloning on servers. The API it needs is described in studio/README.md.'),
            h('label', { class: 'field' }, h('span', {}, 'API base URL'), apiBase),
            h('div', { class: 'row' }, h('button', { class: 'btn', onclick: test }, 'Test connection'), apiStatus)),
          h('div', { class: 'card stack' },
            h('h3', {}, 'Privacy & data'),
            h('p', { class: 'muted small', style: { margin: 0 } }, 'Your faces, voices and videos are stored in this browser only. Nothing is uploaded unless you connect an AI provider.'),
            h('div', { class: 'row' },
              h('button', { class: 'btn', onclick: exportConsents }, icon('download', 16), 'Download consent records'),
              h('button', { class: 'btn ghost', onclick: () => openReportDialog() }, icon('flag', 16), 'Report content')),
            h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: async () => {
              if (!confirm('Delete ALL your faces, voice models, videos, projects and history from this browser? This can\'t be undone.')) return;
              await clearAll();
              toast('All data deleted.', 'success');
            } }, icon('trash', 16), 'Delete all my data')))));
    },
  };

  async function drawContent() {
    content.replaceChildren(await views[tab]());
  }

  drawTabs();
  await Promise.all([drawStats(), drawContent()]);
  const off = onChange(() => { drawStats(); if (tab !== 'account') drawContent(); });
  return off;
}
