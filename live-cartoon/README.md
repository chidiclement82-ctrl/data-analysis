# Live Cartoon: an AI co-host for your TikTok LIVE

A cartoon character (**Bobo** by default) appears on your TikTok LIVE and:

- **reads your live chat** and answers viewers out loud by name, with its face changing to match (happy, excited, thinking, surprised, laughing, sad, cool, in love);
- **answers guests.** Bring someone up on your LIVE and let them ask a question out loud. You press **Listen** and the cartoon answers;
- **thanks people** who follow you or send gifts, and jumps for joy when they do.

It only ever connects to **your** TikTok account: the username in your `.env` file.

The cartoon's brain is Claude (Anthropic's AI). It gives real answers to real questions, stays family-friendly, and laughs off trolls.

## How it fits together

```
TikTok LIVE chat ──► this app (on your computer) ──► Claude writes the reply
                              │
           control panel ◄────┴────► cartoon stage  ──►  TikTok LIVE Studio / OBS  ──►  your LIVE
           (you, and guests' mic)    (talks + moves)      (captures the stage window)
```

- **Cartoon stage** (`/stage`): the animated cartoon with a speech bubble. You add this window to your stream.
- **Control panel** (`/control`): what you watch while live. It shows the chat, has auto-reply on/off and **Stop talking**, and has the guest-question mic.

## What you need

1. **A computer** (Windows or Mac) with [Node.js 20.12 or newer](https://nodejs.org) and Google Chrome.
2. **A way to stream from that computer.** Use [TikTok LIVE Studio](https://www.tiktok.com/studio/download) if your account has access to it, or OBS with a TikTok stream key. Going live from the phone app alone can't show a website on your stream.
3. **An Anthropic API key** for the cartoon's brain. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys). Every answer costs a small amount; set a monthly spending limit in the console.
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
ANTHROPIC_API_KEY=sk-ant-...
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

## Using the control panel from your phone

Set `HOST=0.0.0.0` and a long random `CONTROL_KEY` in `.env`. Then open `http://YOUR-COMPUTER-IP:3000/control?key=YOUR_CONTROL_KEY` on a phone on the same Wi-Fi. The guest mic needs a secure page, so use it on the computer itself.

## Good to know

- **Replies are spoken on the stream, not typed into TikTok chat.** TikTok has no official way for apps to post in your chat, and the unofficial way needs your login cookie, which would be risky for your account.
- **How it reads your chat:** through [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector), an unofficial, free library that reads the same chat any viewer sees. It doesn't log in as you. If TikTok changes things, it can stop working until the library is updated (`npm update tiktok-live-connector`). If you hit its free rate limit, add a free `EULER_API_KEY`.
- **Safety:** viewers can't change the cartoon's rules. Comments with links, spam, or anything in `BLOCKED_WORDS` are ignored. The cartoon refuses hateful or dangerous requests with a joke. You always have **Stop talking**.
- **Cost:** each answer is one short Claude request. A busy 1-hour LIVE where the cartoon answers every few seconds makes several hundred requests. Check your usage in the Anthropic console, and turn auto-reply off to answer only the comments you pick.
- **Keep `.env` private.** It holds your API keys and is never uploaded to GitHub.

## For developers

```
server.js          web server, WebSocket hub, and the speaking queue
src/tiktok.js      connects to the one TikTok account and emits chat/follow/gift events
src/filters.js     which comments are worth answering, and in what order
src/brain.js       Claude prompt and reply parsing (emotion + what to say)
src/tts.js         optional ElevenLabs voice
public/stage.*     the animated cartoon (SVG + JS lip sync)
public/control.*   the host control panel
test/              npm test
```

`npm test` runs the tests without TikTok or an API key.
