/* Banter FC — all the fun lives here. No server, no login.
   To add a club: add an entry to CLUBS with its colours, a nickname,
   a bottle score (0–100, how often they "bottle it") and some roasts. */

const CLUBS = [
  { id: "arsenal", name: "Arsenal", nick: "The Gunners", colors: ["#db0007", "#ffffff"], bottle: 78, roasts: [
    "Arsenal fans start every season with “This is our year.” By March it becomes “Top four is like a trophy.”",
    "Arsenal lead the league in October so often, they should get a trophy for Autumn.",
    "Arsenal's trophy cabinet has a cobweb with its own season ticket.",
    "Arsenal don't bottle it. They gently place the bottle down and walk away in April." ] },
  { id: "chelsea", name: "Chelsea", nick: "The Blues", colors: ["#034694", "#ffffff"], bottle: 55, roasts: [
    "Chelsea's squad is so big, half the players need a map to find the training ground.",
    "Chelsea sign players like people buy jollof at a party: one more plate, one more plate.",
    "Chelsea's manager parking spot has a revolving door instead of a name.",
    "Chelsea have so many players on loan, they could start their own league." ] },
  { id: "liverpool", name: "Liverpool", nick: "The Reds", colors: ["#c8102e", "#f6eb61"], bottle: 40, roasts: [
    "Liverpool fans will remind you about Istanbul at a wedding, a funeral and a job interview.",
    "Liverpool fans sing “You'll Never Walk Alone” because nobody else wants to walk with them after a loss.",
    "Ask a Liverpool fan the score and they'll first tell you about 2005.",
    "Liverpool fans don't watch the match. They watch the match and ten hours of YouTube about the match." ] },
  { id: "manutd", name: "Manchester United", nick: "The Red Devils", colors: ["#da291c", "#fbe122"], bottle: 70, roasts: [
    "Manchester United fans have said “We're back” more times than a Nollywood sequel.",
    "Manchester United's best signing in years is still the nostalgia.",
    "Manchester United fans now celebrate a clean sheet like it's a Champions League final.",
    "Manchester United have a new project every season. Fans have a new excuse every week." ] },
  { id: "mancity", name: "Manchester City", nick: "The Citizens", colors: ["#6cabdd", "#1c2c5b"], bottle: 20, roasts: [
    "Manchester City's stadium is so quiet, you can hear the trophies being polished.",
    "Manchester City fans were not born yet. They were installed.",
    "City win so much, their fans now complain when it's only 3–0.",
    "Ask a City fan who they supported in 2005. Watch them buffer like bad network." ] },
  { id: "spurs", name: "Tottenham", nick: "Spurs", colors: ["#132257", "#ffffff"], bottle: 92, roasts: [
    "Tottenham fans look at a trophy the way you look at your neighbour's new car: nice, but not for you.",
    "Spurs have a lovely stadium. Pity the trophy room is being used as a store.",
    "Tottenham's motto is “To dare is to do.” Daring, yes. Doing, we're still waiting.",
    "Spurs fans get excited for a cup final and nervous in the same breath. Experience." ] },
  { id: "newcastle", name: "Newcastle", nick: "The Magpies", colors: ["#241f20", "#ffffff"], bottle: 60, roasts: [
    "Newcastle fans take their shirts off in December. After years without a trophy, the cold is nothing.",
    "Newcastle have the money now. They just need the receipt for a trophy.",
    "Newcastle fans are so loud, even the trophy they haven't won can hear them." ] },
  { id: "barca", name: "Barcelona", nick: "Barça", colors: ["#a50044", "#004d98"], bottle: 62, roasts: [
    "Barcelona fans talk about tiki-taka like it's a family recipe, then lose on the counter-attack.",
    "Barcelona's accountant needs the Ballon d'Or more than any player.",
    "Barça fans remember every comeback they made, and none of the ones made against them.",
    "Barcelona pass the ball 700 times and the other team scores with one long ball." ] },
  { id: "madrid", name: "Real Madrid", nick: "Los Blancos", colors: ["#febe10", "#ffffff"], bottle: 10, roasts: [
    "Real Madrid fans act like the Champions League is their WhatsApp group: they're the admin and you're just added.",
    "Madrid play badly for 85 minutes and still win. It's not football, it's witchcraft with a crest.",
    "Real Madrid fans call a season without the Champions League a “gap year”." ] },
  { id: "psg", name: "PSG", nick: "Les Parisiens", colors: ["#004170", "#da291c"], bottle: 75, roasts: [
    "PSG spent so much money, the Eiffel Tower asked for a loan.",
    "PSG win the French league in February and spend the rest of the year being nervous in Europe.",
    "PSG's squad photo looks like a fashion week line-up that forgot to play football." ] },
  { id: "bayern", name: "Bayern Munich", nick: "Die Roten", colors: ["#dc052d", "#0066b2"], bottle: 25, roasts: [
    "Bayern win the Bundesliga so often, Germany should rename it the Bayern Cup and the Others.",
    "Bayern fans get excited about the league title the way you get excited about Monday: it always comes.",
    "Bayern's biggest rival in Germany is boredom." ] },
  { id: "juve", name: "Juventus", nick: "La Vecchia Signora", colors: ["#000000", "#ffffff"], bottle: 72, roasts: [
    "Juventus fans have lost so many Champions League finals, they bring tissues as standard kit.",
    "Juventus are called the Old Lady because they've been waiting for that European trophy since forever.",
    "Juve's black and white kit matches how fans see the season: win the league, lose in Europe." ] },
  { id: "milan", name: "AC Milan", nick: "I Rossoneri", colors: ["#fb090b", "#000000"], bottle: 58, roasts: [
    "AC Milan fans only ever talk about the old days. Their highlights are on VHS.",
    "Milan fans count Champions League titles the way grandparents count grandchildren: proudly, and from long ago.",
    "AC Milan's best striker this season is still nostalgia." ] },
  { id: "eagles", name: "Super Eagles", nick: "Naija's finest", colors: ["#008751", "#ffffff"], bottle: 50, roasts: [
    "Super Eagles fans have aged ten years from one penalty shoot-out.",
    "Super Eagles can beat anyone on paper. The problem is the match is played on grass.",
    "Watching the Super Eagles is good for your faith: you pray more in 90 minutes than in one week of church." ] },
];

// Any club can be roasted with these; {r} is the rival, {m} is your club.
const GENERIC_ROASTS = [
  "{r} fans checking the table every week like it will change if they look hard enough.",
  "{r}'s defence has more holes than my mama's old net.",
  "{r} fans said “wait till next season” so many times, next season has blocked them.",
  "I'd tell a {r} joke, but their season already did that.",
  "{r} are so slow on the counter, the opposition had time to sub, celebrate and go home.",
  "{m} fans don't need to roast {r}. The league table is doing it for free.",
  "The {r} trophy parade route is just a walk to the bus stop.",
];

const EXCUSES = {
  who: ["The referee", "VAR", "The grass", "The new kit", "Our striker's horoscope", "The away fans",
    "The match ball", "The weather", "My neighbour's generator", "The coach's tactics board",
    "Our goalkeeper's gloves", "The kick-off time", "NEPA", "The stadium DJ"],
  did: ["was clearly supporting them since childhood", "was too long by at least 2 millimetres",
    "made us play with our eyes closed", "was heavier on our side of the pitch",
    "distracted us at the important moment", "was not blessed before the game",
    "took the light just when we were about to score", "was designed by their fans",
    "was cursed by a pundit", "confused our players with too many colours"],
  then: ["Also, we had more possession.", "We won the second half, morally.", "On paper, we won.",
    "We'll win the next one, no shaking.", "Honestly, a draw was the fair result.",
    "The table is lying.", "Our xG was beautiful.", "Football is not about winning anyway."],
};

const METER_LEVELS = [
  [15, "Ice cold. These ones don't bottle, they serve the drinks. 🧊"],
  [35, "Mostly safe. Might drop a tiny bottle in a cup game. 🥤"],
  [55, "Wobbly. Keep the bottle away from the edge of the table. 🍶"],
  [75, "Danger zone. They can smell April from here. 🍾"],
  [90, "Certified bottlers. The bottle factory sends them Christmas cards. 🏭"],
  [101, "Bottle Emperor. They bottled the test itself. 👑🍾"],
];

const QUIZ = [
  { q: "When did you start supporting your club?", a: [
    ["Before I could walk. My papa handed it to me.", 0],
    ["When I was a kid and they were decent.", 1],
    ["The exact season they won the league.", 2] ] },
  { q: "How many players in your club's starting XI can you name?", a: [
    ["All eleven and the kit man.", 0], ["About six.", 1], ["The one on my jersey.", 2] ] },
  { q: "Your team loses 3–0. What do you do?", a: [
    ["Watch the highlights and suffer.", 0], ["Mute the group chat for a day.", 1],
    ["Suddenly I “just like good football”.", 2] ] },
  { q: "How many clubs have you supported in total?", a: [
    ["One. Till death.", 0], ["One, plus a foreign club for Champions League.", 1],
    ["Whoever is top of the table this week.", 2] ] },
  { q: "Have you ever been to watch your club play live?", a: [
    ["Yes, many times.", 0], ["At a viewing centre, that counts.", 1],
    ["I've seen their logo on a bus.", 2] ] },
];

const QUIZ_RESULTS = [
  [2, "🛡️ TRUE FAN. Ride or die. Your club breaks your heart and you come back every Saturday. Respect."],
  [5, "🙂 Mostly loyal. A little bit of glory sniffing, but your heart is in the right stadium."],
  [8, "🤔 Glory curious. You haven't switched clubs yet, but you've opened the transfer window in your heart."],
  [10, "🏆 CERTIFIED GLORY HUNTER. Your jersey changes faster than your phone wallpaper. We see you."],
];

const FAN_TITLES = ["Head of Group Chat Banter", "Chief Excuse Officer", "Professional Pundit (Unpaid)",
  "Viewing Centre Legend", "Captain of the Bench", "Minister of Bragging Rights",
  "Lifetime Season Ticket (In Spirit)", "Senior Ref Shouter", "Grand Master of VAR Complaints",
  "Director of Football (Fantasy)"];

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clubById = (id) => CLUBS.find((c) => c.id === id) || CLUBS[0];
const PAGE_URL = location.href.split("#")[0];

// Avoid giving the same line twice in a row.
const lastPick = {};
function pickFresh(key, arr) {
  if (arr.length < 2) return arr[0];
  let v;
  do { v = pick(arr); } while (v === lastPick[key]);
  lastPick[key] = v;
  return v;
}

function setOutput(el, text) {
  el.hidden = false;
  el.textContent = text;
  el.classList.remove("pop");
  void el.offsetWidth; // restart the animation
  el.classList.add("pop");
  showShare(el.id);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function emojiRain(emojis, count = 18) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "rain";
    s.textContent = pick(emojis);
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
    s.style.animationDelay = Math.random() * 0.4 + "s";
    document.body.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }
}

/* ---------- sharing ---------- */

function shareText(id) {
  return `${$(id).textContent}\n\n⚽ Banter FC: ${PAGE_URL}`;
}

function showShare(id) {
  const row = document.querySelector(`[data-share="${id}"]`);
  if (!row || row.childElementCount) return;
  const wa = document.createElement("a");
  wa.className = "btn btn-small";
  wa.textContent = "💬 Send on WhatsApp";
  wa.target = "_blank";
  wa.rel = "noopener";
  wa.addEventListener("click", () => { wa.href = "https://wa.me/?text=" + encodeURIComponent(shareText(id)); });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn btn-small btn-ghost";
  copy.textContent = "📋 Copy";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText(id)); toast("Copied! Go and cause wahala 😄"); }
    catch { toast("Couldn't copy. Long-press the text instead."); }
  });
  row.append(wa, copy);
  if (navigator.share) {
    const sh = document.createElement("button");
    sh.type = "button";
    sh.className = "btn btn-small btn-ghost";
    sh.textContent = "📤 Share";
    sh.addEventListener("click", () => navigator.share({ text: shareText(id) }).catch(() => {}));
    row.append(sh);
  }
}

/* ---------- club pickers ---------- */

function fillSelect(sel, selectedId) {
  sel.innerHTML = "";
  for (const c of CLUBS) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    if (c.id === selectedId) o.selected = true;
    sel.append(o);
  }
}

function myClub() { return clubById($("myClub").value); }

// The rival list never offers your own club, and defaults to someone else.
function refreshRivals() {
  const mine = $("myClub").value;
  const current = $("rivalClub").value;
  fillSelect($("rivalClub"), current && current !== mine ? current : CLUBS.find((c) => c.id !== mine).id);
  [...$("rivalClub").options].forEach((o) => { o.hidden = o.disabled = o.value === mine; });
}

function loadSaved(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: fine */ }
}

/* ---------- features ---------- */

function roast() {
  const rival = clubById($("rivalClub").value);
  const mine = myClub();
  const pool = rival.roasts.concat(GENERIC_ROASTS.map((t) => t.replaceAll("{r}", rival.name).replaceAll("{m}", mine.name)));
  setOutput($("roastOut"), pickFresh("roast", pool));
  emojiRain(["🔥", "😂", "💀", "🤣"]);
}

function excuse() {
  const line = `${pick(EXCUSES.who)} ${pick(EXCUSES.did)}. ${pick(EXCUSES.then)}`;
  setOutput($("excuseOut"), `“${line}” — every ${myClub().name} fan, probably.`);
}

function meter() {
  const club = clubById($("meterClub").value);
  const score = Math.max(1, Math.min(100, Math.round(club.bottle + (Math.random() * 30 - 15))));
  const label = METER_LEVELS.find(([max]) => score < max)[1];
  const fill = $("gaugeFill");
  fill.style.width = "0";
  $("meterOut").textContent = "Testing… 🧪";
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = score + "%"; }));
  setTimeout(() => {
    setOutput($("meterOut"), `${club.name}: ${score}% bottle risk. ${label}`);
    if (score >= 75) emojiRain(["🍾", "🍼", "🥤"]);
  }, 1400);
}

function buildQuiz() {
  const form = $("quizForm");
  QUIZ.forEach((item, qi) => {
    const fs = document.createElement("fieldset");
    fs.className = "q";
    const lg = document.createElement("legend");
    lg.textContent = `${qi + 1}. ${item.q}`;
    fs.append(lg);
    item.a.forEach(([text, pts]) => {
      const lab = document.createElement("label");
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = "q" + qi;
      inp.value = pts;
      inp.required = true;
      lab.append(inp, document.createTextNode(text));
      fs.append(lab);
    });
    form.append(fs);
  });
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "submit";
  btn.textContent = "Reveal the truth 🔍";
  form.append(btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const score = QUIZ.reduce((sum, _, qi) => sum + Number(form.elements["q" + qi].value), 0);
    const verdict = QUIZ_RESULTS.find(([max]) => score <= max)[1];
    setOutput($("quizOut"), `Glory score ${score}/10. ${verdict}`);
    emojiRain(score >= 6 ? ["🏆", "🕵️", "👀"] : ["🛡️", "❤️", "⚽"]);
  });
}

/* ---------- fan card ---------- */

async function drawCard() {
  const c = $("fanCanvas");
  const ctx = c.getContext("2d");
  const club = myClub();
  const name = ($("fanName").value.trim() || "Mystery Fan").toUpperCase();
  const [main, accent] = club.colors;
  const W = c.width, H = c.height;
  try { await document.fonts.load("80px Bungee"); } catch { /* fallback font is fine */ }

  // Background stripes in club colours
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#000";
  for (let x = 0; x < W; x += 120) ctx.fillRect(x, 0, 60, H);
  ctx.globalAlpha = 1;

  // White card
  const pad = 70;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(ctx, pad, 260, W - pad * 2, H - 360, 40);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "88px Bungee, Impact, sans-serif";
  ctx.fillText("BANTER FC", W / 2, 150);
  ctx.font = "600 38px Inter, sans-serif";
  ctx.fillText("OFFICIAL FAN CARD", W / 2, 210);

  // Ball badge in an accent ring
  ctx.beginPath();
  ctx.arc(W / 2, 420, 110, 0, Math.PI * 2);
  ctx.fillStyle = accent === "#ffffff" ? main : accent;
  ctx.fill();
  ctx.font = "140px serif";
  ctx.textBaseline = "middle";
  ctx.fillText("⚽", W / 2, 428);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#10201a";
  ctx.font = fitFont(ctx, name, W - pad * 2 - 80, 96);
  ctx.fillText(name, W / 2, 640);

  ctx.font = "800 46px Inter, sans-serif";
  ctx.fillStyle = main === "#ffffff" ? "#10201a" : main;
  ctx.fillText(club.name.toUpperCase(), W / 2, 720);
  ctx.fillStyle = "#55665e";
  ctx.font = "600 34px Inter, sans-serif";
  ctx.fillText(club.nick, W / 2, 768);

  ctx.fillStyle = "#10201a";
  ctx.font = "600 32px Inter, sans-serif";
  ctx.fillText("POSITION", W / 2, 860);
  const title = pick(FAN_TITLES);
  ctx.font = fitFont(ctx, title, W - pad * 2 - 80, 44, "800", "Inter");
  ctx.fillText(title, W / 2, 915);

  const banter = 3 + Math.floor(Math.random() * 3);
  ctx.font = "600 32px Inter, sans-serif";
  ctx.fillText("BANTER RATING", W / 2, 1010);
  ctx.font = "64px serif";
  ctx.fillText("⭐".repeat(banter) + "☆".repeat(5 - banter), W / 2, 1085);

  ctx.fillStyle = "#fff";
  ctx.font = "600 30px Inter, sans-serif";
  ctx.fillText(`No. ${String(Math.floor(Math.random() * 9000) + 1000)} · Valid every matchday`, W / 2, H - 40);

  $("cardDownload").href = c.toDataURL("image/png");
}

function fitFont(ctx, text, maxWidth, size, weight = "", family = "Bungee") {
  let s = size;
  const font = () => `${weight} ${s}px ${family}, Impact, sans-serif`.trim();
  ctx.font = font();
  while (maxWidth && s > 24 && ctx.measureText(text).width > maxWidth) { s -= 4; ctx.font = font(); }
  return font();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- start ---------- */

function init() {
  const saved = clubById(loadSaved("banter-club", "arsenal")).id;
  fillSelect($("myClub"), saved);
  fillSelect($("meterClub"), saved);
  refreshRivals();
  $("fanName").value = loadSaved("banter-name", "");

  $("myClub").addEventListener("change", () => {
    save("banter-club", $("myClub").value);
    $("meterClub").value = $("myClub").value;
    refreshRivals();
    drawCard();
  });
  $("fanName").addEventListener("change", () => save("banter-name", $("fanName").value.trim()));
  $("roastBtn").addEventListener("click", roast);
  $("excuseBtn").addEventListener("click", excuse);
  $("meterBtn").addEventListener("click", meter);
  $("cardBtn").addEventListener("click", () => { drawCard(); emojiRain(["🪪", "⭐", "⚽"], 12); });

  buildQuiz();
  drawCard();
}

init();
