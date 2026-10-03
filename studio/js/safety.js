// Consent, labeling and abuse-prevention. Every face, voice and source video
// passes through here before it is saved, and every export is stamped with a
// visible "AI-generated" label plus a content ID that reports can reference.

import { h, modal, toast } from './ui.js';
import { put, all, uid, getSettings } from './store.js';
import { api } from './api.js';

// Names of public figures that cannot be used as a face or voice subject without
// a verified authorization on file. A production deployment replaces this list
// with a face/voice-recognition screen on the server (see api.screenIdentity).
const PROTECTED_NAMES = [
  'taylor swift', 'elon musk', 'joe biden', 'donald trump', 'barack obama', 'kamala harris',
  'beyonce', 'beyoncé', 'oprah winfrey', 'tom cruise', 'keanu reeves', 'scarlett johansson',
  'mark zuckerberg', 'bill gates', 'pope francis', 'king charles', 'rishi sunak', 'emmanuel macron',
  'vladimir putin', 'xi jinping', 'narendra modi', 'bola tinubu', 'cristiano ronaldo', 'lionel messi',
  'morgan freeman', 'kim kardashian', 'rihanna', 'drake', 'burna boy', 'wizkid', 'davido',
];

export const CONSENT_VERSION = '2026-10';

export function voiceConsentPhrase(name) {
  return `I, ${name || '[your name]'}, am creating a voice model of my own voice on Visage Studio, and I consent to it being used only by me.`;
}

export async function sha256(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalize(s) { return (s || '').toLowerCase().replace(/[^a-zÀ-ɏ ]/g, ' ').replace(/\s+/g, ' ').trim(); }

export function isProtectedName(name) {
  const n = normalize(name);
  if (!n) return false;
  return PROTECTED_NAMES.some(p => n === p || n.includes(p));
}

/**
 * Asks for consent before a face, voice or source video is used.
 * kind: 'face' | 'voice' | 'video'. Resolves with the saved consent record, or null if declined.
 */
export async function requestConsent(kind, file, { suggestedLabel = '' } = {}) {
  const settings = getSettings();
  const result = await modal(kind === 'video' ? 'Confirm you have rights to this video' : `Confirm consent for this ${kind}`, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const whoSelf = h('input', { type: 'radio', name: 'who', value: 'self', checked: true });
    const whoOther = h('input', { type: 'radio', name: 'who', value: 'other' });
    const subject = h('input', { type: 'text', placeholder: 'Full name of the person shown', value: suggestedLabel });
    const signature = h('input', { type: 'text', placeholder: 'Type your full name to sign', autocomplete: 'name' });
    const c1 = h('input', { type: 'checkbox' });
    const c2 = h('input', { type: 'checkbox' });
    const c3 = h('input', { type: 'checkbox' });
    const subjectRow = h('label', { class: 'field', hidden: true }, h('span', {}, 'Who is the person?'), subject);
    const toggle = () => { subjectRow.hidden = !whoOther.checked; };
    whoSelf.addEventListener('change', toggle);
    whoOther.addEventListener('change', toggle);

    const statements = {
      face: [
        'The face in this upload is mine, or I have the person\'s written permission to use it.',
        'I will not use it to impersonate, harass, defraud or sexualize anyone, or to depict a real person saying or doing things they did not.',
        'I understand every video made with it is labeled "AI-generated" and can be traced and reported.',
      ],
      voice: [
        'This voice is mine, or I have the speaker\'s written permission to clone it.',
        'I will not use the voice model to deceive, defraud or impersonate anyone.',
        'I understand speech made with this voice is labeled as AI-generated.',
      ],
      video: [
        'I own this video or have the right to edit it.',
        'Anyone whose face will be replaced has agreed to it, or the video is my own footage.',
        'I will not publish the result as genuine footage of a real event.',
      ],
    }[kind];

    const submit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!c1.checked || !c2.checked || !c3.checked) { err.textContent = 'Please confirm all three statements to continue.'; return; }
      if (signature.value.trim().length < 3) { err.textContent = 'Type your full name as a signature.'; return; }
      const subjectName = whoOther.checked ? subject.value.trim() : signature.value.trim();
      if (whoOther.checked && subjectName.length < 3) { err.textContent = 'Enter the name of the person who gave permission.'; return; }
      if (kind !== 'video' && (isProtectedName(subjectName) || isProtectedName(suggestedLabel))) {
        err.textContent = 'This looks like a public figure. Their likeness and voice are protected and need verified authorization, which you can request from Trust & Safety.';
        return;
      }
      close({ relation: whoOther.checked ? 'permission' : 'self', subjectName, signature: signature.value.trim() });
    };

    return h('form', { class: 'consent-form', onsubmit: submit },
      h('p', { class: 'muted' }, kind === 'video'
        ? 'Before we process this video, confirm the following.'
        : 'Visage Studio only lets people create AI content with their own likeness, or with clear permission from the person.'),
      kind !== 'video' && h('fieldset', { class: 'seg' },
        h('legend', {}, 'Whose ' + kind + ' is this?'),
        h('label', {}, whoSelf, ' Mine'),
        h('label', {}, whoOther, ' Someone who gave me permission')),
      subjectRow,
      h('div', { class: 'checks' },
        h('label', { class: 'check' }, c1, h('span', {}, statements[0])),
        h('label', { class: 'check' }, c2, h('span', {}, statements[1])),
        h('label', { class: 'check' }, c3, h('span', {}, statements[2]))),
      h('label', { class: 'field' }, h('span', {}, 'Signature'), signature),
      err,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, 'I agree, continue')));
  });
  if (!result) return null;

  // Server-side screen (a face must be present and must not match a protected
  // person). Without a server this returns { allowed: true }. If the server
  // can't be reached, the upload is refused rather than skipping the check.
  let screen;
  try { screen = await api.screenIdentity(kind, file); }
  catch (e) { toast(`Couldn't run the safety check: ${e.message}`, 'error'); return null; }
  if (!screen.allowed) {
    toast(screen.reason || 'This upload was blocked by our safety screen.', 'error');
    return null;
  }

  return put('consents', {
    id: uid('consent'),
    kind,
    fileName: file?.name || 'recording',
    fileHash: file ? await sha256(file) : null,
    relation: result.relation,
    subjectName: result.subjectName,
    signature: result.signature,
    account: settings.displayName,
    version: CONSENT_VERSION,
    userAgent: navigator.userAgent,
  });
}

// Burned-in label drawn on every exported frame. Not optional: it is how viewers
// know the video is synthetic. position: 'top-right' (default) or 'bottom-right'.
export function drawAiLabel(ctx, w, hgt, contentId, { position = 'top-right' } = {}) {
  const scale = Math.max(0.6, Math.min(w, hgt) / 720);
  const pad = 14 * scale;
  ctx.save();
  ctx.font = `600 ${15 * scale}px Inter, system-ui, sans-serif`;
  const text = '✦ AI-generated';
  const idText = contentId ? ` · ${contentId}` : '';
  const tw = ctx.measureText(text).width;
  ctx.font = `500 ${11 * scale}px Inter, system-ui, sans-serif`;
  const iw = ctx.measureText(idText).width;
  const bw = tw + iw + pad * 1.6;
  const bh = 28 * scale;
  const x = w - bw - pad;
  const y = position === 'bottom-right' ? hgt - bh - pad : pad;
  ctx.fillStyle = 'rgba(10, 10, 20, 0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${15 * scale}px Inter, system-ui, sans-serif`;
  ctx.fillText(text, x + pad * 0.8, y + bh / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `500 ${11 * scale}px Inter, system-ui, sans-serif`;
  ctx.fillText(idText, x + pad * 0.8 + tw, y + bh / 2 + 1);
  ctx.restore();
}

export function newContentId() {
  return 'VS-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
}

const REASONS = [
  ['impersonation', 'Impersonates me or someone I represent'],
  ['nonconsensual', 'Uses my face or voice without consent'],
  ['sexual', 'Sexual or intimate content'],
  ['fraud', 'Scam, fraud or financial deception'],
  ['misinformation', 'Presented as real news or a real event'],
  ['harassment', 'Harassment or bullying'],
  ['other', 'Something else'],
];

export function openReportDialog(prefillId = '') {
  return modal('Report AI-generated content', (close) => {
    const id = h('input', { type: 'text', placeholder: 'e.g. VS-7K2P-M1QZ', value: prefillId });
    const url = h('input', { type: 'url', placeholder: 'Where did you see it? (optional link)' });
    const reason = h('select', {}, REASONS.map(([v, l]) => h('option', { value: v }, l)));
    const details = h('textarea', { rows: 4, placeholder: 'What happened? Include anything that helps us act quickly.' });
    const contact = h('input', { type: 'email', placeholder: 'Email for updates (optional)' });
    const err = h('p', { class: 'form-error', role: 'alert' });
    return h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      if (!id.value.trim() && !url.value.trim()) { err.textContent = 'Add the content ID shown on the video label, or a link to it.'; return; }
      const rec = await put('reports', {
        id: uid('report'),
        contentId: id.value.trim().toUpperCase(),
        url: url.value.trim(),
        reason: reason.value,
        details: details.value.trim(),
        contact: contact.value.trim(),
        status: 'received',
      });
      await api.submitReport(rec);
      toast('Report received. Our team reviews impersonation reports first.', 'success');
      close(rec);
    } },
      h('p', { class: 'muted' }, 'Every video made here carries a visible label with a content ID. Reports on impersonation and non-consensual content are prioritized, and the creator\'s account is suspended while we review.'),
      h('label', { class: 'field' }, h('span', {}, 'Content ID'), id),
      h('label', { class: 'field' }, h('span', {}, 'Link'), url),
      h('label', { class: 'field' }, h('span', {}, 'Reason'), reason),
      h('label', { class: 'field' }, h('span', {}, 'Details'), details),
      h('label', { class: 'field' }, h('span', {}, 'Contact'), contact),
      err,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn danger' }, 'Submit report')));
  });
}

// Daily generation limits per plan, a basic brake on mass abuse.
const DAILY_LIMIT = { free: 5, creator: 50, studio: 300 };
export async function checkRateLimit() {
  const plan = getSettings().plan;
  const since = Date.now() - 24 * 3600 * 1000;
  const recent = (await all('exports')).filter(e => e.createdAt > since).length;
  const limit = DAILY_LIMIT[plan] ?? 5;
  return { ok: recent < limit, used: recent, limit };
}
