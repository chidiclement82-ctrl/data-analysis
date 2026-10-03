# Visage Studio face swap server. Runs on Hugging Face Spaces (Docker SDK),
# or anywhere Docker runs: docker build -t visage-faceswap . && docker run -p 7860:7860 visage-faceswap
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs containers as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    MODEL_ROOT=/home/user/models \
    DATA_DIR=/tmp/visage-server \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user swapper.py app.py download_models.py ./
RUN python download_models.py

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
