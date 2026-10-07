# Tradesafe escrow marketplace server. Runs on Hugging Face Spaces (Docker SDK),
# or anywhere Docker runs: docker build -t tradesafe . && docker run -p 7860:7860 -v tradesafe-data:/data tradesafe
FROM python:3.11-slim

# Hugging Face Spaces runs containers as user 1000.
RUN useradd -m -u 1000 user && mkdir -p /data && chown user /data
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    DATA_DIR=/data \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user app.py payments.py ./

EXPOSE 7860
# One worker: the server keeps its write lock in memory, so it must not run as several processes.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
