import { h, icon, toast, dropzone, fmtDate, modal } from '../ui.js';
import { get, all } from '../store.js';
import { mountEditor } from '../editor.js';
import { addSourceVideo } from '../library.js';
import { createProject, saveProject } from '../projects.js';
import { generateBlock, downloadButton } from '../exportui.js';
import { navigate } from '../app.js';

export async function renderEditorPage(app, { args, params }) {
  const page = h('div', { class: 'page' });
  app.append(page);
  const id = args[0];

  if (!id) {
    const projects = await all('projects');
    page.append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Video Editor'), h('p', { class: 'muted' }, 'Trim, add subtitles, music, text and transitions, then export in HD.'))),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('h3', {}, 'Start from a new video'),
          dropzone({ accept: 'video/*', label: 'Upload a video to edit', hint: 'MP4, MOV or WebM · up to 5 minutes', onFile: async (f) => {
            const v = await addSourceVideo(f);
            if (!v) return;
            const p = await createProject({ sourceVideoId: v.id });
            navigate(`editor/${p.id}`);
          } })),
        h('div', { class: 'card' }, h('h3', {}, 'Open a project'),
          projects.length
            ? h('div', { class: 'list' }, projects.map(p => h('a', { class: 'list-item', href: `#/editor/${p.id}`, style: { textDecoration: 'none' } },
                h('div', { class: 'row' }, p.thumb && h('img', { src: p.thumb, alt: '', style: { width: '64px', borderRadius: '6px' } }), h('div', {}, h('b', {}, p.name), h('div', { class: 'small muted' }, fmtDate(p.updatedAt)))),
                icon('arrow'))))
            : h('p', { class: 'muted' }, 'No projects yet.'))));
    return;
  }

  const project = await get('projects', id);
  if (!project) { page.append(h('div', { class: 'empty' }, h('h3', {}, 'Project not found'), h('a', { class: 'btn', href: '#/editor' }, 'Back to editor'))); return; }

  const nameInput = h('input', { type: 'text', value: project.name, 'aria-label': 'Project name', style: { fontSize: '22px', fontWeight: 700, background: 'transparent', border: '1px solid transparent', padding: '4px 8px', maxWidth: '460px' },
    onchange: (e) => { project.name = e.target.value.trim() || 'Untitled video'; saveProject(project); } });

  const exportBtn = h('button', { class: 'btn primary' }, icon('download'), 'Export');
  page.append(h('div', { class: 'page-head' },
    h('div', {}, nameInput, h('p', { class: 'muted small', style: { paddingLeft: '8px' } }, 'Changes save automatically.')),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `#/create/${project.id}` }, 'Open in guided mode'), exportBtn)));
  const holder = h('div');
  page.append(holder);
  const editor = await mountEditor(holder, project, { initialTab: params.tab || 'trim' });

  exportBtn.addEventListener('click', () => {
    editor.player?.pause();
    modal('Export video', (close) => {
      const result = h('div');
      return h('div', { class: 'stack' },
        h('p', { class: 'muted', style: { margin: 0 } }, 'Your video is rendered in real time on this device, with the AI-generated label and content ID ', h('b', {}, project.contentId), ' included.'),
        generateBlock(project, { label: 'Render & export', onDone: (rec) => {
          result.replaceChildren(h('div', { class: 'stack' },
            h('video', { src: URL.createObjectURL(rec.blob), controls: true, style: { width: '100%', borderRadius: '12px' } }),
            h('div', { class: 'row' }, downloadButton(rec), h('button', { class: 'btn ghost', onclick: () => close() }, 'Close'))));
        } }),
        result);
    }, { wide: true });
  });

  if (project.edit.faceSwap.enabled && !project.edit.faceSwap.track && project.faceId) {
    toast('Open the Face swap tab and press "Detect & swap face" to see your face in the video.');
  }
  return () => editor.destroy();
}
