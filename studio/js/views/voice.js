import { h, icon, toast, modal, fmtTime, fmtDate, dropzone } from '../ui.js';
import { put, all, remove, uid, blobUrl, onChange, getSettings } from '../store.js';
import { requestConsent, voiceConsentPhrase } from '../safety.js';
import { api } from '../api.js';
import {
  startRecording, decode, peaks, drawWave, analyzeVoice, browserVoices,
  speakPreview, generateSpeech, EMOTIONS, TONES,
  audioFromVideo, bestSpeechWindow, encodeWavSegment,
} from '../voice.js';
import { MAX_SCRIPT_CHARS } from '../elevenlabs.js';

const MIN_SECONDS = 10;
const MAX_VIDEO_SAMPLE = 120;

function words(s) { return s.toLowerCase().replace(/[^a-zÀ-ɏ' ]/g, ' ').split(/\s+/).filter(w => w.length > 2); }

/**
 * A mic recorder button that also listens for the consent statement where the
 * browser supports speech recognition. onStop(blob, verified|null).
 */
function consentRecorder({ label, phraseFor, beforeStart, onStop, maxSeconds = 180 }) {
  const btn = h('button', { class: 'btn primary', type: 'button' }, icon('record'), label);
  const status = h('div', { class: 'row small muted' });
  let rec = null, timer = null, recognition = null, heard = '';
  btn.addEventListener('click', async () => {
    if (rec) {
      clearInterval(timer);
      recognition?.stop();
      const blob = await rec.stop();
      rec = null;
      btn.replaceChildren(icon('record'), 'Record again');
      // true: statement heard · false: heard speech, but not the statement ·
      // null: recognition unavailable or returned nothing (offline, unsupported language).
      let verified = null;
      const got = new Set(words(heard));
      if (recognition && got.size) {
        const target = new Set(words(phraseFor()));
        verified = [...target].filter(w => got.has(w)).length / target.size >= 0.6;
      }
      status.replaceChildren(verified === true
        ? h('span', { class: 'badge ok' }, icon('check', 12), 'Consent statement verified')
        : verified === false
          ? h('span', { class: 'badge warn' }, 'We couldn\'t hear the consent statement clearly. Record again and read it word for word.')
          : h('span', { class: 'badge' }, 'Your browser can\'t check the statement automatically. You\'ll confirm it when you sign.'));
      onStop(blob, verified);
      return;
    }
    if (beforeStart && !beforeStart()) return;
    try { rec = await startRecording(); } catch {
      toast('Microphone access was blocked. Allow it in your browser\'s site settings.', 'error');
      return;
    }
    heard = '';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = null;
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
    btn.replaceChildren(icon('stop'), 'Stop');
    const data = new Uint8Array(rec.analyser.fftSize);
    timer = setInterval(() => {
      rec.analyser.getByteTimeDomainData(data);
      let m = 0; for (const v of data) m = Math.max(m, Math.abs(v - 128));
      status.replaceChildren(h('span', { class: 'rec-dot' }), h('span', {}, `Recording ${fmtTime(rec.elapsed())}`),
        h('span', { class: 'meter', style: { width: '120px', marginTop: 0 } }, h('i', { style: { width: `${Math.min(100, m / 0.9)}%` } })));
      if (rec.elapsed() > maxSeconds) btn.click();
    }, 120);
  });
  return { btn, status, cancel: () => { clearInterval(timer); recognition?.stop(); rec?.cancel(); rec = null; } };
}

/**
 * The "create a voice model" flow. The sample comes from the mic, a video's
 * soundtrack, or an audio file. Video and file samples also need a live
 * recording of the consent statement, which must match the sample's speaker.
 * Calls onCreated(voiceRecord).
 */
export function voiceCreator(onCreated) {
  const name = h('input', { type: 'text', placeholder: 'e.g. My narration voice', value: `${getSettings().displayName}'s voice` });
  const speaker = h('input', { type: 'text', placeholder: 'Your full name', autocomplete: 'name' });
  const phraseText = () => voiceConsentPhrase(speaker.value.trim());
  const needName = () => {
    if (speaker.value.trim().length >= 3) return true;
    toast('Enter your full name first. It goes in the consent statement.', 'error');
    speaker.focus();
    return false;
  };

  const sourceChips = h('div', { class: 'chips' });
  const sourceArea = h('div', { class: 'stack' });
  const consentArea = h('div', { class: 'stack' });
  const wave = h('canvas', { class: 'wave' });
  const player = h('audio', { controls: true, hidden: true, style: { width: '100%' } });
  const analysisBox = h('div', { class: 'small muted' });
  const createBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('sparkle'), 'Create voice clone');
  const providerNote = h('div');

  let source = 'record';
  let sample = null, sampleInfo = null, phraseVerified = null;
  let consentClip = null, consentInfo = null, consentVerified = null;
  let removeNoise = false;
  const recorders = [];

  function canCreate() {
    if (!sample || !sampleInfo || sampleInfo.voicedSeconds < MIN_SECONDS) return false;
    if (source === 'record') return phraseVerified !== false;
    return !!consentClip && consentVerified !== false && speakersMatch();
  }
  function speakersMatch() {
    if (!consentInfo || !sampleInfo) return true;
    const ratio = Math.max(consentInfo.f0, sampleInfo.f0) / Math.min(consentInfo.f0, sampleInfo.f0);
    return ratio <= 1.45;
  }
  const refresh = () => { createBtn.disabled = !canCreate(); drawConsent(); };

  async function setSample(blob, src) {
    sample = blob;
    player.src = URL.createObjectURL(blob);
    player.hidden = false;
    try {
      const buf = await decode(blob);
      const pk = peaks(buf, 140);
      drawWave(wave, pk);
      sampleInfo = { ...analyzeVoice(buf), peaks: pk, source: src };
      const a = sampleInfo;
      const qualityMsg = {
        good: h('span', { class: 'badge ok' }, 'Good quality'),
        short: h('span', { class: 'badge warn' }, `Only ${a.voicedSeconds}s of speech. ${MIN_SECONDS}s minimum, 30s+ recommended`),
        clipping: h('span', { class: 'badge warn' }, 'Too loud, the audio is clipping'),
        quiet: h('span', { class: 'badge warn' }, 'Very quiet'),
      }[a.quality];
      analysisBox.replaceChildren(h('div', { class: 'row' }, qualityMsg,
        h('span', {}, `Length ${fmtTime(a.duration)}`), h('span', {}, `Speech ${Math.round(a.voicedSeconds)}s`), h('span', {}, `Pitch ≈ ${a.f0} Hz`)));
    } catch {
      sampleInfo = null;
      analysisBox.textContent = 'We could not read this audio. Try MP3, WAV, M4A or WebM.';
    }
    refresh();
  }

  function clearSample() {
    sample = null; sampleInfo = null; phraseVerified = null;
    player.hidden = true; player.removeAttribute('src');
    analysisBox.replaceChildren();
    wave.getContext('2d').clearRect(0, 0, wave.width, wave.height);
    refresh();
  }

  // --- source: microphone (the statement is part of the sample) ---
  function micSource() {
    const r = consentRecorder({ label: 'Record sample', phraseFor: phraseText, beforeStart: needName,
      onStop: (blob, verified) => { phraseVerified = verified; setSample(blob, 'recording'); } });
    recorders.push(r);
    return [
      h('div', { class: 'phrase' }, h('span', { class: 'muted small' }, 'Read this aloud first, then keep talking naturally for 30+ seconds:'), h('br'), h('mark', {}, `“${phraseText()}”`)),
      h('div', { class: 'row' }, r.btn), r.status,
    ];
  }

  // --- source: a video's soundtrack ---
  function videoSource() {
    const box = h('div', { class: 'stack' });
    const pick = dropzone({ accept: 'video/*', label: 'Upload a video of you talking', hint: 'Vlog, interview, presentation… one speaker, little music. MP4, MOV or WebM.', onFile: load });
    box.append(pick);
    async function load(file) {
      box.replaceChildren(h('p', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Extracting the audio…'));
      let buf;
      try { buf = await audioFromVideo(file); } catch (e) { toast(e.message, 'error'); box.replaceChildren(pick); return; }
      removeNoise = true;
      const full = h('canvas', { class: 'wave', style: { height: '64px' } });
      const sel = h('div', { style: { position: 'absolute', top: 0, bottom: 0, background: '#8b7bff33', border: '1px solid var(--accent)', borderRadius: '6px', pointerEvents: 'none' } });
      const waveWrap = h('div', { style: { position: 'relative' } }, full, sel);
      const len0 = Math.min(60, Math.max(MIN_SECONDS, Math.floor(buf.duration)));
      let len = Math.min(len0, buf.duration);
      let start = bestSpeechWindow(buf, len);
      const startIn = h('input', { type: 'range', min: '0', step: '0.5' });
      const lenIn = h('input', { type: 'range', min: String(Math.min(MIN_SECONDS, buf.duration)), max: String(Math.min(MAX_VIDEO_SAMPLE, buf.duration)), step: '1', value: String(len) });
      const startOut = h('output'), lenOut = h('output');
      let encTimer = null;
      const update = (encode = true) => {
        start = Math.min(start, Math.max(0, buf.duration - len));
        startIn.max = String(Math.max(0, buf.duration - len));
        startIn.value = String(start);
        startOut.textContent = fmtTime(start);
        lenOut.textContent = `${Math.round(len)}s`;
        sel.style.left = `${start / buf.duration * 100}%`;
        sel.style.width = `${len / buf.duration * 100}%`;
        if (!encode) return;
        clearTimeout(encTimer);
        encTimer = setTimeout(async () => setSample(await encodeWavSegment(buf, start, start + len, { name: 'video-voice.wav' }), 'video'), 250);
      };
      startIn.addEventListener('input', () => { start = +startIn.value; update(); });
      lenIn.addEventListener('input', () => { len = +lenIn.value; update(); });
      const noise = h('input', { type: 'checkbox', checked: true, onchange: (e) => { removeNoise = e.target.checked; } });
      box.replaceChildren(
        h('div', { class: 'row between' }, h('span', { class: 'small' }, icon('film', 14), ' ', file.name, h('span', { class: 'dim' }, ` · ${fmtTime(buf.duration)}`)),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { clearSample(); box.replaceChildren(pick); } }, 'Change video')),
        waveWrap,
        h('div', { class: 'kv' }, h('span', {}, 'Start'), startIn, startOut, h('span', {}, 'Length'), lenIn, lenOut),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { start = bestSpeechWindow(buf, len); update(); } }, icon('sparkle', 14), 'Find the clearest speech'),
          h('span', { class: 'small dim' }, 'Pick a part where only you are talking.')),
        h('label', { class: 'check' }, noise, h('span', {}, 'Isolate the voice (remove background music and noise)')));
      requestAnimationFrame(() => drawWave(full, peaks(buf, 220)));
      update();
    }
    return [box];
  }

  // --- source: an audio file ---
  function fileSource() {
    return [dropzone({ accept: 'audio/*', label: 'Upload a voice recording', hint: 'MP3, WAV, M4A or WebM · 30 seconds to 3 minutes · just you talking', onFile: (f) => { removeNoise = false; setSample(f, 'upload'); } })];
  }

  // Video and file samples need a fresh spoken consent from the person at the mic.
  function drawConsent() {
    if (source === 'record') { consentArea.replaceChildren(); return; }
    if (!consentArea.firstChild) {
      const r = consentRecorder({ label: 'Record consent statement', phraseFor: phraseText, beforeStart: needName, maxSeconds: 30,
        onStop: async (blob, verified) => {
          consentClip = new File([blob], 'consent-statement.webm', { type: blob.type });
          consentVerified = verified;
          try { consentInfo = analyzeVoice(await decode(blob)); } catch { consentInfo = null; }
          refresh();
        } });
      recorders.push(r);
      consentArea.append(
        h('h4', { style: { margin: '6px 0 0' } }, 'Confirm it\'s your voice'),
        h('div', { class: 'phrase' }, h('span', { class: 'muted small' }, 'Record yourself reading this. It must be the same voice as the sample:'), h('br'), h('mark', { class: 'consent-phrase' }, `“${phraseText()}”`)),
        h('div', { class: 'row' }, r.btn), r.status, h('div', { class: 'match' }));
    }
    consentArea.querySelector('.consent-phrase').textContent = `“${phraseText()}”`;
    const match = consentArea.querySelector('.match');
    match.replaceChildren(!consentClip || !consentInfo || !sampleInfo ? '' : speakersMatch()
      ? h('span', { class: 'badge ok' }, icon('check', 12), 'Voices match')
      : h('span', { class: 'badge warn' }, 'This doesn\'t sound like the same person as the sample. You can only clone your own voice, or one you have permission to use. If that person isn\'t at the mic, they need to record the statement themselves.'));
  }

  function drawSource() {
    recorders.splice(0).forEach(r => r.cancel());
    consentArea.replaceChildren();
    clearSample();
    sourceChips.replaceChildren(...[['record', 'mic', 'Record with mic'], ['video', 'film', 'From a video'], ['file', 'upload', 'Upload audio']].map(([k, ic, l]) =>
      h('button', { type: 'button', class: `chip${source === k ? ' on' : ''}`, onclick: () => { if (source !== k) { source = k; drawSource(); } } }, icon(ic, 14), l)));
    sourceArea.replaceChildren(...{ record: micSource, video: videoSource, file: fileSource }[source]());
    drawConsent();
  }
  speaker.addEventListener('input', () => { if (source === 'record') sourceArea.querySelector('.phrase mark').textContent = `“${phraseText()}”`; else drawConsent(); });

  function drawProvider() {
    const p = api.voiceProvider;
    providerNote.replaceChildren(p === 'local'
      ? h('div', { class: 'notice warn' }, icon('mic'), h('span', {}, 'Real voice cloning isn\'t switched on yet. ', h('a', { href: '#/dashboard/account' }, 'Add your ElevenLabs API key'), ' to make a clone that sounds like you. Without it you get a preview profile that uses this browser\'s built-in voice.'))
      : h('div', { class: 'notice' }, icon('shield'), h('span', {}, p === 'elevenlabs'
        ? 'Your sample and consent recording are sent to ElevenLabs to train your private voice clone.'
        : 'Your sample is sent to your AI backend to train your voice clone.')));
    createBtn.replaceChildren(icon('sparkle'), p === 'local' ? 'Create preview voice' : 'Create voice clone');
  }

  createBtn.addEventListener('click', async () => {
    if (!canCreate()) return;
    createBtn.disabled = true;
    try {
      const fileForConsent = sample instanceof File ? sample : new File([sample], 'voice-sample.webm', { type: sample.type });
      const consent = await requestConsent('voice', fileForConsent, { suggestedLabel: speaker.value.trim() });
      if (!consent) return;
      if (consent.relation === 'self' && consent.subjectName.toLowerCase() !== speaker.value.trim().toLowerCase()) {
        toast('Your signature must match the name in the consent statement.', 'error');
        return;
      }
      createBtn.replaceChildren(h('span', { class: 'spinner' }), api.voiceProvider === 'local' ? 'Saving…' : 'Cloning your voice…');
      const files = [fileForConsent, ...(consentClip ? [consentClip] : [])];
      const remote = await api.cloneVoice(files, {
        name: name.value.trim() || 'My voice',
        consentId: consent.id,
        removeNoise,
        description: `Created in Visage Studio by ${consent.signature} (${consent.relation === 'self' ? 'own voice' : 'with permission'}).`,
      });
      const { peaks: pk, ...profile } = sampleInfo;
      const rec = await put('voices', {
        id: uid('voice'),
        name: name.value.trim() || 'My voice',
        sample,
        consentClip,
        profile,
        peaks: pk,
        remoteId: remote?.voiceId || null,
        provider: remote?.provider || 'local',
        requiresVerification: !!remote?.requiresVerification,
        consentId: consent.id,
        phraseVerified: source === 'record' ? phraseVerified : consentVerified,
        sampleSource: source,
        defaults: { speed: 1, emotion: 'neutral', tone: 'natural' },
      });
      toast(remote ? 'Your voice clone is ready. Type a script to hear it.' : 'Preview voice saved.', 'success');
      if (remote?.requiresVerification) toast('ElevenLabs asks you to verify this voice in your ElevenLabs account before using it.', 'info');
      onCreated?.(rec);
    } catch (e) {
      toast(`Couldn't create the voice: ${e.message}`, 'error');
    } finally {
      createBtn.disabled = !canCreate();
      drawProvider();
    }
  });

  const root = h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', {}, 'Voice name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Your full name'), speaker)),
    h('div', { class: 'field' }, h('span', {}, 'Where should we get your voice from?'), sourceChips),
    sourceArea,
    h('div', { class: 'stack', style: { gap: '8px' } }, wave, player, analysisBox),
    consentArea,
    providerNote,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, createBtn));
  drawSource();
  drawProvider();
  root.cleanup = () => recorders.forEach(r => r.cancel());
  return root;
}

/** Text-to-speech panel. Returns { el, getOptions }. */
export function speechPanel(voice, { script = '', onGenerated } = {}) {
  const opts = { ...(voice.defaults || { speed: 1, emotion: 'neutral', tone: 'natural' }) };
  const text = h('textarea', { rows: 5, placeholder: 'Type what you want your voice to say…', maxlength: voice.remoteId ? String(MAX_SCRIPT_CHARS) : null }, script);
  const counter = h('span');
  const count = () => { counter.textContent = `${text.value.length.toLocaleString()} / ${MAX_SCRIPT_CHARS.toLocaleString()} characters`; };
  text.addEventListener('input', count);
  count();
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
    !voice.remoteId && h('div', { class: 'notice warn' }, icon('sparkle'), h('span', {}, 'This is a preview voice: the browser\'s built-in voice, tuned to your pitch and pace. It won\'t sound like you. For a real clone, ', h('a', { href: '#/dashboard/account' }, 'add your ElevenLabs API key'), ' and create the voice again.')),
    voice.remoteId && h('p', { class: 'small dim', style: { margin: 0 } }, counter),
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
          h('span', { class: 'small muted' }, `${voiceKind(v)} · ${fmtDate(v.createdAt)}`),
          h('span', {}, v.phraseVerified ? h('span', { class: 'badge ok' }, icon('shield', 12), 'Spoken consent verified') : h('span', { class: 'badge ok' }, icon('shield', 12), 'Consent signed'))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); audio.paused ? audio.play() : audio.pause(); } }, icon('play', 14), 'Sample'),
          h('button', { class: 'btn sm ghost', 'aria-label': 'Delete voice', onclick: async (e) => { e.stopPropagation(); await deleteVoice(v); } }, icon('trash', 14))));
    }));
    if (!voices.length) list.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, h('h3', {}, 'No voice models yet'), h('p', {}, 'Record a sample on the left to make your first one.')));
  }

  const creator = voiceCreator(v => { showPlayground(v); });
  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'AI Voice Clone'), h('p', { class: 'muted' }, 'Record your voice once, then turn any script into speech that sounds like you.'))),
    h('div', { class: 'split' },
      h('div', {},
        h('div', { class: 'card' }, h('h3', {}, 'Create a voice model'), creator),
        h('div', { class: 'card' }, h('h3', {}, 'Your voices'), list)),
      playground)));
  showPlayground(null);
  await refresh();
  const off = onChange(s => s === 'voices' && refresh());
  return () => { off(); panel?.stop(); creator.cleanup(); };
}

export async function pickOrCreateVoice() {
  let el;
  const v = await modal('Create a voice model', (close) => (el = voiceCreator(r => close(r))), { wide: true });
  el?.cleanup();
  return v;
}

export function voiceKind(v) {
  return v.provider === 'elevenlabs' ? 'ElevenLabs clone' : v.remoteId ? 'Neural clone' : 'Preview voice';
}

/** Deletes a voice here and, for real clones, at the provider too. */
export async function deleteVoice(v) {
  if (!confirm(`Delete the voice "${v.name}"? ${v.remoteId ? 'The clone is also deleted from your voice provider. ' : ''}This can't be undone.`)) return false;
  if (v.remoteId) {
    try { await api.deleteVoice(v); }
    catch (e) {
      if (!confirm(`We couldn't delete the clone at the provider (${e.message}). Remove it from Visage anyway? You can delete it in your provider account later.`)) return false;
    }
  }
  await remove('voices', v.id);
  return true;
}
