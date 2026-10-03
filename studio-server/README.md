---
title: Visage Face Swap
emoji: 🎭
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Visage Studio face swap server

This server does the real AI face swap for [Visage Studio](../studio/). It uses InsightFace: the SCRFD detector and ArcFace recognition (`buffalo_l`) find and identify faces, and `inswapper_128` swaps them. The model redraws the user's face in every frame while keeping the original's expressions, lip movement, head turns and lighting. The original audio is kept, and an "AI-generated" label is burned into the video.

The model weights are released by InsightFace for **non-commercial research use only**. That covers `inswapper_128` and `buffalo_l`. Before charging for face swaps, get a commercial license from InsightFace or switch to a model whose license allows it.

## Put it online on Hugging Face Spaces (free)

1. Create an account at [huggingface.co](https://huggingface.co).
2. Click **New → Space**. Give it a name (e.g. `visage-faceswap`), choose **Docker** as the SDK and **Blank** as the template, and pick hardware:
   - **CPU basic (free):** works, but slowly. A 10-second clip takes a few minutes.
   - **A GPU (paid):** around 10–20× faster.
3. In **Settings → Variables and secrets** add:
   - Secret **`API_TOKEN`**: any long random password. Without it, anyone who finds the URL can use your server.
   - Variable **`ALLOWED_ORIGINS`**: `https://ogarider.name.ng` (your site's address).
4. Upload the files from this folder (`Dockerfile`, `app.py`, `swapper.py`, `download_models.py`, `requirements.txt`, `README.md`) with **Files → Add file → Upload files**. Or let GitHub do it automatically (see below).
5. Wait for the build to finish (5–10 minutes the first time, because it downloads about 600 MB of models). The Space then shows **Running**.
6. In Visage Studio, open **Dashboard → Account → AI face swap server**. Paste `https://<your-username>-<space-name>.hf.space` and your `API_TOKEN`, then press **Save & test**. It should say "Connected · AI models ready".

Free Spaces go to sleep after about 48 hours without use, and the next request wakes them up (about a minute).

### Deploy automatically from GitHub

The workflow `.github/workflows/deploy-faceswap-server.yml` uploads this folder to your Space whenever it changes on `main`. In the GitHub repository's **Settings → Secrets and variables → Actions**, add:

- Secret **`HF_TOKEN`**: a Hugging Face access token with **write** permission (huggingface.co → Settings → Access Tokens).
- Variable **`HF_SPACE`**: your Space's id, e.g. `your-username/visage-faceswap`.

Then run the workflow once from the **Actions** tab, or push a change to `studio-server/`.

## Run it anywhere else

```bash
docker build -t visage-faceswap studio-server
docker run -p 7860:7860 -e API_TOKEN=change-me -e ALLOWED_ORIGINS=https://ogarider.name.ng visage-faceswap
# NVIDIA GPU: install onnxruntime-gpu instead of onnxruntime and run with --gpus all
```

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `API_TOKEN` | *(none)* | When set, every request except `/v1/health` needs `Authorization: Bearer <token>`. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated sites that may call the server from a browser. |
| `MAX_SECONDS` | `30` | Longest video accepted. Raise it on a GPU. |
| `MAX_SIDE` | `1280` | Frames are scaled down so the longest side is at most this many pixels. |
| `OUTPUT_FORMAT` | `mp4` | `mp4` (H.264/AAC, plays everywhere) or `webm` (VP9/Opus). |
| `DAILY_LIMIT_PER_IP` | `30` | Face swaps per IP address per 24 hours. |
| `MAX_UPLOAD_MB` | `200` | Largest upload. |
| `RESULT_TTL_MIN` | `60` | Finished videos are deleted after this many minutes. |
| `PROTECTED_FACES_DIR` | *(none)* | Folder of reference photos (`Firstname_Lastname.jpg`) of people whose faces must never be used. Uploads that match are refused. |
| `PROTECTED_MATCH` | `0.45` | Face-similarity threshold for that check. |
| `INSWAPPER_REPO` / `INSWAPPER_FILE` | `ezioruan/inswapper_128.onnx` / `inswapper_128.onnx` | Where the swap model is downloaded from on Hugging Face. |

## API

| Method & path | What it does |
|---|---|
| `GET /v1/health` | `{ ready, loading, device, maxSeconds, tokenRequired, … }`, no token needed |
| `GET /v1/auth` | Checks the token |
| `POST /v1/safety/screen` | Form: `kind=face`, `file`. Refuses photos with no face or a protected face |
| `POST /v1/face-swap` | Form: `video`, `face`. Returns `{ jobId }` |
| `GET /v1/jobs/{id}` | `{ status: queued│running│succeeded│failed, progress, stage, position?, resultPath?, error? }` |
| `GET /v1/results/{id}` | The swapped video |
| `POST /v1/reports` | Stores an abuse report (JSON) in `reports.jsonl` |

Safety on the server: the source photo must contain a face and must not match the protected gallery. Only the most prominent person in the video is swapped, never bystanders. Uploads and results are deleted automatically, and there's a daily per-IP limit.

## Tests

The tests use a stand-in engine, so no model weights are needed:

```bash
pip install -r requirements.txt pytest httpx
FACESWAP_ENGINE=fake python -m pytest tests
```
