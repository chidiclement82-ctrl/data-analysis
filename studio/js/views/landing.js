import { h, icon } from '../ui.js';
import { openReportDialog } from '../safety.js';

const STEPS = ['Upload', 'Choose face', 'Choose voice', 'Edit', 'Generate', 'Preview', 'Export'];

function feature(ic, title, text, items, href) {
  return h('a', { class: 'feature', href },
    h('span', { class: 'ico' }, icon(ic, 22)),
    h('h3', {}, title),
    h('p', { class: 'muted', style: { margin: 0 } }, text),
    h('ul', {}, items.map(i => h('li', {}, i))));
}

function plan(name, price, blurb, items, featured) {
  return h('div', { class: `plan${featured ? ' featured' : ''}` },
    h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, name), featured && h('span', { class: 'badge ai' }, 'Most popular')),
    h('div', { class: 'price' }, price, h('small', {}, price === '$0' ? '' : ' / month')),
    h('p', { class: 'muted small', style: { margin: 0 } }, blurb),
    h('ul', {}, items.map(i => h('li', {}, icon('check', 14), i))),
    h('a', { class: `btn ${featured ? 'primary' : ''}`, href: `#/dashboard/account?plan=${name.toLowerCase()}` }, price === '$0' ? 'Start free' : `Choose ${name}`));
}

export function renderLanding(app) {
  const flow = h('div', { class: 'flow' });
  STEPS.forEach((s, i) => {
    if (i) flow.append(h('i', {}, '→'));
    flow.append(h('span', {}, h('b', {}, i + 1), s));
  });

  app.append(
    h('section', { class: 'hero' },
      h('span', { class: 'eyebrow' }, icon('shield', 14), 'Consent-first AI video. Every result is labeled.'),
      h('h1', {}, 'Star in any video, ', h('span', { class: 'grad-text' }, 'in your own voice.')),
      h('p', { class: 'lead' }, 'Upload a selfie and a short voice sample. Visage puts your face into the video, keeps every movement and expression, and speaks your script in your voice. No editing experience needed.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary lg', href: '#/create' }, icon('sparkle'), 'Create your first video'),
        h('a', { class: 'btn lg', href: '#/face-swap' }, 'Try a quick face swap')),
      flow),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'Everything in one studio'),
        h('p', { class: 'muted' }, 'Four tools that work together, so a finished video takes minutes.')),
      h('div', { class: 'features' },
        feature('face', 'AI Face Swap', 'Put your face on anyone in a video while their motion stays intact.',
          ['Automatic face detection and tracking', 'Keeps head turns, tilt and lighting', 'Original mouth movement preserved', 'Before / after slider'], '#/face-swap'),
        feature('mic', 'AI Voice Clone', 'Record 30 seconds and get a voice model that sounds like you.',
          ['Record in the browser or upload', 'Type a script, hear it in your voice', 'Adjust speed, emotion and tone'], '#/voice'),
        feature('film', 'AI Video Creator', 'Pick a video, a saved face and a saved voice, then type what to say.',
          ['Guided 7-step flow', 'Auto subtitles from your script', 'One-click generate'], '#/create'),
        feature('scissors', 'Video Editor', 'Polish the result without learning a pro editor.',
          ['Trim and cut', 'Subtitles, text and transitions', 'Music, sound effects and volume', 'Export in HD (720p / 1080p)'], '#/editor'))),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'Built so it can\'t be used against you'),
        h('p', { class: 'muted' }, 'Face swapping and voice cloning are powerful. These protections are always on.')),
      h('div', { class: 'safety-band' },
        h('div', {}, h('b', {}, 'Consent before upload'), 'Every face, voice and source video needs a signed confirmation that it\'s yours or that you have permission.'),
        h('div', {}, h('b', {}, 'Spoken voice consent'), 'Voice models start from a recording of you reading a consent statement, which blocks cloning from someone else\'s clips.'),
        h('div', {}, h('b', {}, 'Always labeled'), 'An "AI-generated" label and a traceable content ID are burned into every exported frame.'),
        h('div', {}, h('b', {}, 'Public figures protected'), 'Uploads matching protected public figures are blocked without verified authorization.'),
        h('div', {}, h('b', {}, 'Report in one click'), 'Anyone can report a video by its content ID. Impersonation reports are reviewed first.'),
        h('div', {}, h('b', {}, 'Rate limits'), 'Daily generation limits per plan slow down mass misuse.')),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px' } },
        h('a', { class: 'btn', href: '#/safety' }, 'Read the content policy'),
        h('button', { class: 'btn ghost', onclick: () => openReportDialog() }, icon('flag'), 'Report a video'))),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Simple pricing'), h('p', { class: 'muted' }, 'Start free. Upgrade when you need HD and more videos.')),
      h('div', { class: 'pricing' },
        plan('Free', '$0', 'Try every tool.', ['5 videos per day', '720p export', '1 voice model', 'Visible AI label'], false),
        plan('Creator', '$19', 'For regular creators.', ['50 videos per day', '1080p HD export', '5 voice models', 'Priority generation'], true),
        plan('Studio', '$59', 'For teams and agencies.', ['300 videos per day', '1080p HD export', 'Unlimited voice models', 'Team consent records'], false))),
  );
}
