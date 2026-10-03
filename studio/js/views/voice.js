import { h, icon, toast, modal, fmtTime, fmtDate, dropzone } from '../ui.js';
import { put, all, remove, uid, blobUrl, onChange, getSettings } from '../store.js';
import { requestConsent, voiceConsentPhrase } from '../safety.js';
import { api } from '../api.js';
import {
  startRecording, decode, peaks, drawWave, analyzeVoice, browserVoices,
  speakPreview, generateSpeech, EMOTIONS, TONES,
} from '../voice.js';

const MIN_SECONDS = 10;

function words(s) { return s.toLowerCase().replace(/[^a-zÀ-ɏ' ]/g, ' ').split(/\s+/).filter(w => w.length > 2); }

/**
 * The "create a voice model" flow: record (with the spoken consent statement)
 * or upload, review the sample, sign consent, then build the model.
 * Calls onCreated(voiceRecord).
 */
export function voiceCreator(onCreated) {
  const name = h('input', { type: 'text', placeholder: 'e.g. My narration voice', value: `${getSettings().displayName}'s voice` });
  const speaker = h('input', { type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const phrase = h('div', { class: 'phrase' });
  const updatePhrase = () => { phrase.replaceChildren(h('span', { class: 'muted small' }, 'Start by reading this aloud, then keep talking naturally for 20+ seconds:'), h('br'), h('mark', {}, `“${voiceConsentPhrase(speaker.value.trim())}”`)); };
  speaker.addEventListener('input', updatePhrase);
  updatePhrase();

  const status = h('div', { class: 'row small muted' });
  const wave = h('canvas', { class: 'wave' });
  const recBtn = h('button', { class: 'btn primary', type: 'button' }, icon('record'), 'Record sample');
  const player = h('audio', { controls: true, hidden: true, style: { width: '100%' } });
  const createBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('sparkle'), 'Create voice model');
  const analysisBox = h('div', { class: 'small muted' });

  let sample = null, sampleSource = null, phraseVerified = false, recorder = null, timer = null, recognition = null, heard = '';

  async function setSample(blob, source) {
    sample = blob; sampleSource = source;
    player.src = URL.createObjectURL(blob);
    player.hidden = false;
    try {
      const buf = await decode(blob);
      const pk = peaks(buf, 140);
      drawWave(wave, pk);
      const a = analyzeVoice(buf);
      sample.analysis = a;
      sample.peaks = pk;
      const qualityMsg = {
        good: h('span', { class: 'badge ok' }, 'Good quality'),
        short: h('span', { class: 'badge warn' }, `Only ${a.voicedSeconds}s of speech. ${MIN_SECONDS}s minimum, 30s+ recommended`),
        clipping: h('span', { class: 'badge warn' }, 'Too loud, the audio is clipping. Move back from the mic'),
        quiet: h('span', { class: 'badge warn' }, 'Very quiet. Move closer to the mic'),
      }[a.quality];
      analysisBox.replaceChildren(h('div', { class: 'row' }, qualityMsg,
        h('span', {}, `Length ${fmtTime(a.duration)}`), h('span', {}, `Pitch ≈ ${a.f0} Hz`), h('span', {}, `Pace ${a.pace}/s`)));
      createBtn.disabled = a.voicedSeconds < MIN_SECONDS;
    } catch {
      analysisBox.textContent = 'We could not read this audio file. Try MP3, WAV, M4A or WebM.';
      createBtn.disabled = true;
    }
  }

  recBtn.addEventListener('click', async () => {
    if (recorder) {
      clearInterval(timer);
      recognition?.stop();
      const blob = await recorder.stop();
      recorder = null;
      recBtn.replaceChildren(icon('record'), 'Record again');
      // Did the speaker actually read the consent statement?
      if (recognition) {
        const target = new Set(words(voiceConsentPhrase(speaker.value.trim())));
        const got = new Set(words(heard));
        const hit = [...target].filter(w => got.has(w)).length;
        phraseVerified = hit / target.size >= 0.6;
        status.replaceChildren(phraseVerified
          ? h('span', { class: 'badge ok' }, icon('check', 12), 'Consent statement verified')
          : h('span', { class: 'badge warn' }, 'We couldn\'t hear the consent statement clearly. Record again and read it first.'));
      } else {
        phraseVerified = false;
        status.replaceChildren(h('span', { class: 'badge' }, 'Your browser can\'t check the statement automatically. You\'ll confirm it in the next step.'));
      }
      await setSample(blob, 'recording');
      return;
    }
    if (speaker.value.trim().length < 3) { toast('Enter your full name first. It goes in the consent statement.', 'error'); speaker.focus(); return; }
    try {
      recorder = await startRecording();
    } catch {
      toast('Microphone access was blocked. Allow it in your browser, or upload a recording instead.', 'error');
      return;
    }
    heard = '';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      try {
        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = navigator.language || 'en-US';
        recognition.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) heard += ' ' + e.results[i][0].transcript; };
        recognition.onerror = () => {};
        recognition.start();
      } catch { recognition = null; }
    }
    recBtn.replaceChildren(icon('stop'), 'Stop');
    const data = new Uint8Array(recorder.analyser.fftSize);
    timer = setInterval(() => {
      recorder.analyser.getByteTimeDomainData(data);
      let m = 0; for (const v of data) m = Math.max(m, Math.abs(v - 128));
      status.replaceChildren(h('span', { class: 'rec-dot' }), h('span', {}, `Recording ${fmtTime(recorder.elapsed())}`),
        h('span', { class: 'meter', style: { width: '120px', marginTop: 0 } }, h('i', { style: { width: `${Math.min(100, m / 0.9)}%` } })));
      if (recorder.elapsed() > 180) recBtn.click();
    }, 120);
  });

  createBtn.addEventListener('click', async () => {
    if (!sample) return;
    createBtn.disabled = true;
    try {
      const consent = await requestConsent('voice', new File([sample], 'voice-sample.webm', { type: sample.type }), { suggestedLabel: speaker.value.trim() });
      if (!consent) return;
      if (consent.relation === 'self' && speaker.value.trim() && consent.subjectName.toLowerCase() !== speaker.value.trim().toLowerCase()) {
        toast('The signature must match the name read in the consent statement.', 'error');
        return;
      }
      createBtn.replaceChildren(h('span', { class: 'spinner' }), 'Training voice…');
      const remote = await api.cloneVoice(sample, { name: name.value.trim(), consentId: consent.id });
      const rec = await put('voices', {
        id: uid('voice'),
        name: name.value.trim() || 'My voice',
        sample,
        profile: sample.analysis,
        peaks: sample.peaks,
        remoteId: remote?.voiceId || null,
        consentId: consent.id,
        phraseVerified,
        sampleSource,
        defaults: { speed: 1, emotion: 'neutral', tone: 'natural' },
      });
      toast('Voice model ready.', 'success');
      onCreated?.(rec);
    } catch (e) {
      toast(`Couldn't create the voice: ${e.message}`, 'error');
    } finally {
      createBtn.disabled = false;
      createBtn.replaceChildren(icon('sparkle'), 'Create voice model');
    }
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', {}, 'Voice name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Your full name'), speaker)),
    phrase,
    h('div', { class: 'row' }, recBtn, h('span', { class: 'dim small' }, 'or')),
    dropzone({ accept: 'audio/*', label: 'Upload a voice recording', hint: 'MP3, WAV, M4A or WebM · 30 seconds to 3 minutes · just you, no music', onFile: (f) => { phraseVerified = false; status.replaceChildren(h('span', { class: 'badge' }, 'Uploaded sample. Make sure it includes you reading the statement above.')); setSample(f, 'upload'); } }),
    status, wave, player, analysisBox,
    h('div', { class: 'row between' },
      h('span', { class: 'small dim' }, api.mode === 'cloud' ? 'Your sample is sent to your AI provider for neural cloning.' : 'In-browser engine: the sample stays on this device.'),
      createBtn));
}

/** Text-to-speech panel. Returns { el, getOptions }. */
export function speechPanel(voice, { script = '', onGenerated } = {}) {
  const opts = { ...(voice.defaults || { speed: 1, emotion: 'neutral', tone: 'natural' }) };
  const text = h('textarea', { rows: 5, placeholder: 'Type what you want your voice to say…' }, script);
  const speedOut = h('output', {}, `${opts.speed.toFixed(2)}×`);
  const speed = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: String(opts.speed), oninput: () => { opts.speed = +speed.value; speedOut.textContent = `${opts.speed.toFixed(2)}×`; } });
  const chips = (map, key) => {
    const wrapEl = h('div', { class: 'chips' });
    const draw = () => wrapEl.replaceChildren(...Object.entries(map).map(([k, v]) => h('button', { type: 'button', class: `chip${opts[key] === k ? ' on' : ''}`, onclick: () => { opts[key] = k; draw(); } }, v.label)));
    draw();
    return wrapEl;
  };
  const baseVoice = h('select', {});
  browserVoices().then(vs => {
    baseVoice.replaceChildren(...vs.map(v => h('option', { value: v.voiceURI, selected: v.voiceURI === voice.browserVoice }, `${v.name} (${v.lang})`)));
    if (!vs.length) baseVoice.append(h('option', {}, 'No speech voices in this browser'));
  });
  baseVoice.addEventListener('change', () => { voice.browserVoice = baseVoice.value; put('voices', voice); });

  const out = h('div', { class: 'stack' });
  const go = h('button', { class: 'btn primary', type: 'button' }, icon('play'), 'Generate speech');
  let speaking = null;
  go.addEventListener('click', async () => {
    if (!text.value.trim()) { toast('Type a script first.', 'error'); return; }
    if (speaking) { speaking.stop(); speaking = null; go.replaceChildren(icon('play'), 'Generate speech'); return; }
    go.disabled = true;
    try {
      const res = await generateSpeech(voice, text.value.trim(), opts);
      if (res.blob) {
        const url = URL.createObjectURL(res.blob);
        out.replaceChildren(h('audio', { controls: true, autoplay: true, src: url, style: { width: '100%' } }),
          h('a', { class: 'btn sm', href: url, download: `${voice.name}.mp3` }, icon('download', 14), 'Download audio'));
        onGenerated?.({ blob: res.blob, text: text.value.trim(), opts: { ...opts } });
      } else {
        go.replaceChildren(icon('stop'), 'Stop');
        speaking = await speakPreview(voice, text.value.trim(), opts, { onEnd: () => { speaking = null; go.replaceChildren(icon('play'), 'Generate speech'); } });
        onGenerated?.({ preview: true, text: text.value.trim(), opts: { ...opts } });
      }
    } catch (e) {
      toast(`Speech failed: ${e.message}`, 'error');
    } finally {
      go.disabled = false;
    }
  });

  const el = h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Script'), text),
    h('div', { class: 'kv' }, h('span', {}, 'Speed'), speed, speedOut),
    h('div', { class: 'field' }, h('span', {}, 'Emotion'), chips(EMOTIONS, 'emotion')),
    h('div', { class: 'field' }, h('span', {}, 'Tone'), chips(TONES, 'tone')),
    !voice.remoteId && h('label', { class: 'field' }, h('span', {}, 'Preview engine voice (closest match on this device)'), baseVoice),
    !voice.remoteId && h('div', { class: 'notice' }, icon('sparkle'), h('span', {}, 'Previewing with the in-browser engine, tuned to your pitch and pace. Connect an AI provider in Account settings to generate speech that sounds like you and can be downloaded or added to videos.')),
    h('div', { class: 'row' }, go),
    out);
  return { el, text, opts, stop: () => speaking?.stop() };
}

export async function renderVoice(app) {
  const list = h('div', { class: 'thumb-grid' });
  const playground = h('div', { class: 'card' });
  let selected = null;
  let panel = null;

  function showPlayground(voice) {
    selected = voice;
    panel?.stop();
    if (!voice) {
      playground.replaceChildren(h('h3', {}, 'Text to speech'), h('p', { class: 'muted' }, 'Create or select a voice model to start.'));
      return;
    }
    panel = speechPanel(voice, { script: 'Hi! This is my AI voice. I can read any script you type, with the emotion and pace you choose.' });
    playground.replaceChildren(h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Text to speech'), h('span', { class: 'badge ai' }, voice.name)), panel.el);
  }

  async function refresh() {
    const voices = await all('voices');
    if (!selected && voices[0]) showPlayground(voices[0]);
    if (selected && !voices.find(v => v.id === selected.id)) showPlayground(voices[0] || null);
    list.replaceChildren(...voices.map(v => {
      const c = h('canvas', { class: 'wave' });
      requestAnimationFrame(() => v.peaks && drawWave(c, v.peaks));
      const audio = new Audio(blobUrl(v.id, v.sample));
      return h('div', { class: `tile voice-tile selectable${selected?.id === v.id ? ' selected' : ''}`, onclick: () => { showPlayground(v); refresh(); } },
        h('span', { class: 'check-mark' }, icon('check', 14)),
        h('div', { class: 'media' }, c),
        h('div', { class: 'body' },
          h('span', { class: 'title' }, v.name),
          h('span', { class: 'small muted' }, `${v.remoteId ? 'Neural clone' : 'Local profile'} · ${fmtDate(v.createdAt)}`),
          h('span', {}, v.phraseVerified ? h('span', { class: 'badge ok' }, icon('shield', 12), 'Spoken consent verified') : h('span', { class: 'badge ok' }, icon('shield', 12), 'Consent signed'))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); audio.paused ? audio.play() : audio.pause(); } }, icon('play', 14), 'Sample'),
          h('button', { class: 'btn sm ghost', 'aria-label': 'Delete voice', onclick: async (e) => { e.stopPropagation(); if (confirm(`Delete the voice model "${v.name}"? This can't be undone.`)) await remove('voices', v.id); } }, icon('trash', 14))));
    }));
    if (!voices.length) list.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, h('h3', {}, 'No voice models yet'), h('p', {}, 'Record a sample on the left to make your first one.')));
  }

  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'AI Voice Clone'), h('p', { class: 'muted' }, 'Record your voice once, then turn any script into speech that sounds like you.'))),
    h('div', { class: 'split' },
      h('div', {},
        h('div', { class: 'card' }, h('h3', {}, 'Create a voice model'), voiceCreator(v => { showPlayground(v); })),
        h('div', { class: 'card' }, h('h3', {}, 'Your voices'), list)),
      playground)));
  showPlayground(null);
  await refresh();
  const off = onChange(s => s === 'voices' && refresh());
  return () => { off(); panel?.stop(); };
}

export function pickOrCreateVoice() {
  return modal('Create a voice model', (close) => voiceCreator(v => close(v)), { wide: true });
}
