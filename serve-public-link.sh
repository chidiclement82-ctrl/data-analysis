#!/usr/bin/env bash
#
# serve-public-link.sh — publish this site to a public Cloudflare Tunnel link.
#
# What it does:
#   1. Starts a local web server for this repo (so / and /tracker/ both work).
#   2. Opens a Cloudflare Tunnel and prints a public https://<name>.trycloudflare.com URL.
#
# Your public links will be:
#   Customer :  https://<name>.trycloudflare.com/tracker/
#   Admin    :  https://<name>.trycloudflare.com/tracker/admin.html
#   Dashboard:  https://<name>.trycloudflare.com/
#
# NOTE: the URL is temporary and changes each time you run this. It only works
# while this command keeps running. For customers on other devices to share
# balances/messages, connect Firebase first (see tracker/README.md) — demo mode
# is per-browser only.
#
# Usage:   bash serve-public-link.sh          (default port 8000)
#          PORT=9000 bash serve-public-link.sh
#
set -euo pipefail

PORT="${PORT:-8000}"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # repo root

# --- pick a Python for the static server ---------------------------------
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python  >/dev/null 2>&1; then PY=python
else
  echo "ERROR: Python is not installed. Install Python 3 from https://python.org and retry." >&2
  exit 1
fi

# --- check cloudflared ----------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 <<'EOF'
ERROR: cloudflared is not installed. Install it, then run this script again:

  macOS   :  brew install cloudflared
  Windows :  winget install --id Cloudflare.cloudflared     (then use PowerShell steps in tracker/README.md)
  Linux   :  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

EOF
  exit 1
fi

# --- start the local server ----------------------------------------------
echo "Starting local server on http://localhost:${PORT} ..."
"$PY" -m http.server "$PORT" >/tmp/ledgerline-server.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
sleep 1

echo
echo "Opening Cloudflare Tunnel — your PUBLIC link appears below (look for trycloudflare.com)."
echo "Append /tracker/ for the customer app, or /tracker/admin.html for the admin app."
echo "Press Ctrl+C to stop."
echo

# Runs in the foreground; cloudflared prints the public URL.
cloudflared tunnel --url "http://localhost:${PORT}"
