# Shipping Tracker

A tiny, self-contained shipment tracking web app that you can put online in
seconds through a **free cloudflared quick tunnel** — no Cloudflare account,
no domain, no port forwarding.

- **Customers** open the public link and type their tracking number to see the
  current status and full history.
- **Admins** log in (password-protected) to create shipments and post status
  updates.

Both live behind one public `https://<random>.trycloudflare.com` URL:

| Who      | Link                                             |
| -------- | ------------------------------------------------ |
| Customer | `https://<random>.trycloudflare.com/`            |
| Admin    | `https://<random>.trycloudflare.com/admin`       |

## Quick start

### Windows — double-click `run.bat`

Just double-click **`run.bat`** in the `shipping-tracker` folder (or run it from
PowerShell / Command Prompt). It will prompt for an admin password, then set
everything up and open the tunnel. It uses `waitress` as the web server
(gunicorn is Unix-only and does not run on Windows).

### macOS / Linux — `run.sh`

```bash
cd shipping-tracker
ADMIN_PASSWORD='pick-a-strong-password' ./run.sh
```

Both launchers will:

1. create a local virtualenv and install `Flask` + `gunicorn`,
2. download `cloudflared` if it isn't already installed,
3. start the app on `127.0.0.1:8000`, and
4. open a quick tunnel and print the public `trycloudflare.com` URL.

Share the root URL with customers; keep `/admin` for yourself.

> If you don't set `ADMIN_PASSWORD`, a random one is generated and printed to
> the console at startup so the dashboard is never left open.

## Running the app on its own (no tunnel)

```bash
pip install -r requirements.txt
ADMIN_PASSWORD='...' python app.py     # http://localhost:8000
```

## Configuration

| Variable         | Default          | Purpose                                  |
| ---------------- | ---------------- | ---------------------------------------- |
| `ADMIN_PASSWORD` | random (printed) | Password for `/admin`.                   |
| `SECRET_KEY`     | random           | Flask session signing key.               |
| `DATABASE`       | `shipments.db`   | SQLite database path.                    |
| `PORT`           | `8000`           | Local port the app listens on.           |

## How it works

- **`app.py`** — Flask app with SQLite storage (`shipments` + `events`
  tables). Public routes render the tracking page and a JSON API
  (`/api/track/<tracking_number>`); admin routes are guarded by a session
  login using `secrets.compare_digest` against `ADMIN_PASSWORD`.
- **Tracking numbers** are generated server-side (`ST-XXXXXXXX`, unambiguous
  alphabet) and are the customer's key to their shipment.
- **`run.sh`** — one command to install deps, fetch cloudflared, serve with
  gunicorn, and open the public quick tunnel.

## Notes & limits

- A quick tunnel URL is **random and temporary** — it changes each run. For a
  stable address, create a
  [named tunnel](https://developers.cloudflare.com/cloudflare-tunnel/) with a
  Cloudflare account and your own domain, pointing it at `127.0.0.1:8000`.
- The SQLite database (`shipments.db`) and the `.venv` / `cloudflared` binary
  are git-ignored.
- This is a lightweight tool; treat the admin password as the only thing
  standing between the internet and your dashboard, and choose a strong one.
