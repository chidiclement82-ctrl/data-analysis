"""API tests with the fake engine (no model weights needed):
FACESWAP_ENGINE=fake python -m pytest tests"""

import os
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

os.environ.setdefault("FACESWAP_ENGINE", "fake")
os.environ["API_TOKEN"] = "test-token"
os.environ["DAILY_LIMIT_PER_IP"] = "3"
os.environ["MAX_SECONDS"] = "6"

from fastapi.testclient import TestClient  # noqa: E402

import app as server  # noqa: E402

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        server.engine_ready.wait(10)
        yield c


def make_video(path: Path, seconds: float, audio: bool = True) -> Path:
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=15:duration={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}", "-c:a", "libopus"]
    cmd += ["-c:v", "libvpx", "-b:v", "300k", str(path)]
    subprocess.run(cmd, check=True)
    return path


def jpg(color=(120, 160, 200)) -> bytes:
    img = np.full((200, 160, 3), color, np.uint8)
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_health_is_public(client):
    j = client.get("/v1/health").json()
    assert j["ready"] and j["tokenRequired"] and j["features"]["faceSwap"]


def test_token_required(client):
    assert client.get("/v1/auth").status_code == 401
    assert client.get("/v1/auth", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/v1/auth", headers=AUTH).status_code == 200


def test_cors_preflight(client):
    r = client.options("/v1/face-swap", headers={
        "Origin": "https://ogarider.name.ng", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] in ("*", "https://ogarider.name.ng")


def test_screen_rejects_photo_without_face(client):
    black = cv2.imencode(".jpg", np.zeros((100, 100, 3), np.uint8))[1].tobytes()
    r = client.post("/v1/safety/screen", headers=AUTH, data={"kind": "face"}, files={"file": ("a.jpg", black, "image/jpeg")})
    assert r.json()["allowed"] is False
    r = client.post("/v1/safety/screen", headers=AUTH, data={"kind": "face"}, files={"file": ("a.jpg", jpg(), "image/jpeg")})
    assert r.json()["allowed"] is True


def wait(client, jid):
    for _ in range(200):
        j = client.get(f"/v1/jobs/{jid}", headers=AUTH).json()
        if j["status"] in ("succeeded", "failed"):
            return j
        time.sleep(0.1)
    raise AssertionError("job timed out")


def test_swap_end_to_end(client, tmp_path):
    vid = make_video(tmp_path / "in.webm", 2)
    r = client.post("/v1/face-swap", headers=AUTH, data={"preserveExpressions": "true"},
                    files={"video": ("in.webm", vid.read_bytes(), "video/webm"), "face": ("f.jpg", jpg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    j = wait(client, r.json()["jobId"])
    assert j["status"] == "succeeded", j
    assert j["result"]["swappedFrames"] == j["result"]["frames"] > 20
    out = client.get(j["resultPath"], headers=AUTH)
    assert out.status_code == 200 and out.headers["content-type"] == "video/mp4"
    p = tmp_path / "out.mp4"
    p.write_bytes(out.content)
    streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(p)],
                             capture_output=True, text=True).stdout.split()
    assert streams == ["h264", "aac"]
    # the swap and the label are in the pixels
    cap = cv2.VideoCapture(str(p))
    ok, frame = cap.read()
    assert ok
    h, w = frame.shape[:2]
    center = frame[int(h * 0.45):int(h * 0.55), int(w * 0.45):int(w * 0.55)].mean(axis=(0, 1))
    assert abs(center[0] - 60) < 25 and abs(center[2] - 230) < 25


def test_swap_rejects_long_video_and_faceless_photo(client, tmp_path):
    vid = make_video(tmp_path / "long.webm", 8, audio=False)
    r = client.post("/v1/face-swap", headers=AUTH,
                    files={"video": ("long.webm", vid.read_bytes(), "video/webm"), "face": ("f.jpg", jpg(), "image/jpeg")})
    j = wait(client, r.json()["jobId"])
    assert j["status"] == "failed" and "6 seconds" in j["error"]
    black = cv2.imencode(".jpg", np.zeros((100, 100, 3), np.uint8))[1].tobytes()
    r = client.post("/v1/face-swap", headers=AUTH,
                    files={"video": ("long.webm", vid.read_bytes(), "video/webm"), "face": ("f.jpg", black, "image/jpeg")})
    assert r.status_code == 422 and "couldn't find a face" in r.json()["error"]


def test_rate_limit(client, tmp_path):
    vid = make_video(tmp_path / "v.webm", 1)
    codes = []
    for _ in range(3):
        r = client.post("/v1/face-swap", headers=AUTH,
                        files={"video": ("v.webm", vid.read_bytes(), "video/webm"), "face": ("f.jpg", jpg(), "image/jpeg")})
        codes.append(r.status_code)
    assert codes[-1] == 429 and "Daily limit" in r.json()["error"]


def test_reports_are_stored(client):
    r = client.post("/v1/reports", headers=AUTH, json={"contentId": "VS-AAAA-BBBB", "reason": "impersonation"})
    assert r.json() == {"ok": True}
    assert "VS-AAAA-BBBB" in (server.DATA_DIR / "reports.jsonl").read_text()
