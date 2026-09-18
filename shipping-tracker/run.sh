#!/usr/bin/env bash
#
# Launch the shipping tracker and expose it publicly with a free cloudflared
# "quick tunnel" (no Cloudflare account or domain required).
#
# Both the admin dashboard and the customer tracking page become reachable at
# the printed https://<random>.trycloudflare.com URL:
#
#     Customer:  https://<random>.trycloudflare.com/
#     Admin:     https://<random>.trycloudflare.com/admin
#
# Usage:
#     ADMIN_PASSWORD='choose-a-strong-password' ./run.sh
#
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8000}"
CF_BIN="./cloudflared"

# ---------------------------------------------------------------------------
# 1. Python deps (in a local virtualenv so we don't touch the system Python)
# ---------------------------------------------------------------------------
if [ ! -d ".venv" ]; then
  echo "[setup] Creating virtualenv..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# ---------------------------------------------------------------------------
# 2. Fetch cloudflared if it isn't already available
# ---------------------------------------------------------------------------
if command -v cloudflared >/dev/null 2>&1; then
  CF_BIN="$(command -v cloudflared)"
elif [ ! -x "$CF_BIN" ]; then
  echo "[setup] Downloading cloudflared..."
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${OS}-${ARCH}"
  curl -fsSL "$URL" -o "$CF_BIN"
  chmod +x "$CF_BIN"
fi

# ---------------------------------------------------------------------------
# 3. Start the app (gunicorn) and the tunnel; clean up both on exit
# ---------------------------------------------------------------------------
cleanup() {
  echo ""
  echo "[shutdown] Stopping..."
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
  [ -n "${CF_PID:-}" ] && kill "$CF_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[run] Starting web server on 127.0.0.1:${PORT}..."
gunicorn --bind "127.0.0.1:${PORT}" --workers 2 app:app &
APP_PID=$!

# Give the server a moment to come up.
sleep 2

echo "[run] Opening cloudflared quick tunnel..."
echo "      (look for the https://<random>.trycloudflare.com URL below)"
echo ""
"$CF_BIN" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" &
CF_PID=$!

# Wait on whichever process exits first.
wait -n "$APP_PID" "$CF_PID"
