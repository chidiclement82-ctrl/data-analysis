# Bobo's Daily Push: automatic TikTok videos

Every morning this makes **3 new motivation videos** with Bobo: it writes the script, records his voice, animates him talking with word-by-word captions, and puts the finished videos on a download page with ready-to-copy captions.

| Part | What it does |
|---|---|
| Script | Gemini writes a fresh 25–40 second script. Each day mixes formats: hard truth, mini story, three rules, morning push, night reminder, challenge. |
| Voice | Gemini's natural text-to-speech voice (clear standard English). |
| Video | 1080×1920, 30 fps MP4: Bobo talks, blinks and nods, with big captions, your @handle and an "AI-generated character" label. |
| Schedule | GitHub runs it every day at 05:00 Lagos time and publishes the videos as a release. |

## Set it up (once)

1. **Add your Gemini key to GitHub.** Open the repository on GitHub, then go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `GEMINI_API_KEY`
   - Secret: your free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. **Make the first batch now:** **Actions → Daily Bobo videos → Run workflow**. It takes about 5 minutes.
3. **Get the videos:** open the repository's **Releases** page. Each day has its own release with 3 MP4s and `captions.md`.

## Posting

Download the videos on your phone and post them, or schedule the whole week in **TikTok Studio** on a computer ([tiktok.com/tiktokstudio](https://www.tiktok.com/tiktokstudio) → Upload → Schedule). Paste each video's caption from `captions.md`.

- Turn on TikTok's **"AI-generated content"** label when posting: TikTok requires it for AI-made videos.
- Good times to post in Nigeria are roughly 7 am, 1 pm and 8 pm.

Fully automatic posting needs TikTok's official Content Posting API (a developer app that TikTok reviews). Unofficial auto-posters break TikTok's rules and can get the account banned, so this doesn't use them.

## Change things

Under **Settings → Secrets and variables → Actions → Variables** you can set:

| Variable | Default | Meaning |
|---|---|---|
| `BOBO_HANDLE` | `@clem22145` | Handle shown at the bottom of every video |
| `BOBO_VOICE` | `Orus` | Gemini voice name (for example `Charon`, `Fenrir`, `Puck`) |
| `VIDEOS_PER_DAY` | `3` | How many videos each day |

Bobo's look is in `render/scene.html`. Topics and formats are in `src/script.js`.

GitHub pauses scheduled runs in a repository with no activity for 60 days. If the videos stop, open **Actions** and re-enable the workflow.

## Run it on a computer

```bash
cd content-factory
npm install
npx playwright install chromium     # and install ffmpeg
GEMINI_API_KEY=... npm run make     # 3 videos into out/<date>/
node src/make.js --fake --count 1   # dry run: sample script, test tone instead of a voice
npm test
```
