"""Downloads the face models at build time so the first request is fast.

buffalo_l (SCRFD detector + ArcFace recognition) comes from the InsightFace
model zoo, and inswapper_128.onnx from Hugging Face (INSWAPPER_REPO).
"""

import os

os.environ.pop("FACESWAP_ENGINE", None)

import swapper  # noqa: E402

if __name__ == "__main__":
    engine = swapper.InsightFaceEngine()
    print("Models ready on", engine.device, "in", swapper.MODEL_ROOT)
