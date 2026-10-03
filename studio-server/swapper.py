"""Face swap engine: InsightFace detection + ArcFace recognition + inswapper_128.

The generative model re-renders the target face with the user's identity while
keeping the target's pose, expression, lip movement and lighting, frame by frame.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

MODEL_ROOT = Path(os.environ.get("MODEL_ROOT", Path.home() / ".insightface")).expanduser()
INSWAPPER_REPO = os.environ.get("INSWAPPER_REPO", "ezioruan/inswapper_128.onnx")
INSWAPPER_FILE = os.environ.get("INSWAPPER_FILE", "inswapper_128.onnx")

# Cosine similarity above which two ArcFace embeddings are treated as the same person.
SAME_PERSON = 0.28
LABEL_TEXT = "AI-generated"


class SwapError(Exception):
    """A problem with the user's input, safe to show to them."""


def inswapper_path() -> Path:
    local = MODEL_ROOT / "models" / INSWAPPER_FILE
    if local.exists():
        return local
    from huggingface_hub import hf_hub_download

    local.parent.mkdir(parents=True, exist_ok=True)
    return Path(hf_hub_download(INSWAPPER_REPO, INSWAPPER_FILE, local_dir=str(local.parent)))


def providers() -> list[str]:
    import onnxruntime

    available = onnxruntime.get_available_providers()
    return [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]


class InsightFaceEngine:
    def __init__(self) -> None:
        from insightface.app import FaceAnalysis
        from insightface.model_zoo.inswapper import INSwapper

        prov = providers()
        self.device = "cuda" if prov[0] == "CUDAExecutionProvider" else "cpu"
        self.analyzer = FaceAnalysis(
            name="buffalo_l", root=str(MODEL_ROOT), allowed_modules=["detection", "recognition"], providers=prov
        )
        self.analyzer.prepare(ctx_id=0 if self.device == "cuda" else -1, det_size=(640, 640))
        self.swapper = INSwapper(model_file=str(inswapper_path()))

    def faces(self, img: np.ndarray) -> list:
        return self.analyzer.get(img)

    def swap(self, frame: np.ndarray, target, source) -> np.ndarray:
        return self.swapper.get(frame, target, source, paste_back=True)


@dataclass
class _FakeFace:
    bbox: np.ndarray
    normed_embedding: np.ndarray


class FakeEngine:
    """Stand-in used by tests (FACESWAP_ENGINE=fake): one 'face' in the middle of
    every image, and a 'swap' that paints it, so the pipeline runs without weights."""

    device = "cpu"

    def faces(self, img: np.ndarray) -> list:
        h, w = img.shape[:2]
        if float(img.mean()) < 4:  # an all-black image has no face
            return []
        emb = np.ones(512, dtype=np.float32) / np.sqrt(512)
        return [_FakeFace(np.array([w * 0.35, h * 0.3, w * 0.65, h * 0.7]), emb)]

    def swap(self, frame: np.ndarray, target, source) -> np.ndarray:
        x1, y1, x2, y2 = target.bbox.astype(int)
        out = frame.copy()
        cv2.rectangle(out, (x1, y1), (x2, y2), (60, 160, 230), -1)
        return out


def load_engine():
    if os.environ.get("FACESWAP_ENGINE") == "fake":
        return FakeEngine()
    return InsightFaceEngine()


def largest(faces: list):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])) if faces else None


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def read_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise SwapError("We couldn't open this image. Use a JPG, PNG or WebP photo.")
    return img


def source_face(engine, img: np.ndarray):
    face = largest(engine.faces(img))
    if face is None:
        raise SwapError("We couldn't find a face in your photo. Use a clear, front-facing photo with good light.")
    return face


def draw_label(frame: np.ndarray) -> None:
    """Burns a small 'AI-generated' label into the bottom-left corner."""
    h, w = frame.shape[:2]
    scale = max(0.45, min(w, h) / 900)
    thick = max(1, int(round(scale * 2)))
    (tw, th), base = cv2.getTextSize(LABEL_TEXT, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    pad = int(10 * scale) + 4
    x, y = pad, h - pad
    overlay = frame.copy()
    cv2.rectangle(overlay, (x - 6, y - th - 8), (x + tw + 6, y + base + 2), (20, 10, 10), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, dst=frame)
    cv2.putText(frame, LABEL_TEXT, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), thick, cv2.LINE_AA)


def probe(path: str) -> dict:
    """fps, frame count and duration via ffprobe (more reliable than OpenCV for WebM)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
         "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_read_packets,width,height:format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=False,
    )
    try:
        j = json.loads(out.stdout or "{}")
        st = j["streams"][0]
    except (KeyError, IndexError, json.JSONDecodeError):
        raise SwapError("We couldn't read this video. Try an MP4, MOV or WebM file.")

    def rate(s: str) -> float:
        try:
            n, d = s.split("/")
            return float(n) / float(d) if float(d) else 0.0
        except (ValueError, ZeroDivisionError):
            return 0.0

    fps = rate(st.get("avg_frame_rate", "0/0")) or rate(st.get("r_frame_rate", "0/0"))
    if not 1 <= fps <= 120:
        fps = 30.0
    duration = float(j.get("format", {}).get("duration") or 0)
    frames = int(st.get("nb_read_packets") or 0) or int(duration * fps)
    return {"fps": fps, "frames": frames, "duration": duration or frames / fps}


def swap_video(
    engine,
    video_path: str,
    face_img: np.ndarray,
    out_path: str,
    *,
    max_seconds: float = 60,
    max_side: int = 1280,
    fmt: str = "mp4",
    on_progress: Callable[[float, str], None] = lambda p, s: None,
) -> dict:
    """Swaps the main person's face in the video for the face in `face_img`.

    Only the person who is most prominent in the first frame with a face is
    swapped. Other people in the video are left alone. Keeps the original audio,
    encodes H.264/AAC MP4 (or VP9/Opus WebM with fmt="webm") and burns in an
    'AI-generated' label.
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed on the server")
    info = probe(video_path)
    if info["duration"] > max_seconds + 0.5:
        raise SwapError(f"This server swaps videos up to {int(max_seconds)} seconds long. Trim the video and try again.")
    src = source_face(engine, face_img)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise SwapError("We couldn't read this video. Try an MP4, MOV or WebM file.")
    fps, total = info["fps"], max(1, info["frames"])
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    k = min(1.0, max_side / max(w, h))
    ow, oh = (int(w * k) // 2) * 2, (int(h * k) // 2) * 2

    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{ow}x{oh}", "-r", f"{fps:.3f}", "-i", "-",
         "-i", video_path, "-map", "0:v:0", "-map", "1:a:0?",
         *(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8",
            "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k"] if fmt == "webm" else
           ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]),
         "-shortest",
         "-metadata", "comment=AI-generated face swap (Visage Studio)",
         out_path],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    target_emb = None
    swapped = done = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if k < 1 or frame.shape[1] != ow or frame.shape[0] != oh:
                frame = cv2.resize(frame, (ow, oh), interpolation=cv2.INTER_AREA)
            faces = engine.faces(frame)
            if faces:
                if target_emb is None:
                    target_emb = largest(faces).normed_embedding
                best = max(faces, key=lambda f: similarity(f.normed_embedding, target_emb))
                if similarity(best.normed_embedding, target_emb) >= SAME_PERSON:
                    frame = engine.swap(frame, best, src)
                    swapped += 1
            draw_label(frame)
            enc.stdin.write(np.ascontiguousarray(frame).tobytes())
            done += 1
            if done % 5 == 0:
                on_progress(min(0.99, done / total), "Swapping faces")
    except BrokenPipeError:
        pass
    finally:
        cap.release()
        try:
            enc.stdin.close()
        except BrokenPipeError:
            pass
        err = enc.stderr.read().decode(errors="replace")
        enc.wait()
    if enc.returncode != 0:
        raise RuntimeError(f"Video encoding failed: {err[-500:]}")
    if done == 0:
        raise SwapError("This video has no frames we could read.")
    if swapped == 0:
        raise SwapError("We couldn't find a face in this video to swap. Use a clip where the face is clearly visible.")
    return {"frames": done, "swappedFrames": swapped, "width": ow, "height": oh, "fps": fps}
