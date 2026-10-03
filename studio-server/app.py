"""Visage Studio face swap server.

Implements the backend API the studio front end calls when an "AI server" URL
is set in Dashboard → Account (see studio/README.md for the contract).
"""

from __future__ import annotations

import json
import os
import queue
import secrets
import tempfile
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

import swapper

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(tempfile.gettempdir()) / "visage-server"))
API_TOKEN = os.environ.get("API_TOKEN", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "30"))
MAX_SIDE = int(os.environ.get("MAX_SIDE", "1280"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "200"))
DAILY_LIMIT_PER_IP = int(os.environ.get("DAILY_LIMIT_PER_IP", "30"))
RESULT_TTL_MIN = int(os.environ.get("RESULT_TTL_MIN", "60"))
PROTECTED_FACES_DIR = os.environ.get("PROTECTED_FACES_DIR", "")
PROTECTED_MATCH = float(os.environ.get("PROTECTED_MATCH", "0.45"))
OUTPUT_FORMAT = "webm" if os.environ.get("OUTPUT_FORMAT", "mp4").lower() == "webm" else "mp4"
MEDIA_TYPE = {"mp4": "video/mp4", "webm": "video/webm"}[OUTPUT_FORMAT]

DATA_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=_load, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=sweeper, daemon=True).start()
    yield


app = FastAPI(title="Visage Studio face swap server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---------------------------------------------------------------- engine

state = {"engine": None, "error": None, "protected": []}
engine_ready = threading.Event()


def _load() -> None:
    try:
        state["engine"] = swapper.load_engine()
        state["protected"] = _load_protected(state["engine"])
    except Exception as e:  # surfaced through /v1/health
        state["error"] = f"{type(e).__name__}: {e}"
    finally:
        engine_ready.set()


def _load_protected(engine) -> list[tuple[str, np.ndarray]]:
    """Reference photos of people who must not be used as a face (file name = person)."""
    out = []
    if not PROTECTED_FACES_DIR or not Path(PROTECTED_FACES_DIR).is_dir():
        return out
    for p in sorted(Path(PROTECTED_FACES_DIR).iterdir()):
        img = cv2.imread(str(p))
        face = swapper.largest(engine.faces(img)) if img is not None else None
        if face is not None:
            out.append((p.stem.replace("_", " "), face.normed_embedding))
    return out


def engine():
    engine_ready.wait()
    if state["engine"] is None:
        raise HTTPException(503, state["error"] or "Models are not loaded")
    return state["engine"]


def protected_match(face) -> str | None:
    for name, emb in state["protected"]:
        if swapper.similarity(face.normed_embedding, emb) >= PROTECTED_MATCH:
            return name
    return None


# ---------------------------------------------------------------- auth & limits

def check_token(request: Request) -> None:
    if not API_TOKEN:
        return
    got = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not secrets.compare_digest(got, API_TOKEN):
        raise HTTPException(401, "Missing or wrong access token")


_hits: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def rate_limit(request: Request) -> None:
    ip, now = client_ip(request), time.time()
    q = _hits[ip]
    while q and now - q[0] > 86400:
        q.popleft()
    if len(q) >= DAILY_LIMIT_PER_IP:
        raise HTTPException(429, f"Daily limit of {DAILY_LIMIT_PER_IP} face swaps reached. Try again tomorrow.")
    q.append(now)


async def read_upload(f: UploadFile, max_mb: int = MAX_UPLOAD_MB) -> bytes:
    data = await f.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"Files can be up to {max_mb} MB")
    return data


# ---------------------------------------------------------------- jobs

jobs: dict[str, dict] = {}
work: queue.Queue = queue.Queue()


def public(job: dict) -> dict:
    out = {k: job[k] for k in ("id", "status", "progress", "stage", "error") if k in job}
    if job["status"] == "queued":
        out["position"] = sum(1 for j in jobs.values() if j["status"] == "queued" and j["created"] <= job["created"])
    if job["status"] == "succeeded":
        out["resultPath"] = f"/v1/results/{job['id']}"
        out["result"] = job.get("result")
    return out


def worker() -> None:
    while True:
        job = work.get()
        job["status"], job["stage"], job["progress"] = "running", "Loading AI models", 0.0
        try:
            eng = engine()
            face = swapper.read_image(Path(job["face"]).read_bytes())
            job["stage"] = "Finding faces"

            def progress(p: float, stage: str) -> None:
                job["progress"], job["stage"] = round(p, 3), stage

            job["result"] = swapper.swap_video(
                eng, job["video"], face, job["out"], max_seconds=MAX_SECONDS, max_side=MAX_SIDE, fmt=OUTPUT_FORMAT,
                on_progress=progress,
            )
            job["status"], job["progress"], job["stage"] = "succeeded", 1.0, "Done"
        except swapper.SwapError as e:
            job["status"], job["error"] = "failed", str(e)
        except HTTPException as e:
            job["status"], job["error"] = "failed", str(e.detail)
        except Exception as e:
            job["status"], job["error"] = "failed", f"Server error: {type(e).__name__}"
            print("job failed", job["id"], repr(e), flush=True)
        finally:
            for k in ("video", "face"):
                Path(job[k]).unlink(missing_ok=True)
            job["finished"] = time.time()


def sweeper() -> None:
    while True:
        time.sleep(60)
        cutoff = time.time() - RESULT_TTL_MIN * 60
        for jid, job in list(jobs.items()):
            if job.get("finished", time.time()) < cutoff:
                Path(job["out"]).unlink(missing_ok=True)
                jobs.pop(jid, None)


# ---------------------------------------------------------------- routes

@app.get("/")
def root():
    return {"name": "Visage Studio face swap server", "health": "/v1/health"}


@app.get("/v1/health")
def health():
    ready = engine_ready.is_set() and state["engine"] is not None
    return {
        "ok": state["error"] is None,
        "ready": ready,
        "loading": not engine_ready.is_set(),
        "error": state["error"],
        "device": getattr(state["engine"], "device", None),
        "maxSeconds": MAX_SECONDS,
        "tokenRequired": bool(API_TOKEN),
        "features": {"faceSwap": True, "voice": False},
        "queue": sum(1 for j in jobs.values() if j["status"] in ("queued", "running")),
    }


@app.get("/v1/auth", dependencies=[Depends(check_token)])
def auth_check():
    return {"ok": True}


@app.post("/v1/safety/screen", dependencies=[Depends(check_token)])
async def screen(kind: str = Form(...), subjectName: str = Form(""), file: UploadFile | None = File(None)):
    if kind != "face" or file is None:
        return {"allowed": True}
    data = await read_upload(file, 25)
    try:
        img = swapper.read_image(data)
    except swapper.SwapError as e:
        return {"allowed": False, "reason": str(e)}
    faces = await run_in_threadpool(lambda: engine().faces(img))
    if not faces:
        return {"allowed": False, "reason": "We couldn't find a face in this photo. Use a clear, front-facing photo."}
    who = protected_match(swapper.largest(faces))
    if who:
        return {"allowed": False, "reason": "This face matches a protected public figure and can't be used."}
    return {"allowed": True, "faces": len(faces)}


@app.post("/v1/face-swap", dependencies=[Depends(check_token)])
async def face_swap(request: Request, video: UploadFile = File(...), face: UploadFile = File(...),
                    preserveExpressions: str = Form("true")):
    rate_limit(request)
    face_bytes = await read_upload(face, 25)
    video_bytes = await read_upload(video)
    try:
        src = await run_in_threadpool(lambda: swapper.source_face(engine(), swapper.read_image(face_bytes)))
    except swapper.SwapError as e:
        raise HTTPException(422, str(e))
    if protected_match(src):
        raise HTTPException(403, "This face matches a protected public figure and can't be used.")
    jid = uuid.uuid4().hex
    vext = Path(video.filename or "v.mp4").suffix.lower()[:6] or ".mp4"
    job = {
        "id": jid, "status": "queued", "progress": 0.0, "stage": "Waiting in queue", "created": time.time(),
        "video": str(DATA_DIR / f"{jid}-in{vext}"), "face": str(DATA_DIR / f"{jid}-face.img"),
        "out": str(DATA_DIR / f"{jid}.{OUTPUT_FORMAT}"),
    }
    Path(job["video"]).write_bytes(video_bytes)
    Path(job["face"]).write_bytes(face_bytes)
    jobs[jid] = job
    work.put(job)
    return {"jobId": jid}


@app.get("/v1/jobs/{jid}", dependencies=[Depends(check_token)])
def job_status(jid: str):
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    return public(job)


@app.get("/v1/results/{jid}", dependencies=[Depends(check_token)])
def result(jid: str):
    job = jobs.get(jid)
    if not job or job["status"] != "succeeded" or not Path(job["out"]).exists():
        raise HTTPException(404, "Result not found or expired")
    return FileResponse(job["out"], media_type=MEDIA_TYPE, filename=f"face-swap-{jid[:8]}.{OUTPUT_FORMAT}")


@app.post("/v1/reports", dependencies=[Depends(check_token)])
async def report(request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "Expected JSON")
    rec = {k: str(body.get(k, ""))[:2000] for k in ("contentId", "url", "reason", "details", "contact")}
    rec["receivedAt"] = time.time()
    rec["ip"] = client_ip(request)
    with open(DATA_DIR / "reports.jsonl", "a") as f:
        f.write(json.dumps(rec) + "\n")
    return {"ok": True}


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    # The front end reads `error`.
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))
