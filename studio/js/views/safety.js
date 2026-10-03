import { h, icon, fmtDate } from '../ui.js';
import { all, onChange } from '../store.js';
import { openReportDialog, CONSENT_VERSION } from '../safety.js';

export async function renderSafety(app, { params }) {
  const reportsBox = h('div');
  const consentsBox = h('div');

  async function refresh() {
    const reports = await all('reports');
    reportsBox.replaceChildren(reports.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Content ID'), h('th', {}, 'Reason'), h('th', {}, 'Submitted'), h('th', {}, 'Status'))),
          h('tbody', {}, reports.map(r => h('tr', {}, h('td', {}, r.contentId || r.url || '—'), h('td', {}, r.reason), h('td', {}, fmtDate(r.createdAt)), h('td', {}, h('span', { class: 'badge warn' }, r.status)))))))
      : h('p', { class: 'muted small' }, 'You haven\'t filed any reports.'));
    const consents = await all('consents');
    consentsBox.replaceChildren(consents.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Subject'), h('th', {}, 'Basis'), h('th', {}, 'Signed'), h('th', {}, 'File fingerprint'))),
          h('tbody', {}, consents.map(c => h('tr', {},
            h('td', {}, c.kind), h('td', {}, c.subjectName), h('td', {}, c.relation === 'self' ? 'Own likeness' : 'Written permission'),
            h('td', {}, `${c.signature} · ${fmtDate(c.createdAt)}`), h('td', { class: 'dim small' }, c.fileHash ? c.fileHash.slice(0, 16) + '…' : 'recording'))))))
      : h('p', { class: 'muted small' }, 'No consent records yet. They are created whenever you add a face, voice or video.'));
  }

  const rule = (title, text) => h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted', style: { margin: 0 } }, text));

  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Trust & Safety'), h('p', { class: 'muted' }, `Content policy version ${CONSENT_VERSION}. These rules apply to every face, voice and video.`)),
      h('button', { class: 'btn danger', onclick: () => openReportDialog() }, icon('flag'), 'Report content')),
    h('div', { class: 'grid-2' },
      rule('Only your likeness, or with permission', 'You may upload your own face and voice, or someone else\'s with their written permission. You sign a consent statement for every upload, and we keep a fingerprint of the file with that record.'),
      rule('No impersonation', 'You may not make content that a reasonable viewer could mistake for a real person genuinely saying or doing something. Public figures are blocked unless they have authorized it through verification.'),
      rule('Prohibited content', 'Sexual or intimate content of real people, harassment, fraud, scams, election or news misinformation, and anything involving minors are banned and lead to immediate account termination.'),
      rule('Always labeled', 'A visible "AI-generated" label with a content ID is burned into every exported frame. Removing or cropping it out to deceive people breaks this policy.'),
      rule('Voice protection', 'A voice model can only be made from a sample that includes you reading the consent statement. Models are private to the account that created them.'),
      rule('Enforcement', 'Reports of impersonation or non-consensual content are reviewed first. The creator\'s account is paused while we review, and confirmed violations are removed and may be reported to authorities.')),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', {}, 'Your reports'), reportsBox),
    h('div', { class: 'card' }, h('h3', {}, 'Your consent records'), consentsBox),
  ));
  await refresh();
  const off = onChange(s => { if (s === 'reports' || s === 'consents') refresh(); });
  if (params.report) openReportDialog(params.id || '');
  return off;
}
