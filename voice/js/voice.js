/* Voice Reader: reads text aloud.
   - Device voices: the browser's own voices (Web Speech API). Nothing is uploaded.
   - My voice: the owner's cloned voice, made by ElevenLabs through this site's
     Netlify functions (/api/*), which keep the API key secret. */
(function () {
  "use strict";

  var SAMPLE =
    "Welcome to Voice Reader. Paste or type anything into the box, pick a voice you like, and press play.\n\n" +
    "You can slow it down, speed it up, or change the pitch. Tap any sentence while it's reading to jump straight to it. " +
    "Everything happens on your own device, so your text stays private.";
  var STORE_KEY = "voiceReader.v1";
  var OWNER_KEY = "voiceReader.owner";
  var MAX_CHUNK = 220;          // long sentences are split so no browser cuts them off
  var MAX_FILE = 1024 * 1024;   // 1 MB of text is plenty
  var MAX_SHARE = 4000;         // characters that fit comfortably in a link
  var FIRST_GROUP = 300;        // my voice: small first request so it starts quickly
  var GROUP = 1500;             // then bigger requests
  var SAMPLE_RATE = 22050;      // voice sample sent for cloning
  var SAMPLE_MIN = 15;          // seconds
  var SAMPLE_MAX = 90;          // seconds (keeps the upload under Netlify's limit)
  var MAX_MEDIA = 400 * 1024 * 1024;

  var synth = window.speechSynthesis;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    text: $("text"), reader: $("reader"), meta: $("meta"), status: $("status"),
    play: $("playBtn"), stop: $("stopBtn"), back: $("backBtn"), fwd: $("fwdBtn"),
    lang: $("langSelect"), voice: $("voiceSelect"), myVoice: $("myVoiceSelect"),
    rate: $("rate"), pitch: $("pitch"), volume: $("volume"),
    rateOut: $("rateOut"), pitchOut: $("pitchOut"), volumeOut: $("volumeOut"),
    follow: $("follow"), progress: $("progressBar"), dome: $("dome"),
    file: $("fileInput"), modes: $("modes"), download: $("downloadBtn"),
    mineCard: $("mineCard"), signin: $("signinForm"), pass: $("ownerPass"),
    mineArea: $("mineArea"), myVoices: $("myVoices"), mineStatus: $("mineStatus"),
    cloneBox: $("cloneBox"), sampleFile: $("sampleFile"), rec: $("recBtn"),
    readThis: $("readThis"), sampleReady: $("sampleReady"), sampleInfo: $("sampleInfo"),
    samplePlayer: $("samplePlayer"), voiceName: $("voiceName"), consent: $("consent"),
    cloneBtn: $("cloneBtn")
  };

  var DEFAULTS = { rate: 1, pitch: 1, volume: 1, follow: true, voiceURI: "", lang: "", mode: "device", myVoiceId: "" };
  var settings = Object.assign({}, DEFAULTS);
  var voices = [];
  var owner = { pass: "", voices: [] };

  // Playback state
  var chunks = [];       // [{start, end, text}] offsets into the source text
  var groups = [];       // my voice: chunks joined into bigger requests
  var source = "";       // the text being read
  var idx = 0;           // current chunk
  var state = "idle";    // idle | playing | paused
  var token = 0;         // bumps on every (re)start so stale callbacks are ignored
  var current = null;    // keep a reference: Safari drops events of collected utterances
  var chunkEls = [];

  // My voice playback
  var audio = new Audio();
  audio.preload = "auto";
  var cache = new Map();    // "voiceId|text" -> Promise<{url, blob, starts}>
  var loadedGi = -1;        // group currently in the audio element
  var loadedStarts = [];
  var dirty = false;        // position moved while paused
  var lastWord = "";

  function mine() { return settings.mode === "mine" && !!owner.pass; }

  /* ---------- storage ---------- */
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch (e) { return {}; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: fine */ }
  }
  function save() { writeJSON(STORE_KEY, { settings: settings, text: el.text.value }); }
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
    if (mine() && t.trim()) parts.push("≈ " + t.trim().length + " ElevenLabs credits");
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

  // My voice: join sentences into fewer, bigger requests.
  function makeGroups(chs, src) {
    var gs = [], cur = null;
    chs.forEach(function (c, i) {
      var limit = gs.length === 1 ? FIRST_GROUP : GROUP;
      if (cur && c.end - cur.start <= limit) { cur.last = i; cur.end = c.end; }
      else { cur = { first: i, last: i, start: c.start, end: c.end }; gs.push(cur); }
    });
    gs.forEach(function (g) { g.text = src.slice(g.start, g.end); });
    return gs;
  }
  function groupOf(i) {
    for (var g = 0; g < groups.length; g++) if (i >= groups[g].first && i <= groups[g].last) return g;
    return groups.length - 1;
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
    if (on) el.reader.style.height = el.text.offsetHeight ? el.text.offsetHeight + "px" : "";
    el.reader.hidden = !on;
    el.text.hidden = on;
  }

  function markChunk(i) {
    lastWord = "";
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

  /* ---------- device voices ---------- */
  function selectedVoice() {
    for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === el.voice.value) return voices[i];
    return null;
  }

  function deviceStart(i) {
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
      deviceStart(idx + 1);
    };
    u.onerror = function (e) {
      if (my !== token) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      if (e.error === "not-allowed") {
        pause();
        setStatus("Tap Play to start reading (your browser needs a tap first).");
        return;
      }
      deviceStart(idx + 1); // skip a chunk the voice can't read
    };
    current = u;
    // A tiny delay after cancel() avoids a Chrome bug where speak() is dropped.
    setTimeout(function () { if (my === token) synth.speak(u); }, 30);
  }

  /* ---------- my voice (cloned) ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "x-voice-password": owner.pass }, opts.headers || {});
    var body = opts.body;
    if (opts.json) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
    return fetch(path, { method: opts.method || "GET", headers: headers, body: body })
      .catch(function () {
        throw new Error("Couldn't reach the voice server. Check your internet. (It only works once the site is on Netlify.)");
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.message || "Something went wrong (error " + res.status + ").");
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
  }

  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }

  function getAudio(text) {
    var key = settings.myVoiceId + "|" + text;
    if (!cache.has(key)) {
      var p = api("/api/speak", { method: "POST", json: { voiceId: settings.myVoiceId, text: text } })
        .then(function (d) {
          if (!d.audio) throw new Error("No audio came back. Try again.");
          var blob = b64ToBlob(d.audio, "audio/mpeg");
          return { blob: blob, url: URL.createObjectURL(blob), starts: d.starts || [] };
        });
      p.catch(function () { cache.delete(key); });
      cache.set(key, p);
    }
    return cache.get(key);
  }

  function cloudStart(i) {
    var my = ++token;
    if (synth) synth.cancel();
    audio.pause();
    dirty = false;
    if (i >= chunks.length) { finish(); return; }
    idx = Math.max(0, i);
    state = "playing";
    markChunk(idx);
    updateUI();

    var gi = groupOf(idx), g = groups[gi];
    var waiting = setTimeout(function () { if (my === token) setStatus("Making audio in your voice…"); }, 250);
    getAudio(g.text).then(function (r) {
      clearTimeout(waiting);
      if (my !== token) return;
      if (loadedGi !== gi || audio.src !== r.url) audio.src = r.url;
      loadedGi = gi;
      loadedStarts = r.starts;
      var t = r.starts[chunks[idx].start - g.start] || 0;
      audio.playbackRate = settings.rate;
      audio.volume = settings.volume;
      seekAndPlay(t, my);
      updateUI();
      if (groups[gi + 1]) getAudio(groups[gi + 1].text).catch(function () { /* retried when reached */ });
    }, function (err) {
      clearTimeout(waiting);
      if (my !== token) return;
      state = "paused";
      dirty = true;
      updateUI();
      setStatus(err.message);
    });
  }

  function seekAndPlay(t, my) {
    var go = function () {
      if (my !== token) return;
      try { audio.currentTime = t; } catch (e) { /* not seekable yet */ }
      var p = audio.play();
      if (p && p.catch) p.catch(function (e) {
        if (my !== token) return;
        state = "paused"; dirty = true; updateUI();
        setStatus(e && e.name === "NotAllowedError" ? "Tap Play to start (your browser needs a tap first)." : "Couldn't play the audio.");
      });
      follow(my);
    };
    if (audio.readyState >= 1) go();
    else audio.addEventListener("loadedmetadata", go, { once: true });
  }

  // Highlight the sentence and word being spoken, from ElevenLabs' character timings.
  function follow(my) {
    if (my !== token || state !== "playing") return;
    var g = groups[loadedGi], s = loadedStarts;
    if (g && s.length) {
      var t = audio.currentTime, lo = 0, hi = s.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (s[mid] <= t) lo = mid; else hi = mid - 1; }
      var off = g.start + lo;
      var c = g.first;
      while (c < g.last && chunks[c + 1].start <= off) c++;
      if (c !== idx) { idx = c; markChunk(c); updateUI(); }
      var t2 = chunks[c].text, rel = off - chunks[c].start;
      if (rel >= 0 && rel < t2.length && /\S/.test(t2[rel])) {
        var a = rel, b = rel;
        while (a > 0 && /\S/.test(t2[a - 1])) a--;
        while (b < t2.length && /\S/.test(t2[b])) b++;
        var key = c + ":" + a;
        if (key !== lastWord) { lastWord = key; markWord(c, a, b - a); }
      }
    }
    requestAnimationFrame(function () { follow(my); });
  }

  audio.addEventListener("ended", function () {
    if (state !== "playing" || !mine()) return;
    if (groups[loadedGi + 1]) cloudStart(groups[loadedGi + 1].first);
    else finish();
  });

  function cloudResume() {
    if (!dirty && loadedGi === groupOf(idx) && audio.src) {
      var my = ++token;
      state = "playing";
      updateUI();
      seekAndPlay(audio.currentTime, my);
    } else {
      cloudStart(idx);
    }
  }

  /* ---------- shared controls ---------- */
  function startAt(i) { mine() ? cloudStart(i) : deviceStart(i); }

  function play() {
    if (!synth && !mine()) return;
    if (mine() && !settings.myVoiceId) {
      setStatus("Pick or clone your voice first.");
      openMine(true);
      return;
    }
    if (state === "paused") { mine() ? cloudResume() : deviceStart(idx); return; }
    source = el.text.value;
    chunks = splitChunks(source);
    if (!chunks.length) {
      setStatus("Type or paste some text first.");
      el.text.focus();
      return;
    }
    groups = makeGroups(chunks, source);
    loadedGi = -1;
    buildReader();
    showReader(true);
    startAt(0);
  }

  function halt() {
    token++;
    if (synth) synth.cancel();
    audio.pause();
  }

  function pause() {
    halt();
    state = "paused";
    updateUI();
  }

  function stop() {
    halt();
    state = "idle";
    idx = 0;
    loadedGi = -1;
    showReader(false);
    updateUI();
  }

  function finish() {
    stop();
    setStatus("Finished ✓");
    el.progress.style.width = "100%";
  }

  function jump(delta) {
    if (state === "idle") return;
    var to = Math.min(chunks.length - 1, Math.max(0, idx + delta));
    if (state === "paused") { idx = to; dirty = true; markChunk(idx); updateUI(); return; }
    startAt(to);
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
      setStatus(mine() ? "Ready · reading in your voice" : "Ready");
      return;
    }
    var total = source.length || 1;
    el.progress.style.width = Math.round((chunks[idx].start / total) * 100) + "%";
    var left = fmtMinutes(words(source.slice(chunks[idx].start)));
    setStatus((playing ? "Reading" : "Paused at") + " sentence " + (idx + 1) + " of " + chunks.length +
      (left ? " · " + left + " left" : ""));
  }

  /* ---------- device voice list ---------- */
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
    showMode();
  }
  function showOutputs() {
    el.rateOut.textContent = Number(settings.rate).toFixed(1).replace(/\.0$/, "") + "×";
    el.pitchOut.textContent = Number(settings.pitch).toFixed(1).replace(/\.0$/, "");
    el.volumeOut.textContent = Math.round(settings.volume * 100) + "%";
  }
  function showMode() {
    var m = mine();
    document.body.classList.toggle("mode-mine", m);
    el.modes.hidden = !owner.pass;
    Array.prototype.forEach.call(el.modes.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-checked", String(b.dataset.mode === (m ? "mine" : "device")));
    });
    updateMeta();
    if (state === "idle") updateUI();
  }
  function setMode(mode) {
    if (mode === settings.mode && mode === (mine() ? "mine" : "device")) return;
    stop();
    settings.mode = mode;
    save();
    showMode();
    if (mode === "mine" && !owner.voices.length) openMine(true);
  }
  // Changing voice or speed mid-read applies the new setting straight away.
  function settingChanged(name) {
    if (state !== "playing") return;
    if (mine()) {
      if (name === "rate") audio.playbackRate = settings.rate;
      else if (name === "volume") audio.volume = settings.volume;
      else cloudStart(idx);
    } else {
      deviceStart(idx);
    }
  }

  /* ---------- owner: sign in and voice list ---------- */
  function openMine(focusClone) {
    el.mineCard.hidden = false;
    if (focusClone && owner.pass && !owner.voices.length) el.cloneBox.open = true;
    el.mineCard.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!owner.pass) el.pass.focus();
  }
  function mineSay(s) { el.mineStatus.textContent = s; }

  function showOwner() {
    var signed = !!owner.pass;
    el.signin.hidden = signed;
    el.mineArea.hidden = !signed;
    if (signed) el.mineCard.hidden = false;
    renderVoices();
    showMode();
  }

  function renderVoices() {
    el.myVoices.textContent = "";
    el.myVoice.textContent = "";
    if (!owner.voices.length) {
      var li = document.createElement("li");
      li.className = "empty";
      li.appendChild(document.createElement("span")).textContent = "No voices yet. Clone yours below.";
      el.myVoices.appendChild(li);
      el.myVoice.appendChild(new Option("No voices yet", ""));
      return;
    }
    if (!owner.voices.some(function (v) { return v.id === settings.myVoiceId; })) {
      settings.myVoiceId = owner.voices[0].id;
      save();
    }
    owner.voices.forEach(function (v) {
      el.myVoice.appendChild(new Option(v.name, v.id));
      var li = document.createElement("li");
      li.appendChild(document.createElement("span")).textContent = v.name;
      var use = document.createElement("button");
      use.type = "button";
      use.className = "ghost";
      var inUse = mine() && v.id === settings.myVoiceId;
      use.textContent = inUse ? "✓ In use" : "Use";
      use.disabled = inUse;
      use.addEventListener("click", function () {
        stop();
        settings.myVoiceId = v.id;
        save();
        setMode("mine");
        renderVoices();
        setStatus("Reading in “" + v.name + "”. Press Play.");
      });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "ghost";
      del.textContent = "🗑";
      del.setAttribute("aria-label", "Delete " + v.name);
      del.addEventListener("click", function () {
        if (!window.confirm("Delete the voice “" + v.name + "”? This can't be undone.")) return;
        mineSay("Deleting…");
        api("/api/voices?id=" + encodeURIComponent(v.id), { method: "DELETE" }).then(function () {
          owner.voices = owner.voices.filter(function (x) { return x.id !== v.id; });
          if (settings.myVoiceId === v.id) { stop(); settings.myVoiceId = ""; }
          if (!owner.voices.length && settings.mode === "mine") settings.mode = "device";
          save();
          showOwner();
          mineSay("Deleted “" + v.name + "”.");
        }, function (err) { mineSay(err.message); });
      });
      li.appendChild(use);
      li.appendChild(del);
      el.myVoices.appendChild(li);
    });
    el.myVoice.value = settings.myVoiceId;
  }

  function refreshVoices() {
    return api("/api/voices").then(function (d) {
      owner.voices = d.voices || [];
      writeJSON(OWNER_KEY, owner);
      showOwner();
    });
  }

  function signOut() {
    stop();
    owner = { pass: "", voices: [] };
    try { localStorage.removeItem(OWNER_KEY); } catch (e) { /* fine */ }
    settings.mode = "device";
    save();
    showOwner();
    mineSay("Signed out on this device.");
  }

  /* ---------- making a voice sample from a video ---------- */
  var sampleWav = null;

  function decode(buf) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    }).then(function (b) { ctx.close(); return b; }, function (e) { ctx.close(); throw e; });
  }

  function prepareSample(blob) {
    sampleWav = null;
    el.sampleReady.hidden = true;
    updateCloneBtn();
    if (blob.size > MAX_MEDIA) { mineSay("That file is very big. Trim the video to a short clip first."); return; }
    mineSay("Getting the sound out of your video…");
    blob.arrayBuffer().then(decode).then(function (decoded) {
      var secs = Math.min(decoded.duration, 240);
      var off = new OfflineAudioContext(1, Math.ceil(secs * SAMPLE_RATE), SAMPLE_RATE);
      var src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (rendered) {
      var data = rendered.getChannelData(0);
      var peak = 0;
      for (var i = 0; i < data.length; i++) { var a = Math.abs(data[i]); if (a > peak) peak = a; }
      if (peak < 0.01) throw new Error("silent");
      // Trim quiet bits at the start and end.
      var thr = peak * 0.05, s = 0, e = data.length;
      while (s < e && Math.abs(data[s]) < thr) s++;
      while (e > s && Math.abs(data[e - 1]) < thr) e--;
      s = Math.max(0, s - SAMPLE_RATE * 0.3);
      e = Math.min(data.length, e + SAMPLE_RATE * 0.3);
      var longer = (e - s) > SAMPLE_MAX * SAMPLE_RATE;
      var part = data.subarray(s, Math.min(e, s + SAMPLE_MAX * SAMPLE_RATE));
      var secs = part.length / SAMPLE_RATE;
      if (secs < SAMPLE_MIN) {
        throw new Error("short:" + Math.round(secs));
      }
      sampleWav = wav(part, SAMPLE_RATE, 0.95 / peak);
      el.samplePlayer.src = URL.createObjectURL(sampleWav);
      el.sampleInfo.textContent = "✓ " + fmtSecs(secs) + " of sound is ready" +
        (longer ? " (the first " + SAMPLE_MAX + " seconds)" : "") + ". Play it to check it's just you:";
      el.sampleReady.hidden = false;
      mineSay("");
      updateCloneBtn();
    }).catch(function (err) {
      var m = /^short:(\d+)/.exec(err && err.message);
      if (m) mineSay("That's only " + m[1] + " seconds of talking. Use a clip with at least 30 seconds of you speaking.");
      else if (err && err.message === "silent") mineSay("That file has no sound. Pick a video where you're talking.");
      else mineSay("Couldn't read the sound in that file. Try another video or voice note, or tap “Record here instead”.");
    });
  }

  function fmtSecs(s) {
    s = Math.round(s);
    return s < 60 ? s + " seconds" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  }

  // 16-bit mono WAV
  function wav(samples, rate, gain) {
    var buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    var str = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, samples.length * 2, true);
    for (var i = 0, o = 44; i < samples.length; i++, o += 2) {
      var x = Math.max(-1, Math.min(1, samples[i] * gain));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  function updateCloneBtn() { el.cloneBtn.disabled = !(sampleWav && el.consent.checked); }

  // Record with the microphone instead of a video.
  var recorder = null, recTimer = null;
  function toggleRecord() {
    if (recorder) { recorder.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      mineSay("This browser can't record here. Choose a video or voice note instead.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var parts = [], started = Date.now();
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      recorder.onstop = function () {
        clearInterval(recTimer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        recorder = null;
        el.rec.classList.remove("recording");
        el.rec.textContent = "🎙 Record again";
        prepareSample(new Blob(parts, { type: parts[0] ? parts[0].type : "audio/webm" }));
      };
      recorder.start(1000);
      el.readThis.hidden = false;
      el.rec.classList.add("recording");
      var tick = function () {
        var s = Math.floor((Date.now() - started) / 1000);
        el.rec.textContent = "⏹ Stop recording (" + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + ")";
        if (s >= SAMPLE_MAX && recorder) recorder.stop();
      };
      tick();
      recTimer = setInterval(tick, 500);
      mineSay("Recording… read the text below out loud. Aim for about a minute.");
    }, function () {
      mineSay("The microphone is blocked. Allow it in your browser settings, or choose a video instead.");
    });
  }

  function cloneVoice() {
    if (!sampleWav || !el.consent.checked) return;
    var name = el.voiceName.value.trim() || "My voice";
    el.cloneBtn.disabled = true;
    mineSay("Making your voice… this takes about 10 to 30 seconds.");
    api("/api/clone", {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-voice-name": encodeURIComponent(name), "x-consent": "yes" },
      body: sampleWav
    }).then(function (d) {
      stop();
      owner.voices = owner.voices.filter(function (v) { return v.id !== d.id; }).concat([{ id: d.id, name: d.name }]);
      writeJSON(OWNER_KEY, owner);
      settings.myVoiceId = d.id;
      settings.mode = "mine";
      save();
      sampleWav = null;
      el.sampleReady.hidden = true;
      el.consent.checked = false;
      el.voiceName.value = "";
      el.cloneBox.open = false;
      showOwner();
      mineSay("🎉 “" + d.name + "” is ready. Press Play to hear your writing in your voice.");
      setStatus("Ready · reading in your voice");
    }, function (err) {
      mineSay(err.message);
      updateCloneBtn();
    });
  }

  /* ---------- download (my voice) ---------- */
  function download() {
    var src = el.text.value;
    var chs = splitChunks(src);
    if (!chs.length) { setStatus("Type or paste some text first."); return; }
    if (!settings.myVoiceId) { setStatus("Pick or clone your voice first."); return; }
    var gs = makeGroups(chs, src), blobs = [], i = 0;
    el.download.disabled = true;
    var next = function () {
      if (i >= gs.length) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(blobs, { type: "audio/mpeg" }));
        var first = (chs[0].text.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 4).join("-").toLowerCase();
        a.download = (first || "voice-reader") + ".mp3";
        document.body.appendChild(a);
        a.click();
        a.remove();
        el.download.disabled = false;
        setStatus("Downloaded ✓");
        return;
      }
      setStatus("Making the MP3… part " + (i + 1) + " of " + gs.length);
      getAudio(gs[i].text).then(function (r) { blobs.push(r.blob); i++; next(); }, function (err) {
        el.download.disabled = false;
        setStatus(err.message);
      });
    };
    next();
  }

  /* ---------- share link ---------- */
  function shareLink() {
    var t = el.text.value.trim();
    if (!t) { setStatus("Type some text first, then copy the link."); return; }
    if (t.length > MAX_SHARE) {
      setStatus("That text is too long for a link (max " + MAX_SHARE + " characters).");
      return;
    }
    var url = location.origin + location.pathname + "#t=" + encodeURIComponent(t);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        setStatus("Link copied. Anyone who opens it can press play.");
      }, function () { window.prompt("Copy this link:", url); });
    } else { window.prompt("Copy this link:", url); }
  }

  function textFromHash() {
    var m = /^#t=(.*)$/.exec(location.hash);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }

  /* ---------- wire up ---------- */
  function init() {
    var saved = readJSON(STORE_KEY);
    if (saved.settings) {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (saved.settings[k] !== undefined) settings[k] = saved.settings[k];
      });
    }
    var savedOwner = readJSON(OWNER_KEY);
    if (savedOwner.pass) owner = { pass: String(savedOwner.pass), voices: Array.isArray(savedOwner.voices) ? savedOwner.voices : [] };

    var fromLink = textFromHash();
    if (location.hash === "#owner") el.mineCard.hidden = false;
    el.text.value = fromLink !== null ? fromLink : (typeof saved.text === "string" ? saved.text : "");
    if (fromLink !== null) history.replaceState(null, "", location.pathname + location.search);
    applySettings();
    showOwner();

    if (!synth || !window.SpeechSynthesisUtterance) {
      $("unsupported").hidden = !!owner.pass;
      if (!mine()) el.play.disabled = true;
    } else {
      // Voices load late on some browsers (and iOS never fires voiceschanged).
      if (!loadVoices()) {
        el.voice.appendChild(new Option("Loading voices…", ""));
        var tries = 0;
        var poll = setInterval(function () {
          if (loadVoices() || ++tries > 20) clearInterval(poll);
        }, 250);
      }
      if ("onvoiceschanged" in synth) synth.addEventListener("voiceschanged", loadVoices);
    }

    if (owner.pass) {
      refreshVoices().catch(function (err) {
        if (err.status === 401) { signOut(); mineSay("The owner password changed. Sign in again."); }
      });
    }

    el.play.addEventListener("click", function () { state === "playing" ? pause() : play(); });
    el.stop.addEventListener("click", stop);
    el.back.addEventListener("click", function () { jump(-1); });
    el.fwd.addEventListener("click", function () { jump(1); });

    el.reader.addEventListener("click", function (e) {
      var s = e.target.closest(".s");
      if (s) startAt(Number(s.dataset.i));
    });

    el.text.addEventListener("input", function () { updateMeta(); saveSoon(); });

    el.lang.addEventListener("change", function () {
      settings.lang = el.lang.value;
      fillVoices();
      settings.voiceURI = el.voice.value;
      save();
      settingChanged("voice");
    });
    el.voice.addEventListener("change", function () {
      settings.voiceURI = el.voice.value;
      save();
      settingChanged("voice");
    });
    el.myVoice.addEventListener("change", function () {
      settings.myVoiceId = el.myVoice.value;
      save();
      renderVoices();
      settingChanged("voice");
    });
    [["rate", el.rate], ["pitch", el.pitch], ["volume", el.volume]].forEach(function (pair) {
      pair[1].addEventListener("input", function () {
        settings[pair[0]] = Number(pair[1].value);
        showOutputs();
        updateMeta();
        saveSoon();
        if (mine() && state === "playing" && pair[0] !== "pitch") settingChanged(pair[0]);
      });
      pair[1].addEventListener("change", function () { if (!mine()) settingChanged(pair[0]); });
    });
    el.follow.addEventListener("change", function () {
      settings.follow = el.follow.checked;
      save();
      if (state !== "idle") markChunk(idx);
    });
    el.modes.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]");
      if (b) setMode(b.dataset.mode);
    });

    $("testBtn").addEventListener("click", function () {
      stop();
      if (mine()) {
        if (!settings.myVoiceId) { openMine(true); return; }
        setStatus("Making a test in your voice…");
        getAudio("Hello! This is my voice, reading in Voice Reader.").then(function (r) {
          audio.src = r.url;
          audio.playbackRate = settings.rate;
          audio.volume = settings.volume;
          audio.play();
          setStatus("Ready · reading in your voice");
        }, function (err) { setStatus(err.message); });
        return;
      }
      if (!synth) return;
      var v = selectedVoice();
      var u = new SpeechSynthesisUtterance(v ? "Hello! This is " + v.name.replace(/\(.*?\)/g, "").trim() + "." : "Hello! This is my voice.");
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = settings.rate; u.pitch = settings.pitch; u.volume = settings.volume;
      current = u;
      synth.speak(u);
    });
    $("resetBtn").addEventListener("click", function () {
      var keep = { mode: settings.mode, myVoiceId: settings.myVoiceId };
      settings = Object.assign({}, DEFAULTS, keep);
      applySettings();
      if (synth) loadVoices();
      settings.voiceURI = el.voice.value;
      save();
      if (state === "playing") startAt(idx);
      setStatus("Settings reset.");
    });
    $("shareBtn").addEventListener("click", shareLink);
    el.download.addEventListener("click", download);

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

    // Owner area
    $("ownerLink").addEventListener("click", function () { openMine(false); });
    el.signin.addEventListener("submit", function (e) {
      e.preventDefault();
      var p = el.pass.value;
      if (!p) { el.pass.focus(); return; }
      owner.pass = p;
      mineSay("Checking…");
      refreshVoices().then(function () {
        el.pass.value = "";
        mineSay(owner.voices.length ? "Signed in. Pick a voice, or clone a new one." : "Signed in. Now clone your voice below.");
        if (!owner.voices.length) el.cloneBox.open = true;
      }, function (err) {
        owner.pass = "";
        showOwner();
        mineSay(err.message);
      });
    });
    $("signoutBtn").addEventListener("click", signOut);
    el.sampleFile.addEventListener("change", function () {
      var f = el.sampleFile.files && el.sampleFile.files[0];
      el.sampleFile.value = "";
      if (f) prepareSample(f);
    });
    el.rec.addEventListener("click", toggleRecord);
    el.consent.addEventListener("change", updateCloneBtn);
    el.cloneBtn.addEventListener("click", cloneVoice);

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        state === "playing" ? pause() : play();
      } else if (e.key === "Escape" && state !== "idle") {
        stop();
      }
    });

    // Don't keep talking after the page is closed.
    window.addEventListener("pagehide", halt);

    updateUI();
  }

  init();
})();
