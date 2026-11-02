# Voice Reader 🔊

Type or paste any text and hear it read aloud. You choose the voice, language, speed, pitch and volume. It's plain HTML, CSS and JavaScript with no build step, no server and no monthly cost. The speech comes from the visitor's own phone or computer, so no text is ever uploaded.

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
- **No MP3 download.** Browsers don't let a page save the voices they speak with. Saving audio files would need a paid text-to-speech service on a server, which can be added later.

## Changing things

- Name, tagline and tips: [`index.html`](index.html)
- Colours: the `:root` block at the top of [`css/voice.css`](css/voice.css), with a separate light-mode block under it
- Sample text, link length limit and sentence length: the top of [`js/voice.js`](js/voice.js)
