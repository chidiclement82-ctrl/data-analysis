# Visage Studio

An AI video studio: swap your face into a video, clone your voice, and make finished videos with a guided flow. It's built in plain HTML, CSS and JavaScript (ES modules), with no build step.

**Flow:** Upload → Choose face → Choose voice → Edit → Generate → Preview → Export

Once GitHub Pages deploys, it's live at `/studio/`. To run it locally, serve the repository root (`python3 -m http.server`) and open `http://localhost:8000/studio/`. ES modules don't load from `file://`.

## What's in it

| Area | Where | What it does |
|---|---|---|
| Create video | `#/create` | 7-step wizard. Saves to the project after every step. |
| Face swap | `#/face-swap` | Pick a face and a video, then compare before and after with a drag slider and tune the blend. |
| Voice clone | `#/voice` | Record (with a spoken consent statement) or upload a sample, build a voice model, then type text and adjust speed, emotion and tone. |
| Editor | `#/editor/<id>` | Trim, split and cut; text overlays; subtitles (auto from the script); music; synthesized sound effects; volumes with ducking; transitions and fades; 720p/1080p export. |
| Dashboard | `#/dashboard` | Projects, faces, voice models, generated videos, export history, account, plan and AI provider settings. |
| Trust & Safety | `#/safety` | Content policy, report form, your reports and consent records. |

## The two engines

**In-browser (default, no backend).** Everything runs on the user's device, and uploads stay in IndexedDB.

- *Face swap:* MediaPipe face detection is loaded from jsDelivr. If it can't load, the browser's `FaceDetector` is used, and if that's missing too, the user clicks to place the face. The engine tracks the face through the video and smooths the track. It composites the user's face with a feathered mask, matches lighting and skin tone frame by frame, and follows head tilt from the eye line. An optional cut-out keeps the original mouth so lip movement and expressions come through. This is a real-time compositing preview, not a generative model: it follows position, scale and tilt, but it doesn't re-render the face at new angles.
- *Voice:* measures the sample's pitch, pace and quality, and uses those to tune the browser's speech engine for previews. Browser speech can't be recorded, so in this mode the AI voice is **not in the exported file**. The UI says so and offers "record the narration yourself" instead.
- *Export:* the edit is rendered to a canvas and recorded with `MediaRecorder` (MP4 where the browser supports it, otherwise WebM), with all audio mixed through Web Audio. Rendering runs in real time, so the tab must stay open.

**Cloud (set an API base URL in Dashboard → Account).** Generative face swap and neural voice cloning run on your servers through the API below. The app then exports the swapped footage plus the real cloned-voice audio.

## Backend API contract

All endpoints live under the configured base URL. Requests send cookies (`credentials: 'include'`).

| Method & path | Body | Returns |
|---|---|---|
| `GET /v1/health` | — | `{ ok: true }` |
| `POST /v1/safety/screen` | multipart: `kind` (`face`/`voice`/`video`), `subjectName`, `file` | `{ allowed: boolean, reason?: string }` |
| `POST /v1/reports` | JSON report (`contentId`, `url`, `reason`, `details`, `contact`) | `{ ok: true }` |
| `POST /v1/voices` | multipart: `sample`, `name`, `consentId` | `{ voiceId }` |
| `POST /v1/voices/:voiceId/speech` | JSON `{ text, speed, emotion, tone }` | audio file (e.g. `audio/mpeg`) |
| `POST /v1/face-swap` | multipart: `video`, `face`, `preserveExpressions` | `{ jobId }` |
| `GET /v1/jobs/:jobId` | — | `{ status: 'queued'│'running'│'succeeded'│'failed', progress: 0–1, stage?, resultPath?, error? }` |
| `GET <resultPath>` | — | the swapped video file |

Some well-known building blocks for these endpoints are InsightFace/`inswapper` or FaceFusion for face swap, and XTTS-v2, OpenVoice or a hosted voice API for cloning. Whatever you choose, check its license and terms, since several of these models restrict commercial use.

The screen endpoint is where the real protections go: face matching against protected public figures, voice anti-spoofing, and checking that the spoken consent statement in a voice sample matches the account holder.

## Safety and consent

- **Consent gate:** every face, voice and source video needs a signed consent (whether it's the user's own or someone else's with permission, three statements, and a typed signature). The record stores a SHA-256 fingerprint of the file. Records can be downloaded from Account.
- **Spoken consent for voices:** the sample begins with the user reading a statement that includes their name. Where the browser supports speech recognition, the app checks the statement live, and the signature must match the spoken name.
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
