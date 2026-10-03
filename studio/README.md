# Visage Studio

An AI video studio: swap your face into a video, clone your voice, and make finished videos with a guided flow. It's built in plain HTML, CSS and JavaScript (ES modules), with no build step.

**Flow:** Upload → Choose face → Choose voice → Edit → Generate → Preview → Export

Once GitHub Pages deploys, it's live at `/studio/`. To run it locally, serve the repository root (`python3 -m http.server`) and open `http://localhost:8000/studio/`. ES modules don't load from `file://`.

## What's in it

| Area | Where | What it does |
|---|---|---|
| Create video | `#/create` | 7-step wizard. Saves to the project after every step. |
| Face swap | `#/face-swap` | Pick a face and a video, then compare before and after with a drag slider and tune the blend. |
| Voice clone | `#/voice` | Clone a voice from the mic, **from a video's soundtrack**, or from an audio file. Then type a script and adjust speed, emotion and tone. |
| Editor | `#/editor/<id>` | Trim, split and cut; text overlays; subtitles (auto from the script); music; synthesized sound effects; volumes with ducking; transitions and fades; 720p/1080p export. |
| Dashboard | `#/dashboard` | Projects, faces, voice models, generated videos, export history, account, plan and AI provider settings. |
| Trust & Safety | `#/safety` | Content policy, report form, your reports and consent records. |

## Real voice cloning (ElevenLabs)

Voice cloning uses [ElevenLabs Instant Voice Cloning](https://elevenlabs.io/docs/api-reference/voices/ivc/create). It's called straight from the browser, so it works on GitHub Pages without a server.

1. Get an API key at **elevenlabs.io → Settings → API keys**. Cloning needs the **Starter plan or higher**.
2. In Visage Studio, open **Dashboard → Account → Voice cloning**, paste the key, and press **Save & test**. It shows your plan and remaining characters.
3. Go to **Voice clone** and pick a source:
   - **Record with mic.** Read the consent statement, then keep talking for 30+ seconds.
   - **From a video.** Upload a video of you talking. The app pulls out the soundtrack and picks the clearest stretch of speech (you can adjust it, up to 2 minutes). It sends that as a WAV with ElevenLabs' background-noise removal turned on.
   - **Upload audio.** Any recording of you talking.
4. For video and audio-file samples, you also record yourself reading the consent statement. The app compares the pitch of that recording with the sample and refuses to clone when they're clearly different people. Both files go to ElevenLabs, so the consent recording also improves the clone.

Speech: the script goes to `POST /v1/text-to-speech/{voice_id}` and comes back as MP3. Emotion and tone map to `stability`, `style` and `similarity_boost`, and speed maps to `speed` (0.7–1.2×). With the **v3** model, emotions are also sent as audio tags (e.g. `[excited]`). In the Create flow, the cloned voice reads the script when you leave the Voice step. The MP3 then becomes the video's narration, timed with subtitles and included in the export. Deleting a voice in the app also deletes it at ElevenLabs.

**API key handling:** the key is stored in the browser's localStorage and is only sent to `api.elevenlabs.io`. That's fine when each person uses their own key. If you run this as a service for other people, move these calls behind your own server so your key isn't exposed.

## The two engines

**In-browser (default, no backend).** Everything runs on the user's device, and uploads stay in IndexedDB.

- *Face swap:* MediaPipe face detection is loaded from jsDelivr. If it can't load, the browser's `FaceDetector` is used, and if that's missing too, the user clicks to place the face. The engine tracks the face through the video and smooths the track. It composites the user's face with a feathered mask, matches lighting and skin tone frame by frame, and follows head tilt from the eye line. An optional cut-out keeps the original mouth so lip movement and expressions come through. This is a real-time compositing preview, not a generative model: it follows position, scale and tilt, but it doesn't re-render the face at new angles.
- *Voice (no ElevenLabs key):* creates a "preview voice": the browser's built-in voice, tuned to the sample's pitch and pace. It doesn't sound like the speaker and isn't in exported files. The UI labels it and points to the real clone setup.
- *Export:* the edit is rendered to a canvas and recorded with `MediaRecorder` (MP4 where the browser supports it, otherwise WebM), with all audio mixed through Web Audio. Rendering runs in real time, so the tab must stay open.

**Cloud (set an API base URL in Dashboard → Account).** Generative face swap (and voice cloning, if you'd rather host it than use ElevenLabs) runs on your servers through the API below. The app then exports the swapped footage plus the real cloned-voice audio.

## Backend API contract

All endpoints live under the configured base URL. Requests send cookies (`credentials: 'include'`).

| Method & path | Body | Returns |
|---|---|---|
| `GET /v1/health` | — | `{ ok: true }` |
| `POST /v1/safety/screen` | multipart: `kind` (`face`/`voice`/`video`), `subjectName`, `file` | `{ allowed: boolean, reason?: string }` |
| `POST /v1/reports` | JSON report (`contentId`, `url`, `reason`, `details`, `contact`) | `{ ok: true }` |
| `POST /v1/voices` | multipart: one or more `sample` files, `name`, `consentId`, `removeNoise` | `{ voiceId }` |
| `DELETE /v1/voices/:voiceId` | — | `{ ok: true }` |
| `POST /v1/voices/:voiceId/speech` | JSON `{ text, speed, emotion, tone }` | audio file (e.g. `audio/mpeg`) |
| `POST /v1/face-swap` | multipart: `video`, `face`, `preserveExpressions` | `{ jobId }` |
| `GET /v1/jobs/:jobId` | — | `{ status: 'queued'│'running'│'succeeded'│'failed', progress: 0–1, stage?, resultPath?, error? }` |
| `GET <resultPath>` | — | the swapped video file |

Some well-known building blocks for these endpoints are InsightFace/`inswapper` or FaceFusion for face swap, and XTTS-v2, OpenVoice or a hosted voice API for cloning. Whatever you choose, check its license and terms, since several of these models restrict commercial use.

The screen endpoint is where the real protections go: face matching against protected public figures, voice anti-spoofing, and checking that the spoken consent statement in a voice sample matches the account holder.

## Safety and consent

- **Consent gate:** every face, voice and source video needs a signed consent (whether it's the user's own or someone else's with permission, three statements, and a typed signature). The record stores a SHA-256 fingerprint of the file. Records can be downloaded from Account.
- **Spoken consent for voices:** every voice needs the user reading a statement that includes their name, either at the start of a mic sample or as a separate live recording for video and file samples. Where the browser supports speech recognition, the app checks the statement, and the signature must match the spoken name. For video and file samples, the consent recording's pitch must match the sample's, which blocks the obvious case of cloning someone else from their video. It's a heuristic, not speaker verification, so do proper verification on the server if you host cloning yourself.
- **Public figures:** a name screen blocks a starter list of public figures (`PROTECTED_NAMES` in `js/safety.js`). In production, put a recognition-based check behind `/v1/safety/screen`.
- **Labeling:** an "✦ AI-generated" badge with a unique content ID is burned into every rendered frame, in previews and exports. It can't be turned off.
- **Reporting:** anyone can report content by its ID from the footer, the Trust & Safety page or the export screen.
- **Rate limits:** daily generation caps per plan (5 / 50 / 300), enforced locally. Enforce them on the server too.

## Before launch

This is a complete front end, but some parts still need a real backend:

- **Accounts and billing.** There is no sign-in, and choosing a plan only changes a local setting. Add auth and a payment provider.
- **Server-side enforcement.** Consent, identity screening, rate limits and reports are client-side in local mode, and a determined user could bypass them. Re-check all of them on the server before any generation runs.
- **Storage.** Media lives in the browser's IndexedDB. It doesn't sync across devices, and clearing site data deletes it.

## Files

```
studio/
  index.html        App shell
  css/styles.css    Design system and layout
  js/app.js         Router
  js/store.js       IndexedDB + settings
  js/api.js         Cloud provider client
  js/elevenlabs.js  ElevenLabs voice cloning + speech
  js/safety.js      Consent, labels, reporting, rate limits
  js/faceswap.js    Detection, tracking, compositing
  js/voice.js       Recording, analysis, speech
  js/player.js      Timeline renderer + export
  js/editor.js      Editor component
  js/library.js     Faces / videos
  js/projects.js    Projects, generate, downloads
  js/exportui.js    Generate & download UI
  js/views/*.js     Pages
```
