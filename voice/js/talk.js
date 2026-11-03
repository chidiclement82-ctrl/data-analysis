/* Talk: speak to it, and an AI answers out loud in your cloned voice.
   You speak  → the browser turns it into text (speech recognition)
   → /api/chat writes a reply (Claude) → /api/speak says it in your voice (ElevenLabs). */
(function () {
  "use strict";

  var OWNER_KEY = "voiceReader.owner";   // shared with the Reader page
  var STORE_KEY = "voiceReader.v1";
  var TALK_KEY = "voiceReader.talk";
  var MAX_SAVED = 60;

  var PRESETS = [
    ["😊 Friendly chat", "A warm, friendly everyday chat. Ask me about my day, share your thoughts, and keep it light and fun."],
    ["💼 Interview practice", "You're a job interviewer. First ask what job I'm applying for, then ask me one interview question at a time. After each answer, give short, honest feedback and then the next question."],
    ["🛎 Customer service", "You're a polite, helpful customer service agent for my business. I'll play the customer. My business is: (describe it here, with prices and opening hours). If you don't know something, say you'll check with the team."],
    ["⚽ Football banter", "We're two football fans having friendly banter about the latest matches, transfers and rivalries. Keep it funny and cheeky, but never personal or rude."],
    ["🗣 Language practice", "Help me practise speaking French. Talk to me in simple French at a slow pace. If I make a mistake, gently correct it in English, then carry on in French."],
    ["📖 Storyteller", "Tell me an exciting story bit by bit. After each short part, ask me what should happen next and use my idea."],
    ["🧠 Coach", "You're my personal coach. Help me think through my goals and plans for the week. Ask good questions, and keep me motivated and practical."]
  ];
  var LANGS = [
    ["", "My device's language"], ["en-NG", "English (Nigeria)"], ["en-US", "English (US)"], ["en-GB", "English (UK)"],
    ["fr-FR", "French"], ["es-ES", "Spanish"], ["pt-BR", "Portuguese"], ["de-DE", "German"], ["it-IT", "Italian"],
    ["ar-SA", "Arabic"], ["sw-KE", "Swahili"], ["hi-IN", "Hindi"], ["zh-CN", "Chinese"], ["ja-JP", "Japanese"]
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $("gate"), app: $("app"), presets: $("presets"), setup: $("setup"),
    voice: $("talkVoice"), lang: $("recLang"), handsFree: $("handsFree"),
    btn: $("talkBtn"), state: $("talkState"), interim: $("interim"),
    log: $("log"), newBtn: $("newBtn"), form: $("typeForm"), input: $("typeInput"), srNote: $("srNote")
  };

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var owner = readJSON(OWNER_KEY);
  var talk = Object.assign({ setup: "", voiceId: "", lang: "", handsFree: true, messages: [] }, readJSON(TALK_KEY));
  var state = "idle";       // idle | listening | thinking | speaking
  var token = 0;            // bumps to cancel whatever is in progress
  var rec = null;
  var emptyListens = 0;
  var audio = new Audio();
  var unlocked = false;
  var spoken = {};          // message index -> audio URL, for replay

  /* ---------- storage ---------- */
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch (e) { return {}; }
  }
  function save() {
    talk.messages = talk.messages.slice(-MAX_SAVED);
    try { localStorage.setItem(TALK_KEY, JSON.stringify(talk)); } catch (e) { /* private mode */ }
  }

  /* ---------- server ---------- */
  function api(path, payload) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-voice-password": owner.pass },
      body: JSON.stringify(payload)
    }).catch(function () {
      throw new Error("Couldn't reach the server. Check your internet.");
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || "Something went wrong (error " + res.status + ").");
        return data;
      });
    });
  }

  /* ---------- UI ---------- */
  var LABELS = {
    idle: "Tap the dome and start talking",
    listening: "Listening… tap when you're done",
    thinking: "Thinking…",
    speaking: "Speaking… tap to cut in"
  };
  function setState(s, label) {
    state = s;
    el.btn.className = "big-dome" + (s === "idle" ? "" : " " + s);
    el.btn.setAttribute("aria-label", LABELS[s]);
    el.state.textContent = label || LABELS[s];
    if (s !== "listening") el.interim.textContent = "";
  }

  function render() {
    el.log.textContent = "";
    if (!talk.messages.length) {
      var hint = document.createElement("li");
      hint.className = "hint";
      hint.textContent = "Your conversation will show here.";
      el.log.appendChild(hint);
    }
    talk.messages.forEach(function (m, i) {
      var li = document.createElement("li");
      li.className = m.role === "user" ? "me" : "ai";
      li.appendChild(document.createTextNode(m.content));
      if (m.role === "assistant") {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = "🔊";
        b.title = "Play again";
        b.setAttribute("aria-label", "Play again");
        b.addEventListener("click", function () { stopAll(); say(m.content, i); });
        li.appendChild(b);
      }
      el.log.appendChild(li);
    });
    el.log.lastChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showError(msg) {
    var li = document.createElement("li");
    li.className = "err";
    li.textContent = msg;
    el.log.appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* ---------- audio ---------- */
  // Phones only let a page play sound after a tap, so play a silent clip on
  // the first tap; later replies can then play by themselves.
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    var rate = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    var w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    audio.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    var p = audio.play();
    if (p && p.catch) p.catch(function () { unlocked = false; });
  }

  function b64ToBlob(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "audio/mpeg" });
  }

  function say(text, index) {
    var my = ++token;
    setState("speaking", "Getting your voice ready…");
    var ready = spoken[index]
      ? Promise.resolve(spoken[index])
      : api("/api/speak", { voiceId: talk.voiceId, text: text.slice(0, 2500) }).then(function (d) {
          var url = URL.createObjectURL(b64ToBlob(d.audio));
          spoken[index] = url;
          return url;
        });
    return ready.then(function (url) {
      if (my !== token) return;
      setState("speaking");
      audio.src = url;
      audio.onended = function () {
        if (my !== token) return;
        if (talk.handsFree && SR) listen();
        else setState("idle");
      };
      var p = audio.play();
      if (p && p.catch) p.catch(function () {
        if (my === token) setState("idle", "Tap 🔊 on the answer to hear it");
      });
    }, function (err) {
      if (my !== token) return;
      setState("idle");
      showError("Couldn't speak the answer: " + err.message);
    });
  }

  /* ---------- listening ---------- */
  function listen() {
    if (!SR) { el.input.focus(); return; }
    var my = ++token;
    var heard = "";
    rec = new SR();
    rec.lang = talk.lang || navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      el.interim.textContent = (heard + interim).trim();
    };
    rec.onerror = function (e) {
      if (my !== token) return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        token++;
        setState("idle", "The microphone is blocked. Allow it in your browser settings, or type below.");
      } else if (e.error === "network") {
        token++;
        setState("idle", "Speech recognition needs internet. Check your connection.");
      }
    };
    rec.onend = function () {
      rec = null;
      if (my !== token) return;
      var text = heard.trim();
      if (text) { emptyListens = 0; send(text); return; }
      // Nothing heard: try once more in hands-free mode, then rest.
      if (talk.handsFree && ++emptyListens < 2) { listen(); return; }
      emptyListens = 0;
      setState("idle", "I didn't hear anything. Tap the dome to talk.");
    };
    try {
      rec.start();
      setState("listening");
    } catch (e) {
      rec = null;
      setState("idle", "Couldn't start listening. Tap the dome again.");
    }
  }

  function stopAll() {
    token++;
    if (rec) { try { rec.abort(); } catch (e) { /* already stopped */ } rec = null; }
    audio.pause();
    setState("idle");
  }

  /* ---------- the conversation ---------- */
  function send(text) {
    if (!talk.voiceId) {
      setState("idle", "Clone your voice on the Reader page first.");
      return;
    }
    var my = ++token;
    talk.messages.push({ role: "user", content: text });
    save();
    render();
    setState("thinking");
    api("/api/chat", { setup: talk.setup, messages: talk.messages }).then(function (d) {
      if (my !== token) return;
      talk.messages.push({ role: "assistant", content: d.reply });
      save();
      render();
      say(d.reply, talk.messages.length - 1);
    }, function (err) {
      if (my !== token) return;
      // Take the message back so it can be sent again.
      talk.messages.pop();
      save();
      render();
      el.input.value = text;
      setState("idle");
      showError(err.message + " Your message is in the box below; tap Send to try again.");
    });
  }

  function onDomeTap() {
    unlockAudio();
    if (state === "listening") { if (rec) rec.stop(); return; }   // done talking: send it
    if (state === "speaking") { audio.pause(); listen(); return; } // cut in
    if (state === "thinking") { stopAll(); return; }               // cancel
    emptyListens = 0;
    listen();
  }

  /* ---------- set up ---------- */
  function fillVoices() {
    var list = Array.isArray(owner.voices) ? owner.voices : [];
    if (!talk.voiceId || !list.some(function (v) { return v.id === talk.voiceId; })) {
      var reader = readJSON(STORE_KEY).settings || {};
      talk.voiceId = list.some(function (v) { return v.id === reader.myVoiceId; }) ? reader.myVoiceId : (list[0] ? list[0].id : "");
    }
    el.voice.textContent = "";
    if (!list.length) el.voice.appendChild(new Option("No voices yet: clone one on the Reader page", ""));
    list.forEach(function (v) { el.voice.appendChild(new Option(v.name, v.id)); });
    el.voice.value = talk.voiceId;
  }

  function markPreset() {
    Array.prototype.forEach.call(el.presets.children, function (b, i) {
      b.setAttribute("aria-pressed", String(PRESETS[i][1] === talk.setup));
    });
  }

  function init() {
    if (!owner.pass) { el.gate.hidden = false; return; }
    el.app.hidden = false;

    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = p[0];
      b.addEventListener("click", function () {
        el.setup.value = p[1];
        talk.setup = p[1];
        save();
        markPreset();
        el.setup.focus();
      });
      el.presets.appendChild(b);
    });
    el.setup.value = talk.setup;
    markPreset();
    LANGS.forEach(function (l) { el.lang.appendChild(new Option(l[1], l[0])); });
    el.lang.value = talk.lang;
    el.handsFree.checked = talk.handsFree;
    fillVoices();
    save();
    render();

    if (!SR) {
      el.srNote.hidden = false;
      setState("idle", "Type your message below");
    }

    el.setup.addEventListener("input", function () { talk.setup = el.setup.value; save(); markPreset(); });
    el.voice.addEventListener("change", function () { talk.voiceId = el.voice.value; spoken = {}; save(); });
    el.lang.addEventListener("change", function () { talk.lang = el.lang.value; save(); });
    el.handsFree.addEventListener("change", function () { talk.handsFree = el.handsFree.checked; save(); });
    el.btn.addEventListener("click", onDomeTap);
    el.newBtn.addEventListener("click", function () {
      stopAll();
      talk.messages = [];
      spoken = {};
      save();
      render();
    });
    el.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var t = el.input.value.trim();
      if (!t) return;
      unlockAudio();
      stopAll();
      el.input.value = "";
      send(t);
    });
    window.addEventListener("pagehide", stopAll);
  }

  init();
})();
