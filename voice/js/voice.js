/* Voice Reader: reads text aloud with the browser's own voices.
   Nothing is uploaded; the speech comes from the device (Web Speech API). */
(function () {
  "use strict";

  var SAMPLE =
    "Welcome to Voice Reader. Paste or type anything into the box, pick a voice you like, and press play.\n\n" +
    "You can slow it down, speed it up, or change the pitch. Tap any sentence while it's reading to jump straight to it. " +
    "Everything happens on your own device, so your text stays private.";
  var STORE_KEY = "voiceReader.v1";
  var MAX_CHUNK = 220;         // long sentences are split so no browser cuts them off
  var MAX_FILE = 1024 * 1024;  // 1 MB of text is plenty
  var MAX_SHARE = 4000;        // characters that fit comfortably in a link

  var synth = window.speechSynthesis;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    text: $("text"), reader: $("reader"), meta: $("meta"), status: $("status"),
    play: $("playBtn"), stop: $("stopBtn"), back: $("backBtn"), fwd: $("fwdBtn"),
    lang: $("langSelect"), voice: $("voiceSelect"),
    rate: $("rate"), pitch: $("pitch"), volume: $("volume"),
    rateOut: $("rateOut"), pitchOut: $("pitchOut"), volumeOut: $("volumeOut"),
    follow: $("follow"), progress: $("progressBar"), dome: $("dome"),
    file: $("fileInput")
  };

  var DEFAULTS = { rate: 1, pitch: 1, volume: 1, follow: true, voiceURI: "", lang: "" };
  var settings = Object.assign({}, DEFAULTS);
  var voices = [];

  // Playback state
  var chunks = [];       // [{start, end, text}] offsets into the source text
  var source = "";       // the text being read
  var idx = 0;           // current chunk
  var state = "idle";    // idle | playing | paused
  var token = 0;         // bumps on every (re)start so stale callbacks are ignored
  var current = null;    // keep a reference: Safari drops events of collected utterances
  var chunkEls = [];

  /* ---------- storage ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ settings: settings, text: el.text.value }));
    } catch (e) { /* private mode: fine */ }
  }
  var saveTimer;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

  /* ---------- text helpers ---------- */
  function words(s) { var m = s.match(/\S+/g); return m ? m.length : 0; }

  function fmtMinutes(wordCount) {
    var min = wordCount / (155 * settings.rate);
    if (wordCount === 0) return "";
    if (min < 1) return "under a minute";
    return "about " + Math.round(min) + " min";
  }

  function updateMeta() {
    var t = el.text.value;
    var w = words(t);
    var parts = [w + (w === 1 ? " word" : " words"), t.length + " characters"];
    var time = fmtMinutes(w);
    if (time) parts.push(time + " to listen");
    el.meta.textContent = parts.join(" · ");
  }

  // Split text into sentence-sized chunks, remembering where each sits in the text.
  function splitChunks(text) {
    var out = [];
    var pieces = [];
    if (window.Intl && Intl.Segmenter) {
      var seg = new Intl.Segmenter(settings.lang || undefined, { granularity: "sentence" });
      var it = seg.segment(text)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) {
        pieces.push({ start: r.value.index, end: r.value.index + r.value.segment.length });
      }
    } else {
      var re = /[^.!?\n]+(?:[.!?]+["')\]]*|\n+|$)/g, m;
      while ((m = re.exec(text)) && m[0].length) {
        pieces.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    pieces.forEach(function (p) {
      // Trim whitespace off both ends so highlights hug the words.
      var s = p.start, e = p.end;
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      while (e - s > MAX_CHUNK) {
        var cut = s + MAX_CHUNK;
        var slice = text.slice(s, cut);
        var at = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf("; "), slice.lastIndexOf(": "));
        if (at < MAX_CHUNK / 3) at = slice.lastIndexOf(" ");
        if (at > 0) cut = s + at + 1;
        out.push({ start: s, end: cut });
        s = cut;
        while (s < e && /\s/.test(text[s])) s++;
      }
      if (e > s) out.push({ start: s, end: e });
    });
    out.forEach(function (c) { c.text = text.slice(c.start, c.end); });
    return out.filter(function (c) { return /[\p{L}\p{N}]/u.test(c.text); });
  }

  /* ---------- reader view (highlighting) ---------- */
  function buildReader() {
    el.reader.textContent = "";
    chunkEls = [];
    var pos = 0;
    chunks.forEach(function (c, i) {
      if (c.start > pos) el.reader.appendChild(document.createTextNode(source.slice(pos, c.start)));
      var span = document.createElement("span");
      span.className = "s";
      span.dataset.i = i;
      span.textContent = c.text;
      el.reader.appendChild(span);
      chunkEls.push(span);
      pos = c.end;
    });
    if (pos < source.length) el.reader.appendChild(document.createTextNode(source.slice(pos)));
  }

  function showReader(on) {
    el.reader.hidden = !on;
    el.text.hidden = on;
    if (on) {
      el.reader.style.height = el.text.offsetHeight ? el.text.offsetHeight + "px" : "";
    }
  }

  function markChunk(i) {
    chunkEls.forEach(function (s, j) {
      if (j !== i && s.classList.contains("now")) {
        s.classList.remove("now");
        s.textContent = chunks[j].text;
      }
    });
    var span = chunkEls[i];
    if (!span) return;
    span.classList.add("now");
    span.textContent = chunks[i].text;
    if (settings.follow) scrollIntoReader(span);
  }

  function markWord(i, charIndex, charLength) {
    if (!settings.follow) return;
    var span = chunkEls[i];
    if (!span) return;
    var t = chunks[i].text;
    if (!charLength) {
      var m = /\S+/.exec(t.slice(charIndex));
      charLength = m ? m.index + m[0].length : 0;
    }
    if (!charLength) return;
    var w = document.createElement("span");
    w.className = "w";
    w.textContent = t.slice(charIndex, charIndex + charLength);
    span.textContent = "";
    span.appendChild(document.createTextNode(t.slice(0, charIndex)));
    span.appendChild(w);
    span.appendChild(document.createTextNode(t.slice(charIndex + charLength)));
  }

  function scrollIntoReader(node) {
    var box = el.reader;
    var top = node.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 20 || top > box.scrollTop + box.clientHeight - 60) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
    }
  }

  /* ---------- playback ---------- */
  function selectedVoice() {
    for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === el.voice.value) return voices[i];
    return null;
  }

  function speakFrom(i) {
    var my = ++token;
    synth.cancel();
    if (i >= chunks.length) { finish(); return; }
    idx = Math.max(0, i);
    state = "playing";
    markChunk(idx);
    updateUI();

    var u = new SpeechSynthesisUtterance(chunks[idx].text);
    var v = selectedVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = settings.rate;
    u.pitch = settings.pitch;
    u.volume = settings.volume;
    u.onboundary = function (e) {
      if (my !== token || e.name === "sentence") return;
      markWord(idx, e.charIndex, e.charLength);
    };
    u.onend = function () {
      if (my !== token || state !== "playing") return;
      speakFrom(idx + 1);
    };
    u.onerror = function (e) {
      if (my !== token) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      if (e.error === "not-allowed") {
        pause();
        setStatus("Tap Play to start reading (your browser needs a tap first).");
        return;
      }
      // Skip a chunk the voice can't read rather than stopping everything.
      speakFrom(idx + 1);
    };
    current = u;
    // A tiny delay after cancel() avoids a Chrome bug where speak() is dropped.
    setTimeout(function () { if (my === token) synth.speak(u); }, 30);
  }

  function play() {
    if (!synth) return;
    if (state === "paused") { speakFrom(idx); return; }
    source = el.text.value;
    chunks = splitChunks(source);
    if (!chunks.length) {
      setStatus("Type or paste some text first.");
      el.text.focus();
      return;
    }
    buildReader();
    showReader(true);
    speakFrom(0);
  }

  function pause() {
    token++;
    synth.cancel();
    state = "paused";
    updateUI();
  }

  function stop() {
    token++;
    if (synth) synth.cancel();
    state = "idle";
    idx = 0;
    showReader(false);
    updateUI();
  }

  function finish() {
    state = "idle";
    idx = 0;
    showReader(false);
    updateUI();
    setStatus("Finished ✓");
    el.progress.style.width = "100%";
  }

  function jump(delta) {
    if (state === "idle") return;
    var to = Math.min(chunks.length - 1, Math.max(0, idx + delta));
    if (state === "paused") { idx = to; markChunk(idx); updateUI(); return; }
    speakFrom(to);
  }

  function setStatus(s) { el.status.textContent = s; }

  function updateUI() {
    var playing = state === "playing";
    el.play.textContent = playing ? "⏸ Pause" : state === "paused" ? "▶ Resume" : "▶ Play";
    el.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    el.stop.disabled = state === "idle";
    el.back.disabled = state === "idle";
    el.fwd.disabled = state === "idle";
    el.dome.classList.toggle("speaking", playing);

    if (state === "idle") {
      el.progress.style.width = "0";
      setStatus("Ready");
      return;
    }
    var total = source.length || 1;
    el.progress.style.width = Math.round((chunks[idx].start / total) * 100) + "%";
    var left = fmtMinutes(words(source.slice(chunks[idx].start)));
    setStatus((playing ? "Reading" : "Paused at") + " sentence " + (idx + 1) + " of " + chunks.length +
      (left ? " · " + left + " left" : ""));
  }

  /* ---------- voices ---------- */
  var langNames = null;
  try { langNames = new Intl.DisplayNames([navigator.language || "en"], { type: "language" }); } catch (e) { /* old browser */ }
  function langLabel(code) {
    try { return (langNames && langNames.of(code)) || code; } catch (e) { return code; }
  }
  function baseLang(code) { return (code || "").split(/[-_]/)[0].toLowerCase(); }

  function loadVoices() {
    var list = synth.getVoices();
    if (!list.length) return false;
    voices = list.slice().sort(function (a, b) {
      return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
    });

    var langs = {};
    voices.forEach(function (v) { langs[baseLang(v.lang)] = true; });
    var codes = Object.keys(langs).sort(function (a, b) { return langLabel(a).localeCompare(langLabel(b)); });

    el.lang.textContent = "";
    el.lang.appendChild(new Option("All languages (" + voices.length + " voices)", ""));
    codes.forEach(function (c) { el.lang.appendChild(new Option(langLabel(c), c)); });

    var wanted = settings.lang;
    if (!settings.voiceURI && !wanted) wanted = baseLang(navigator.language);
    el.lang.value = langs[wanted] ? wanted : "";
    fillVoices();
    return true;
  }

  function fillVoices() {
    var lang = el.lang.value;
    var keep = settings.voiceURI;
    el.voice.textContent = "";
    var shown = voices.filter(function (v) { return !lang || baseLang(v.lang) === lang; });
    shown.forEach(function (v) {
      var label = v.name + " (" + v.lang + ")" + (v.localService ? "" : " · online");
      el.voice.appendChild(new Option(label, v.voiceURI));
    });
    var pick = shown.filter(function (v) { return v.voiceURI === keep; })[0] ||
      shown.filter(function (v) { return v.lang === navigator.language && v.default; })[0] ||
      shown.filter(function (v) { return v.lang === navigator.language; })[0] ||
      shown.filter(function (v) { return v.default; })[0] ||
      shown[0];
    if (pick) el.voice.value = pick.voiceURI;
  }

  /* ---------- settings ---------- */
  function applySettings() {
    el.rate.value = settings.rate;
    el.pitch.value = settings.pitch;
    el.volume.value = settings.volume;
    el.follow.checked = settings.follow;
    showOutputs();
  }
  function showOutputs() {
    el.rateOut.textContent = Number(settings.rate).toFixed(1).replace(/\.0$/, "") + "×";
    el.pitchOut.textContent = Number(settings.pitch).toFixed(1).replace(/\.0$/, "");
    el.volumeOut.textContent = Math.round(settings.volume * 100) + "%";
  }
  // Changing voice or speed mid-read restarts the current sentence with the new setting.
  function restartIfPlaying() { if (state === "playing") speakFrom(idx); }

  /* ---------- share link ---------- */
  function shareLink() {
    var t = el.text.value.trim();
    if (!t) { setStatus("Type some text first, then copy the link."); return; }
    if (t.length > MAX_SHARE) {
      setStatus("That text is too long for a link (max " + MAX_SHARE + " characters).");
      return;
    }
    var url = location.origin + location.pathname + "#t=" + encodeURIComponent(t);
    copy(url, "Link copied. Anyone who opens it can press play.");
  }
  function copy(s, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { setStatus(okMsg); }, function () { fallbackCopy(s); });
    } else { fallbackCopy(s); }
  }
  function fallbackCopy(s) { window.prompt("Copy this link:", s); }

  function textFromHash() {
    var m = /^#t=(.*)$/.exec(location.hash);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  /* ---------- wire up ---------- */
  function init() {
    var saved = load();
    if (saved.settings) {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (saved.settings[k] !== undefined) settings[k] = saved.settings[k];
      });
    }
    var fromLink = textFromHash();
    el.text.value = fromLink !== null ? fromLink : (typeof saved.text === "string" ? saved.text : "");
    if (fromLink !== null) history.replaceState(null, "", location.pathname + location.search);
    applySettings();
    updateMeta();

    if (!synth || !window.SpeechSynthesisUtterance) {
      $("unsupported").hidden = false;
      el.play.disabled = true;
      $("testBtn").disabled = true;
      updateUI();
      el.play.disabled = true;
      return;
    }

    // Voices load late on some browsers (and iOS never fires voiceschanged).
    if (!loadVoices()) {
      el.voice.appendChild(new Option("Loading voices…", ""));
      var tries = 0;
      var poll = setInterval(function () {
        if (loadVoices() || ++tries > 20) clearInterval(poll);
      }, 250);
    }
    if ("onvoiceschanged" in synth) synth.addEventListener("voiceschanged", loadVoices);

    el.play.addEventListener("click", function () { state === "playing" ? pause() : play(); });
    el.stop.addEventListener("click", stop);
    el.back.addEventListener("click", function () { jump(-1); });
    el.fwd.addEventListener("click", function () { jump(1); });

    el.reader.addEventListener("click", function (e) {
      var s = e.target.closest(".s");
      if (s) speakFrom(Number(s.dataset.i));
    });

    el.text.addEventListener("input", function () { updateMeta(); saveSoon(); });

    el.lang.addEventListener("change", function () {
      settings.lang = el.lang.value;
      fillVoices();
      settings.voiceURI = el.voice.value;
      save();
      restartIfPlaying();
    });
    el.voice.addEventListener("change", function () {
      settings.voiceURI = el.voice.value;
      save();
      restartIfPlaying();
    });
    [["rate", el.rate], ["pitch", el.pitch], ["volume", el.volume]].forEach(function (pair) {
      pair[1].addEventListener("input", function () {
        settings[pair[0]] = Number(pair[1].value);
        showOutputs();
        updateMeta();
        saveSoon();
      });
      pair[1].addEventListener("change", restartIfPlaying);
    });
    el.follow.addEventListener("change", function () {
      settings.follow = el.follow.checked;
      save();
      if (state !== "idle") markChunk(idx);
    });

    $("testBtn").addEventListener("click", function () {
      stop();
      var v = selectedVoice();
      var u = new SpeechSynthesisUtterance(v ? "Hello! This is " + v.name.replace(/\(.*?\)/g, "").trim() + "." : "Hello! This is my voice.");
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = settings.rate; u.pitch = settings.pitch; u.volume = settings.volume;
      current = u;
      synth.speak(u);
    });
    $("resetBtn").addEventListener("click", function () {
      settings = Object.assign({}, DEFAULTS);
      applySettings();
      loadVoices();
      settings.voiceURI = el.voice.value;
      updateMeta();
      save();
      restartIfPlaying();
      setStatus("Settings reset.");
    });
    $("shareBtn").addEventListener("click", shareLink);

    $("sampleBtn").addEventListener("click", function () {
      stop();
      el.text.value = SAMPLE;
      updateMeta(); save();
    });
    $("clearBtn").addEventListener("click", function () {
      stop();
      el.text.value = "";
      updateMeta(); save();
      el.text.focus();
    });
    $("pasteBtn").addEventListener("click", function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        el.text.focus();
        setStatus("Long-press (or Ctrl+V) in the box to paste.");
        return;
      }
      navigator.clipboard.readText().then(function (t) {
        if (!t) { setStatus("Your clipboard is empty."); return; }
        stop();
        el.text.value = t;
        updateMeta(); save();
      }, function () {
        el.text.focus();
        setStatus("Long-press (or Ctrl+V) in the box to paste.");
      });
    });
    el.file.addEventListener("change", function () {
      var f = el.file.files && el.file.files[0];
      el.file.value = "";
      if (!f) return;
      if (f.size > MAX_FILE) { setStatus("That file is over 1 MB. Try a smaller one."); return; }
      var r = new FileReader();
      r.onload = function () {
        stop();
        el.text.value = String(r.result || "");
        updateMeta(); save();
        setStatus("Opened " + f.name);
      };
      r.onerror = function () { setStatus("Couldn't open that file."); };
      r.readAsText(f);
    });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        state === "playing" ? pause() : play();
      } else if (e.key === "Escape" && state !== "idle") {
        stop();
      }
    });

    // Don't keep talking after the page is closed.
    window.addEventListener("pagehide", function () { token++; synth.cancel(); });

    updateUI();
  }

  init();
})();
