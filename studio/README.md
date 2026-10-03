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

## Real AI face swap (your server)

The generative face swap runs on the **Visage face swap server** in [`../studio-server`](../studio-server/README.md). That's a small Python service using InsightFace's `inswapper_128` model, which redraws the user's face in every frame while keeping the original expressions, lip movement, head turns and lighting. It runs free on Hugging Face Spaces (CPU, slow) or on any GPU machine. The setup steps, including automatic deployment from GitHub, are in that folder's README.

Connect it in **Dashboard → Account → AI face swap server** (URL plus access token). After that:

- **Face swap**, the wizard's **Choose face** step, and the editor's **Face swap** tab send the video and the face photo to the server, show its progress and queue position, and download the swapped video. The before/after slider compares the original with the AI result.
- The swapped footage replaces the source in the project, so trims, text, subtitles, the cloned voice, music and the "AI-generated" label are all rendered on top of it at export.
- Face photos are screened by the server when added: a face must be present, and it must not match the server's protected-people gallery. If the server can't be reached, the photo isn't accepted.

Without a server, the site falls back to the **in-browser preview**. MediaPipe detects and tracks the face (or the user clicks to place it), and the user's face is overlaid with a feathered mask, per-frame lighting match and head tilt. It's instant, but it's an overlay, not a generated face, and the UI labels it as a preview.

**Voice** without an ElevenLabs key is a "preview voice": the browser's built-in voice tuned to the sample's pitch and pace. It doesn't sound like the speaker and isn't included in exports.

**Export:** the edit is rendered to a canvas and recorded with `MediaRecorder` (MP4 where the browser supports it, otherwise WebM), with all audio mixed through Web Audio. Rendering runs in real time, so the tab must stay open.

## Server API

Requests carry `Authorization: Bearer <token>` when a token is set, and no cookies. The full table is in [`studio-server/README.md`](../studio-server/README.md#api). The ones the studio uses are `GET /v1/health`, `GET /v1/auth`, `POST /v1/safety/screen`, `POST /v1/face-swap`, `GET /v1/jobs/:id`, `GET /v1/results/:id` and `POST /v1/reports`. Any backend that implements these can stand in for the bundled server.

## Safety and consent

- **Consent gate:** every face, voice and source video needs a signed consent (whether it's the user's own or someone else's with permission, three statements, and a typed signature). The record stores a SHA-256 fingerprint of the file. Records can be downloaded from Account.
- **Spoken consent for voices:** every voice needs the user reading a statement that includes their name, either at the start of a mic sample or as a separate live recording for video and file samples. Where the browser supports speech recognition, the app checks the statement, and the signature must match the spoken name. For video and file samples, the consent recording's pitch must match the sample's, which blocks the obvious case of cloning someone else from their video. It's a heuristic, not speaker verification, so do proper verification on the server if you host cloning yourself.
- **Public figures:** a name screen blocks a starter list of public figures (`PROTECTED_NAMES` in `js/safety.js`). With the face swap server, photos are also matched by face against a gallery of protected people (`PROTECTED_FACES_DIR`).
- **Labeling:** an "✦ AI-generated" badge with a unique content ID is burned into every rendered frame, in previews and exports. It can't be turned off.
- **Reporting:** anyone can report content by its ID from the footer, the Trust & Safety page or the export screen.
- **Rate limits:** daily generation caps per plan (5 / 50 / 300), enforced locally. Enforce them on the server too.

## Before launch

This is a complete front end, but some parts still need a real backend:

- **Accounts and billing.** There is no sign-in, and choosing a plan only changes a local setting. Add auth and a payment provider.
- **Server-side enforcement.** The face swap server enforces its own checks: a face must be in the photo, protected faces are refused, there's a daily per-IP limit, and only the main person is swapped. Consent records, plan limits and the voice checks still live in the browser, so move them server-side alongside accounts.
- **Model licenses.** InsightFace's `inswapper_128` and `buffalo_l` weights are for non-commercial use. Get a commercial license, or swap in a different model, before charging for face swaps.
- **Storage.** Media lives in the browser's IndexedDB. It doesn't sync across devices, and clearing site data deletes it.

## Files

```
studio/
  index.html        App shell
  css/styles.css    Design system and layout
  js/app.js         Router
  js/store.js       IndexedDB + settings
  js/api.js         Face swap server + voice provider client
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
