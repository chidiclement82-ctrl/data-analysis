# Voice Reader 🔊

Type or paste any text and hear it read aloud. You choose the voice, language, speed, pitch and volume. It's plain HTML, CSS and JavaScript with no build step. Device voices cost nothing and need no server: the speech comes from the visitor's own phone or computer, so no text is uploaded. The optional **your own voice** feature uses ElevenLabs (see below).

## What it does

- **Read aloud** with Play / Pause / Stop, plus skip back or forward one sentence.
- **Follow along:** the sentence being read is highlighted, and so is each word on browsers that support it. Tap any sentence to jump to it.
- **Pick a voice:** filter by language, then choose from every voice on the device. Voices marked "online" need internet.
- **Speed, pitch and volume** sliders. Changes apply straight away, even mid-sentence.
- **Get text in:** paste button, open a `.txt` file, or a sample text.
- **Share link:** copies a link with the text inside it (up to 4,000 characters). Whoever opens it just presses play.
- **Remembers** your text and settings on that device.
- Shortcuts: `Ctrl`/`⌘` + `Enter` plays or pauses, `Esc` stops.

Long text is read one sentence at a time, which stops Chrome and Android cutting off long passages partway.

## Your own voice (voice cloning) 🎙

The site can read your writing in **your own voice**. You give it a video or voice note of you talking, it makes a copy of your voice, and from then on you can press Play and hear your text read in it. You can also download the result as an MP3.

Cloning is done by [ElevenLabs](https://elevenlabs.io), because a browser can't do it alone. The site's small backend (`netlify/functions/`) talks to ElevenLabs, so your API key stays secret. Only the site owner can use it: it's locked with a password you choose, so strangers can't spend your credits or clone other people's voices. Visitors still get the free device voices.

### Switch it on (one time)

1. **Get an ElevenLabs account** with a paid plan. Voice cloning needs **Starter** or higher (around $5 a month at the time of writing, with about 30,000 characters of reading).
2. In ElevenLabs open **Developers → API Keys**, create a key and copy it.
3. In Netlify open your Voice Reader site → **Project configuration → Environment variables** and add:
   - `ELEVENLABS_API_KEY`: the key from step 2
   - `VOICE_PASSWORD`: a long password only you know
4. Redeploy the site (**Deploys → Trigger deploy**).

### Use it

1. Open the site and tap **🔒 Owner** at the bottom (or go to `yourdomain/#owner`). Enter your `VOICE_PASSWORD`. That device stays signed in.
2. Open **➕ Clone my voice from a video** and choose a video or voice note of you talking. Use **30 to 90 seconds** of just you, in a quiet room, with no music. Or tap **Record here instead** and read the text it shows you.
3. Listen to the sample to check it's you, give it a name, tick the consent box, and tap **✨ Make my voice**.
4. In the **Voice** box, switch to **🎙 My voice**, paste your writing and press Play. **⬇ Download MP3** saves it.

Notes:
- The sound is taken out of the video **on your phone**. Only the sound (up to 90 seconds) is sent to ElevenLabs, never the video.
- Reading in your voice uses about **1 ElevenLabs credit per character**. The page shows the count under the text box. Replaying the same text in the same visit doesn't cost again.
- Speed and volume work with your voice. Pitch only applies to device voices.
- Some iPhone `.mov` videos can't be read in Chrome on Android or PC. If that happens, open the site in Safari, or use **Record here instead**.
- You can delete a voice any time with 🗑. It's deleted from ElevenLabs too.
- Only clone your own voice, or a voice you have clear permission to use.

## Putting it on its own domain

This folder is a complete website on its own, so it can live on any domain you buy.

1. **Buy the domain** from any registrar (for example Namecheap, Cloudflare, or a `.ng` registrar like Whogohost).
2. **Create a Netlify site:** in Netlify choose **Add new project → Import an existing project**, pick this GitHub repository, and set:
   - **Base directory:** `voice`
   - **Build command:** leave empty
   - **Publish directory:** `voice` (Netlify fills this in from `voice/netlify.toml`)
3. **Deploy.** It's live straight away on a free `*.netlify.app` address.
4. **Add your domain:** in the new site go to **Domain management → Add a domain**, type your domain, and follow Netlify's instructions. Either point your registrar's nameservers to Netlify, or add the DNS records it shows you. HTTPS is switched on automatically.

After that, every change pushed to `main` under `voice/` goes live on your domain.

This doesn't affect the existing Netlify site for the secure chat. That one uses the `netlify.toml` at the root of the repository, and this one uses `voice/netlify.toml`.

## Good to know

- **Voices differ by device.** Microsoft Edge has the most natural-sounding voices. On phones, more voices can be added in the system's text-to-speech settings.
- **MP3 download** works with your own voice only. Browsers don't let a page save the device voices.

## Changing things

- Name, tagline and tips: [`index.html`](index.html)
- Colours: the `:root` block at the top of [`css/voice.css`](css/voice.css), with a separate light-mode block under it
- Sample text, link length limit, sentence length and voice sample length: the top of [`js/voice.js`](js/voice.js)
- The voice cloning backend: [`netlify/functions/`](netlify/functions/). Set `ELEVENLABS_MODEL` in Netlify to use a different ElevenLabs model (the default is `eleven_multilingual_v2`).
