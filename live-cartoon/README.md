# Live Cartoon: an AI co-host for your TikTok LIVE

A cartoon character (**Bobo** by default) appears on your TikTok LIVE and:

- **reads your live chat** and answers viewers out loud by name, with its face changing to match (happy, excited, thinking, surprised, laughing, sad, cool, in love);
- **answers guests.** Bring someone up on your LIVE and let them ask a question out loud. You press **Listen** and the cartoon answers;
- **thanks people** who follow you or send gifts, and jumps for joy when they do.

It only ever connects to **your** TikTok account: the username in your `.env` file.

The cartoon's brain is an AI: **Google Gemini** (free, no card needed) or **Claude** (Anthropic's AI, paid). It gives real answers to real questions, stays family-friendly, and laughs off trolls.

## How it fits together

```
TikTok LIVE chat ──► this app (on your computer) ──► the AI writes the reply
                              │
           control panel ◄────┴────► cartoon stage  ──►  TikTok LIVE Studio / OBS  ──►  your LIVE
           (you, and guests' mic)    (talks + moves)      (captures the stage window)
```

- **Cartoon stage** (`/stage`): the animated cartoon with a speech bubble. You add this window to your stream.
- **Control panel** (`/control`): what you watch while live. It shows the chat, has auto-reply on/off and **Stop talking**, and has the guest-question mic.

## What you need

1. **Either a computer** (Windows or Mac) with [Node.js 20.12 or newer](https://nodejs.org) and Google Chrome, streaming with [TikTok LIVE Studio](https://www.tiktok.com/studio/download) or OBS; **or just your phone**, with the app hosted online (see [Run it online](#run-it-online-go-live-from-just-your-phone)).
2. **The right kind of LIVE:** on a computer, LIVE Studio or OBS shows the cartoon window. On a phone, use TikTok's screen-share LIVE; the normal camera LIVE can't show a website.
3. **An AI key** for the cartoon's brain. Pick one:
   - **Gemini (free):** sign in with your Google account at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and tap **Create API key**. No card or ID needed. The free tier limits how many answers per minute the cartoon can give, and Google may use free-tier conversations (your viewers' comments) to improve its products.
   - **Claude (paid):** get a key at [console.anthropic.com](https://console.anthropic.com/settings/keys). Every answer costs a small amount; set a monthly spending limit in the console.
4. Optional: an **[ElevenLabs](https://elevenlabs.io) key** for a proper cartoon voice. Without it, the cartoon uses Chrome's built-in voice.

## Set it up (once)

```bash
cd live-cartoon
npm install
cp .env.example .env      # on Windows: copy .env.example .env
```

Open `.env` in a text editor and fill in at least:

```
TIKTOK_USERNAME=yourusername        # without the @
GEMINI_API_KEY=AIza...             # or ANTHROPIC_API_KEY=sk-ant-... for Claude
CARTOON_NAME=Bobo
HOST_NAME=Chidi                     # what the cartoon calls you
```

`CARTOON_PERSONA` sets the character's personality. For example: *"a Lagos-born cartoon who loves Afrobeats, jokes in light Pidgin, and is crazy about science"*.

## Every time you go live

1. **Start the app:** `npm start` in the `live-cartoon` folder. Leave that window open.
2. **Open the control panel:** <http://localhost:3000/control>
3. **Open the cartoon stage** in its own Chrome window: <http://localhost:3000/stage>. Click **Tap to start** (browsers only allow sound after a click). Size the window tall, like a phone screen.
4. **Add the stage to your stream:**
   - **TikTok LIVE Studio:** *Add source → Window capture* → pick the Chrome window with the stage. Make sure desktop/app audio is included so viewers hear the cartoon.
   - **OBS:** *Sources → + → Browser*, URL `http://localhost:3000/stage?autostart=1`, width 1080, height 1920, and tick *Control audio via OBS*. Or use *Window Capture* plus *Desktop Audio*, as above.
5. **Go live on TikTok.** Within about 20 seconds the control panel shows **TikTok: LIVE**, and the cartoon starts answering the chat.

You can start the app before you go live; it keeps checking until your LIVE starts.

**Practice first:** with no LIVE running, type in **Practice: pretend a viewer commented** on the control panel, and the cartoon answers it on the stage.

## Bobo listens on the LIVE phone itself

After **Tap to start**, the stage page listens through the phone's microphone. Whenever someone on your LIVE says something and pauses, Bobo answers them out loud, with no second phone and no buttons. A small 👂 in the bottom-left corner shows when Bobo is listening, and 🔇 shows while he's talking (he never answers his own voice).

- The first time, Chrome asks to use the microphone: tap **Allow**.
- Whether a phone lets Chrome listen while TikTok is streaming depends on the phone. If the 👂 stays on but Bobo never reacts to people talking, use a second phone with hands-free (below) instead.
- Some Android phones play a short beep each time listening restarts.
- Add `?listen=0` to the stage address to turn listening off on that phone.

## Hands-free guests (answers whatever they say)

Turn on **🎧 Hands-free: answer guests automatically** in the Guest question box on the control panel. From then on, every time a guest on your LIVE says something and pauses, the cartoon answers it out loud, with no buttons to press.

- Keep the control-panel device (phone, tablet or computer) **near the phone you're streaming from**, so its mic can hear your guests. Use Chrome.
- While the cartoon is answering, the mic stops listening, so the cartoon never answers its own voice. It starts listening again a moment after the cartoon finishes.
- Very short sounds ("ok", "yes", "hmm") are ignored.
- The mic can't tell voices apart, so it answers **you** too when you speak. Turn hands-free off when you want to talk without the cartoon replying.
- Typing a guest's name in the box lets the cartoon address them by name.

## Taking guest questions

1. Bring a guest onto your LIVE as you normally do.
2. On the control panel, type their name (optional) and press **🎤 Listen** while they ask their question. Their words appear in the box as they speak.
3. With **Ask as soon as they stop talking** ticked, the question goes to the cartoon when they pause. Otherwise, fix any words and press **Ask Bobo**.
4. Guest questions skip the chat queue and get longer, fuller answers.

The mic listens on your computer, so the guest's voice has to reach it: through your speakers, or with you repeating the question. Headphones stop the cartoon from hearing itself. Voice typing works in Chrome and Edge.

## Control panel buttons

| Button | What it does |
|---|---|
| **Auto-reply to chat** | On: the cartoon picks good comments by itself (questions and people who say its name first, one at a time, and never the same viewer twice in a row). Off: it only answers what you click. |
| Click a comment | The cartoon answers that comment next. |
| **■ Stop talking** | Cuts the cartoon off immediately. |
| **Clear queue** | Forgets waiting comments. |
| **Make the cartoon say exactly this** | It reads out your text word for word (no AI). Good for welcomes and announcements. |
| **Reconnect to TikTok** | Use it if the connection looks stuck. |

## Stage options

Add these to the stage address, e.g. `http://localhost:3000/stage?bg=green&pitch=1.5`:

| Option | Meaning |
|---|---|
| `bg=transparent` | No background, for an OBS browser source over your camera |
| `bg=green` | Green screen, for a chroma key filter |
| `autostart=1` | Skip *Tap to start* (OBS browser sources can play sound without a click) |
| `voice=Samantha` | Use a specific Chrome voice (any part of its name) |
| `pitch=1.5`, `rate=1.1` | Make the browser voice higher or faster |
| `key=…` | Your CONTROL_KEY, so the page doesn't ask for it. It's removed from the address bar straight away. |

## Run it online: go live from just your phone

Host the app on [Render](https://render.com) and it runs 24/7 at a web address like `https://live-cartoon-xxxx.onrender.com`. You don't need a computer. Open the cartoon on your phone and go live with TikTok's screen-share LIVE.

**Set it up (once, about 10 minutes):**

1. Make sure the cartoon is on your `main` branch (merge its pull request first). Then sign up at [render.com](https://render.com) with your GitHub account.
2. Click **New → Blueprint**, pick the `data-analysis` repository, and click **Connect**. Render reads [`render.yaml`](../render.yaml) and sets almost everything up.
3. It asks for your settings: **TIKTOK_USERNAME** (without the @), **GEMINI_API_KEY** (or **ANTHROPIC_API_KEY** if you use Claude; leave the other one empty), and **HOST_NAME** (what the cartoon calls you). The ElevenLabs and Euler keys are optional; leave them empty if you don't have them.
4. Click **Apply**. The first deploy takes a few minutes.
5. Open the new **live-cartoon** service → **Environment** and copy the value of **CONTROL_KEY**. That's the password for your cartoon's pages. Keep it private.

The Blueprint uses Render's **Starter** plan (about $7 a month). Don't switch to the free plan: it falls asleep after 15 minutes without visitors, which drops your TikTok connection mid-LIVE.

Every change merged into `main` redeploys automatically.

**Going live from your phone:**

1. In Chrome on your phone, open `https://YOUR-APP.onrender.com/stage`. Enter your CONTROL_KEY (asked once per device), then tap **Tap to start**. The screen stays on while the stage is open.
2. Turn on **Do Not Disturb** and turn the volume up. The phone's mic picks up the cartoon's voice for your viewers.
3. In TikTok, start a **screen-share LIVE** (the *Mobile Gaming* option, if your account has it), then switch back to Chrome so the cartoon fills the screen. Don't open other apps or the control panel on this phone: viewers see everything on your screen.
4. With **auto-reply** on, the cartoon answers your chat by itself. To pick comments, take guest questions or press **Stop**, open `https://YOUR-APP.onrender.com/control` on a second phone, tablet or computer.

**Good to know about hosting online:**
- TikTok is sometimes stricter with connections from cloud servers. If the control panel keeps saying it can't connect while you're live, add a free [Euler Stream](https://www.eulerstream.com) key as `EULER_API_KEY` under **Environment** on Render.
- Anyone who has your CONTROL_KEY can make the cartoon talk on your LIVE. If it leaks, change it on Render (Environment → CONTROL_KEY) and enter the new one on your devices.

## Using the control panel from your phone (same Wi-Fi)

To keep the app on your computer but use your phone, set `HOST=0.0.0.0` and a long random `CONTROL_KEY` (12+ characters) in `.env`. Then open `http://YOUR-COMPUTER-IP:3000/control` on a phone on the same Wi-Fi and enter the key. The stage asks for the key too. The guest mic only works on secure pages, so over Wi-Fi it works only on the computer itself; hosted online, it also works on phones.

## Good to know

- **Replies are spoken on the stream, not typed into TikTok chat.** TikTok has no official way for apps to post in your chat, and the unofficial way needs your login cookie, which would be risky for your account.
- **How it reads your chat:** through [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector), an unofficial, free library that reads the same chat any viewer sees. It doesn't log in as you. If TikTok changes things, it can stop working until the library is updated (`npm update tiktok-live-connector`). If you hit its free rate limit, add a free `EULER_API_KEY`.
- **Safety:** viewers can't change the cartoon's rules. Comments with links, spam, or anything in `BLOCKED_WORDS` are ignored. The cartoon refuses hateful or dangerous requests with a joke. You always have **Stop talking**.
- **Cost:** each answer is one short AI request. A busy 1-hour LIVE where the cartoon answers every few seconds makes several hundred requests. On Gemini's free tier that's free, but if you hit its per-minute limit the cartoon pauses briefly and carries on. On Claude, check your usage in the Anthropic console. Either way, turn auto-reply off to answer only the comments you pick.
- **Switching AI:** to move from Gemini to Claude later, add `ANTHROPIC_API_KEY` and set `AI_PROVIDER=claude` (or remove the Gemini key).
- **Keep `.env` private.** It holds your API keys and is never uploaded to GitHub.

## For developers

```
server.js          web server, WebSocket hub, access key check, and the speaking queue
src/tiktok.js      connects to the one TikTok account and emits chat/follow/gift events
src/filters.js     which comments are worth answering, and in what order
src/brain.js       AI prompt, Claude and Gemini providers, reply parsing (emotion + what to say)
src/tts.js         optional ElevenLabs voice
public/stage.*     the animated cartoon (SVG + JS lip sync)
public/control.*   the host control panel
public/js/key.js   asks for and remembers the access key
../render.yaml     Render hosting setup
test/              npm test
```

`npm test` runs the tests without TikTok or an API key.
