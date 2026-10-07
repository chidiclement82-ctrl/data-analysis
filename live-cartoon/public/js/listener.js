// Hands-free listening: hears whatever people say and hands each sentence over
// once they pause. While the cartoon is busy (thinking or talking) and for a
// moment after, the mic is switched off so the cartoon never answers its own
// voice. Used by the stage (the phone that streams) and the control panel.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition);

export function createListener({
  lang = navigator.language || 'en-US',
  onHeard,               // (text) => void, a finished sentence worth answering
  onInterim = () => {},  // (text) => void, words so far, for showing on screen
  onState = () => {},    // ('listening' | 'paused' | 'off', note?) => void
  minWords = 3,          // "ok", "yes", "hmm" aren't questions
  echoGuardMs = 1800,    // keep the mic off this long after the cartoon stops
} = {}) {
  let active = false;
  let busy = false;
  let quietUntil = 0;
  let rec = null;
  let heard = '';
  let resumeTimer = 0;
  let unstick = 0; // in case the cartoon never reports back after we handed a sentence over

  const listening = () => active && !busy && Date.now() >= quietUntil;

  function hand() {
    const text = heard.trim();
    heard = '';
    if (!text || text.split(/\s+/).length < minWords || !listening()) return;
    busy = true; // until the cartoon has answered
    onState('paused');
    clearTimeout(unstick);
    unstick = setTimeout(() => setBusy(false), 30_000);
    onHeard(text);
  }

  function round() {
    if (!active || rec || busy) return;
    rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false; // one sentence per round; it stops by itself when they pause
    rec.onresult = (e) => {
      if (!listening()) { heard = ''; return; } // the cartoon's own voice, or mid-answer
      let interim = '';
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      heard = final || interim;
      onInterim(heard);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stop('Allow the microphone for this page (tap the lock icon in the address bar), then try again.');
      }
    };
    rec.onend = () => {
      rec = null;
      hand();
      if (active && !busy) setTimeout(round, 250); // listen for the next thing they say
    };
    try { rec.start(); } catch { rec = null; setTimeout(round, 1000); }
  }

  function start() {
    if (!canListen) {
      onState('off', 'Listening needs Google Chrome (Android or computer) or Microsoft Edge.');
      return false;
    }
    active = true;
    onState(busy ? 'paused' : 'listening');
    round();
    return true;
  }

  function stop(note) {
    active = false;
    clearTimeout(resumeTimer);
    try { rec?.abort(); } catch { /* already stopped */ }
    rec = null;
    heard = '';
    onState('off', note);
  }

  // Tell the listener whether the cartoon is thinking or talking.
  function setBusy(nowBusy) {
    clearTimeout(unstick);
    if (nowBusy === busy) return;
    busy = nowBusy;
    clearTimeout(resumeTimer);
    if (busy) {
      try { rec?.abort(); } catch { /* stopped */ } // don't hear the cartoon
      if (active) onState('paused');
    } else {
      quietUntil = Date.now() + echoGuardMs;
      resumeTimer = setTimeout(() => { if (active) { onState('listening'); round(); } }, echoGuardMs);
    }
  }

  return {
    start,
    stop,
    setBusy,
    resume: () => { if (active) round(); }, // e.g. when the page comes back into view
    get active() { return active; },
  };
}
