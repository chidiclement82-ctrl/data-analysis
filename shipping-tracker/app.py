"""Online shipping tracker.

A single-file Flask application that provides:
  * a public, customer-facing tracking page (search by tracking number)
  * a password-protected admin dashboard to create shipments and post
    status updates

It is designed to be exposed to the internet through a free cloudflared
quick tunnel (see run.sh), so the admin area is always behind a password.

Configuration (environment variables):
  ADMIN_PASSWORD   password for the admin dashboard (required in production;
                   a random one is generated and printed if unset)
  SECRET_KEY       Flask session signing key (random if unset)
  DATABASE         path to the SQLite database file (default: shipments.db)
  PORT             port to listen on (default: 8000)
"""

import os
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.environ.get("DATABASE", os.path.join(BASE_DIR, "shipments.db"))

# The set of statuses a shipment moves through. The order matters only for
# display; any status can follow any other.
STATUSES = [
    "Label Created",
    "Picked Up",
    "In Transit",
    "Out for Delivery",
    "Delivered",
    "Exception",
]

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# Resolve the admin password once at startup. If none is configured we
# generate one and print it so the operator can still log in, rather than
# leaving the dashboard wide open with a guessable default.
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = secrets.token_urlsafe(9)
    print("=" * 60)
    print("  No ADMIN_PASSWORD set. Generated a temporary one:")
    print("      ADMIN_PASSWORD =", ADMIN_PASSWORD)
    print("  Set ADMIN_PASSWORD in the environment to keep it stable.")
    print("=" * 60)


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db


@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS shipments (
            tracking_number TEXT PRIMARY KEY,
            carrier         TEXT,
            recipient       TEXT,
            origin          TEXT,
            destination     TEXT,
            status          TEXT NOT NULL DEFAULT 'Label Created',
            eta             TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_number TEXT NOT NULL,
            status          TEXT NOT NULL,
            location        TEXT,
            note            TEXT,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (tracking_number)
                REFERENCES shipments (tracking_number) ON DELETE CASCADE
        );
        """
    )
    db.commit()
    db.close()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def new_tracking_number():
    """Generate a human-friendly, unique tracking number, e.g. ST-7F3K9Q2A."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars
    db = get_db()
    for _ in range(20):
        candidate = "ST-" + "".join(secrets.choice(alphabet) for _ in range(8))
        exists = db.execute(
            "SELECT 1 FROM shipments WHERE tracking_number = ?", (candidate,)
        ).fetchone()
        if not exists:
            return candidate
    raise RuntimeError("Could not allocate a unique tracking number")


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("is_admin"):
            return redirect(url_for("admin_login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------
# Public (customer) routes
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("track.html", shipment=None, events=None, query="")


@app.route("/track")
def track():
    tn = (request.args.get("tracking_number") or "").strip().upper()
    if not tn:
        return redirect(url_for("index"))
    db = get_db()
    shipment = db.execute(
        "SELECT * FROM shipments WHERE tracking_number = ?", (tn,)
    ).fetchone()
    events = []
    if shipment:
        events = db.execute(
            "SELECT * FROM events WHERE tracking_number = ? "
            "ORDER BY id DESC",
            (tn,),
        ).fetchall()
    return render_template(
        "track.html",
        shipment=shipment,
        events=events,
        query=tn,
        not_found=(shipment is None),
    )


@app.route("/api/track/<tracking_number>")
def api_track(tracking_number):
    tn = tracking_number.strip().upper()
    db = get_db()
    shipment = db.execute(
        "SELECT * FROM shipments WHERE tracking_number = ?", (tn,)
    ).fetchone()
    if not shipment:
        return {"found": False, "tracking_number": tn}, 404
    events = db.execute(
        "SELECT status, location, note, created_at FROM events "
        "WHERE tracking_number = ? ORDER BY id DESC",
        (tn,),
    ).fetchall()
    return {
        "found": True,
        "shipment": dict(shipment),
        "events": [dict(e) for e in events],
    }


# --------------------------------------------------------------------------
# Admin routes
# --------------------------------------------------------------------------
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        password = request.form.get("password", "")
        if secrets.compare_digest(password, ADMIN_PASSWORD):
            session["is_admin"] = True
            nxt = request.args.get("next") or url_for("admin")
            return redirect(nxt)
        flash("Incorrect password.", "error")
    return render_template("admin_login.html")


@app.route("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/admin")
@login_required
def admin():
    db = get_db()
    shipments = db.execute(
        "SELECT * FROM shipments ORDER BY updated_at DESC"
    ).fetchall()
    return render_template("admin.html", shipments=shipments, statuses=STATUSES)


@app.route("/admin/shipments", methods=["POST"])
@login_required
def create_shipment():
    f = request.form
    tn = new_tracking_number()
    ts = now_iso()
    status = f.get("status") or "Label Created"
    if status not in STATUSES:
        abort(400, "Unknown status")
    db = get_db()
    db.execute(
        "INSERT INTO shipments (tracking_number, carrier, recipient, origin, "
        "destination, status, eta, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            tn,
            f.get("carrier", "").strip(),
            f.get("recipient", "").strip(),
            f.get("origin", "").strip(),
            f.get("destination", "").strip(),
            status,
            f.get("eta", "").strip(),
            ts,
            ts,
        ),
    )
    db.execute(
        "INSERT INTO events (tracking_number, status, location, note, "
        "created_at) VALUES (?, ?, ?, ?, ?)",
        (tn, status, f.get("origin", "").strip(), "Shipment created", ts),
    )
    db.commit()
    flash(f"Created shipment {tn}.", "success")
    return redirect(url_for("shipment_detail", tracking_number=tn))


@app.route("/admin/shipments/<tracking_number>")
@login_required
def shipment_detail(tracking_number):
    tn = tracking_number.strip().upper()
    db = get_db()
    shipment = db.execute(
        "SELECT * FROM shipments WHERE tracking_number = ?", (tn,)
    ).fetchone()
    if not shipment:
        abort(404)
    events = db.execute(
        "SELECT * FROM events WHERE tracking_number = ? ORDER BY id DESC",
        (tn,),
    ).fetchall()
    return render_template(
        "shipment_detail.html",
        shipment=shipment,
        events=events,
        statuses=STATUSES,
    )


@app.route("/admin/shipments/<tracking_number>/events", methods=["POST"])
@login_required
def add_event(tracking_number):
    tn = tracking_number.strip().upper()
    f = request.form
    status = f.get("status") or ""
    if status not in STATUSES:
        abort(400, "Unknown status")
    db = get_db()
    shipment = db.execute(
        "SELECT 1 FROM shipments WHERE tracking_number = ?", (tn,)
    ).fetchone()
    if not shipment:
        abort(404)
    ts = now_iso()
    db.execute(
        "INSERT INTO events (tracking_number, status, location, note, "
        "created_at) VALUES (?, ?, ?, ?, ?)",
        (tn, status, f.get("location", "").strip(), f.get("note", "").strip(), ts),
    )
    db.execute(
        "UPDATE shipments SET status = ?, eta = COALESCE(NULLIF(?, ''), eta), "
        "updated_at = ? WHERE tracking_number = ?",
        (status, f.get("eta", "").strip(), ts, tn),
    )
    db.commit()
    flash("Status update posted.", "success")
    return redirect(url_for("shipment_detail", tracking_number=tn))


@app.route("/admin/shipments/<tracking_number>/delete", methods=["POST"])
@login_required
def delete_shipment(tracking_number):
    tn = tracking_number.strip().upper()
    db = get_db()
    db.execute("DELETE FROM shipments WHERE tracking_number = ?", (tn,))
    db.commit()
    flash(f"Deleted shipment {tn}.", "success")
    return redirect(url_for("admin"))


# --------------------------------------------------------------------------
# Template helpers
# --------------------------------------------------------------------------
@app.template_filter("status_class")
def status_class(status):
    return {
        "Label Created": "s-created",
        "Picked Up": "s-progress",
        "In Transit": "s-progress",
        "Out for Delivery": "s-progress",
        "Delivered": "s-delivered",
        "Exception": "s-exception",
    }.get(status, "s-created")


init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
