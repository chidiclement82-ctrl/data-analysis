"""Tradesafe escrow marketplace server.

Buyers pay into escrow; the money is only released to the seller after the
buyer confirms the item arrived (or the inspection window runs out without a
complaint). If the seller never ships, or a dispute is decided for the buyer,
the money goes back to the buyer.

Order lifecycle (every change is written to the order's timeline):

    awaiting_payment ─pay─▶ paid ─ship─▶ shipped ─confirm─▶ released ─▶ seller paid out
          │                  │  │           │  └─inspection window ends─▶ released
          │                  │  └─dispute─┐ └─dispute─▶ disputed ─admin─▶ released | refunded
          │                  └─seller cancels / ship deadline passes─▶ refunded
          └─buyer cancels / payment window ends─▶ cancelled
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

import payments

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:7860").rstrip("/")
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
CURRENCY = os.environ.get("CURRENCY", "NGN").upper()
FEE_PERCENT = float(os.environ.get("FEE_PERCENT", "2.5"))
MAX_PRICE = int(os.environ.get("MAX_PRICE", "5000000"))  # major units (₦)
PAY_WINDOW_MIN = int(os.environ.get("PAY_WINDOW_MIN", "30"))
SHIP_DAYS = float(os.environ.get("SHIP_DAYS", "3"))
INSPECTION_DAYS = float(os.environ.get("INSPECTION_DAYS", "3"))
MAX_PHOTO_MB = float(os.environ.get("MAX_PHOTO_MB", "2"))

DAY = 86400
DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = DATA_DIR / "photos"
PHOTO_DIR.mkdir(exist_ok=True)

provider = payments.make_provider(PUBLIC_URL)
CATEGORIES = ["Phones & tablets", "Electronics", "Fashion", "Home & kitchen", "Vehicles & parts",
              "Beauty", "Baby & kids", "Sports", "Books", "Other"]


def now() -> int:
    return int(time.time())


# ---------------------------------------------------------------- database

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT DEFAULT '',
  pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
  bank_code TEXT DEFAULT '', account_number TEXT DEFAULT '', account_name TEXT DEFAULT '', recipient TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  category TEXT NOT NULL, price INTEGER NOT NULL, currency TEXT NOT NULL, location TEXT DEFAULT '',
  photo TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, listing_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL, title TEXT NOT NULL,
  amount INTEGER NOT NULL, fee INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  delivery_address TEXT NOT NULL, created_at INTEGER NOT NULL,
  paid_at INTEGER, ship_by INTEGER, shipped_at INTEGER, release_at INTEGER, closed_at INTEGER,
  ship_note TEXT DEFAULT '', dispute_reason TEXT DEFAULT '', was_shipped INTEGER DEFAULT 0,
  payout_status TEXT DEFAULT '', payout_ref TEXT DEFAULT '', refund_status TEXT DEFAULT '', refund_ref TEXT DEFAULT '',
  rating INTEGER, review TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS events_order ON events(order_id);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, created_at);
"""

db = sqlite3.connect(DATA_DIR / "market.db", check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute("PRAGMA journal_mode=WAL")
db.executescript(SCHEMA)
lock = threading.RLock()  # one writer at a time; every money state change happens under it


def fetch(sql: str, *args) -> list[sqlite3.Row]:
    with lock:
        return db.execute(sql, args).fetchall()


def fetch1(sql: str, *args) -> sqlite3.Row | None:
    rows = fetch(sql, *args)
    return rows[0] if rows else None


def log(order_id: int, actor: str, kind: str, note: str = "") -> None:
    db.execute("INSERT INTO events(order_id, at, actor, kind, note) VALUES (?,?,?,?,?)", (order_id, now(), actor, kind, note))


def transition(order_id: int, frm: tuple[str, ...], to: str, actor: str, kind: str, note: str = "", **fields) -> bool:
    """Atomically move an order from one of `frm` to `to`. Returns False if it had already moved
    (so a double click, a retried webhook or the sweeper racing a user can never pay out twice)."""
    sets = ", ".join(["status=?"] + [f"{k}=?" for k in fields])
    marks = ",".join("?" * len(frm))
    with lock:
        db.execute("BEGIN IMMEDIATE")
        try:
            cur = db.execute(f"UPDATE orders SET {sets} WHERE id=? AND status IN ({marks})",
                             (to, *fields.values(), order_id, *frm))
            if cur.rowcount:
                log(order_id, actor, kind, note)
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return bool(cur.rowcount)


# ---------------------------------------------------------------- app

@asynccontextmanager
async def lifespan(_app):
    stop = threading.Event()

    def loop():
        while not stop.wait(60):
            try:
                sweep()
            except Exception as e:  # keep sweeping; the next pass retries
                print("sweep failed:", e)

    threading.Thread(target=loop, daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Tradesafe escrow marketplace", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Token"],
)


# ---------------------------------------------------------------- auth

def hash_pw(pw: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def check_pw(pw: str, stored: str) -> bool:
    try:
        _, salt, _ = stored.split("$")
    except ValueError:
        return False
    return secrets.compare_digest(hash_pw(pw, bytes.fromhex(salt)), stored)


def new_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with lock:
        db.execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, now()))
    return token


def current_user(authorization: str = Header("")) -> sqlite3.Row:
    token = authorization.removeprefix("Bearer ").strip()
    row = fetch1("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
             hashlib.sha256(token.encode()).hexdigest()) if token else None
    if not row:
        raise HTTPException(401, "Please sign in.")
    return row


def require_admin(x_admin_token: str = Header("")) -> None:
    if not ADMIN_TOKEN or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(403, "Admin token required.")


failed_logins: dict[str, deque] = defaultdict(deque)


def rate_limit_login(ip: str) -> None:
    d = failed_logins[ip]
    while d and d[0] < now() - 900:
        d.popleft()
    if len(d) >= 10:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")


def me_json(u: sqlite3.Row) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u["name"], "phone": u["phone"],
            "payout": {"bankCode": u["bank_code"], "accountNumber": u["account_number"][-4:].rjust(len(u["account_number"]), "•"),
                       "accountName": u["account_name"]} if u["recipient"] else None}


class Register(BaseModel):
    email: str = Field(max_length=200)
    name: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8, max_length=200)
    phone: str = Field("", max_length=30)


class Login(BaseModel):
    email: str
    password: str


@app.post("/v1/auth/register")
def register(body: Register):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "Enter a valid email address.")
    with lock:
        if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(409, "An account with this email already exists. Sign in instead.")
        cur = db.execute("INSERT INTO users(email, name, phone, pw_hash, created_at) VALUES (?,?,?,?,?)",
                         (email, body.name.strip(), body.phone.strip(), hash_pw(body.password), now()))
    user = fetch1("SELECT * FROM users WHERE id=?", cur.lastrowid)
    return {"token": new_session(user["id"]), "user": me_json(user)}


@app.post("/v1/auth/login")
def login(body: Login, request: Request):
    ip = request.client.host if request.client else "?"
    rate_limit_login(ip)
    user = fetch1("SELECT * FROM users WHERE email=?", body.email.strip().lower())
    if not user or not check_pw(body.password, user["pw_hash"]):
        failed_logins[ip].append(now())
        raise HTTPException(401, "Wrong email or password.")
    return {"token": new_session(user["id"]), "user": me_json(user)}


@app.post("/v1/auth/logout")
def logout(authorization: str = Header("")):
    token = authorization.removeprefix("Bearer ").strip()
    with lock:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    return {"ok": True}


@app.get("/v1/me")
def me(user=Depends(current_user)):
    return me_json(user)


class Payout(BaseModel):
    bankCode: str = Field(min_length=1, max_length=20)
    accountNumber: str = Field(min_length=6, max_length=20)


@app.get("/v1/banks")
def banks():
    try:
        return provider.banks(CURRENCY)
    except payments.PaymentError as e:
        raise HTTPException(502, str(e))


@app.put("/v1/me/payout")
def set_payout(body: Payout, user=Depends(current_user)):
    if not body.accountNumber.isdigit():
        raise HTTPException(400, "Account number should be digits only.")
    try:
        name = provider.resolve_account(body.bankCode, body.accountNumber)
        recipient = provider.create_recipient(name=name, bank_code=body.bankCode,
                                              account_number=body.accountNumber, currency=CURRENCY)
    except payments.PaymentError as e:
        raise HTTPException(400, f"Could not verify that account: {e}")
    with lock:
        db.execute("UPDATE users SET bank_code=?, account_number=?, account_name=?, recipient=? WHERE id=?",
                   (body.bankCode, body.accountNumber, name, recipient, user["id"]))
    # Money already released while the seller had no bank account goes out now.
    for o in fetch("SELECT id FROM orders WHERE seller_id=? AND status='released' AND payout_status='awaiting_bank'", user["id"]):
        pay_out(o["id"])
    return me_json(fetch1("SELECT * FROM users WHERE id=?", user["id"]))


# ---------------------------------------------------------------- listings

def seller_stats(seller_id: int) -> dict:
    r = fetch1("""SELECT
        SUM(status='released') AS sold,
        SUM(status='refunded' AND dispute_reason!='') AS lost_disputes,
        AVG(rating) AS rating, COUNT(rating) AS reviews
        FROM orders WHERE seller_id=?""", seller_id)
    u = fetch1("SELECT name, created_at, recipient FROM users WHERE id=?", seller_id)
    return {"id": seller_id, "name": u["name"] if u else "?", "memberSince": u["created_at"] if u else None,
            "completedSales": r["sold"] or 0, "disputesLost": r["lost_disputes"] or 0,
            "rating": round(r["rating"], 1) if r["rating"] else None, "reviews": r["reviews"] or 0,
            "payoutVerified": bool(u and u["recipient"])}


def listing_json(row: sqlite3.Row, full: bool = False) -> dict:
    d = {"id": row["id"], "title": row["title"], "category": row["category"], "price": row["price"],
         "currency": row["currency"], "location": row["location"], "status": row["status"],
         "photo": f"{PUBLIC_URL}/v1/photos/{row['photo']}" if row["photo"] else None,
         "createdAt": row["created_at"], "sellerId": row["seller_id"]}
    if full:
        d["description"] = row["description"]
        d["seller"] = seller_stats(row["seller_id"])
    return d


class NewListing(BaseModel):
    title: str = Field(min_length=3, max_length=100)
    description: str = Field(min_length=10, max_length=4000)
    category: str
    price: float = Field(gt=0)
    location: str = Field("", max_length=80)
    photo: str = Field("", description="data: URL of a JPEG, PNG or WebP")


def save_photo(data_url: str) -> str:
    m = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", data_url.strip())
    if not m:
        raise HTTPException(400, "Photo must be a JPEG, PNG or WebP image.")
    raw = base64.b64decode(m.group(2))
    if len(raw) > MAX_PHOTO_MB * 1024 * 1024:
        raise HTTPException(413, f"Photo is too large (max {MAX_PHOTO_MB:g} MB).")
    magic = {"jpeg": raw[:3] == b"\xff\xd8\xff", "png": raw[:8] == b"\x89PNG\r\n\x1a\n",
             "webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"}
    if not magic[m.group(1)]:
        raise HTTPException(400, "That file isn't a valid image.")
    name = f"{uuid.uuid4().hex}.{'jpg' if m.group(1) == 'jpeg' else m.group(1)}"
    (PHOTO_DIR / name).write_bytes(raw)
    return name


@app.get("/v1/photos/{name}")
def photo(name: str):
    if not re.fullmatch(r"[0-9a-f]{32}\.(jpg|png|webp)", name) or not (PHOTO_DIR / name).exists():
        raise HTTPException(404, "No such photo.")
    return FileResponse(PHOTO_DIR / name, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/v1/listings")
def list_listings(q: str = "", category: str = "", seller: int = 0, limit: int = 60):
    sql, args = "SELECT * FROM listings WHERE status='active'", []
    if q := q.strip():
        sql += " AND (title LIKE ? OR description LIKE ? OR location LIKE ?)"
        args += [f"%{q}%"] * 3
    if category:
        sql += " AND category=?"
        args.append(category)
    if seller:
        sql += " AND seller_id=?"
        args.append(seller)
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(max(1, min(limit, 200)))
    return [listing_json(r) for r in fetch(sql, *args)]



@app.get("/v1/listings/{lid}")
def get_listing(lid: int):
    row = fetch1("SELECT * FROM listings WHERE id=? AND status!='removed'", lid)
    if not row:
        raise HTTPException(404, "This listing is no longer available.")
    return listing_json(row, full=True)


@app.post("/v1/listings")
def create_listing(body: NewListing, user=Depends(current_user)):
    if body.category not in CATEGORIES:
        raise HTTPException(400, "Pick a category.")
    if body.price > MAX_PRICE:
        raise HTTPException(400, f"The most an item can cost here is {MAX_PRICE:,}.")
    name = save_photo(body.photo) if body.photo else ""
    with lock:
        cur = db.execute(
            "INSERT INTO listings(seller_id, title, description, category, price, currency, location, photo, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (user["id"], body.title.strip(), body.description.strip(), body.category, round(body.price * 100),
             CURRENCY, body.location.strip(), name, now()))
    return listing_json(fetch1("SELECT * FROM listings WHERE id=?", cur.lastrowid), full=True)


@app.get("/v1/my/listings")
def my_listings(user=Depends(current_user)):
    return [listing_json(r) for r in fetch("SELECT * FROM listings WHERE seller_id=? AND status!='removed' ORDER BY created_at DESC", user["id"])]


@app.delete("/v1/listings/{lid}")
def remove_listing(lid: int, user=Depends(current_user)):
    with lock:
        cur = db.execute("UPDATE listings SET status='removed' WHERE id=? AND seller_id=? AND status IN ('active','paused')",
                         (lid, user["id"]))
    if not cur.rowcount:
        raise HTTPException(409, "Only your own listings that aren't in an active order can be removed.")
    return {"ok": True}


@app.post("/v1/listings/{lid}/relist")
def relist(lid: int, user=Depends(current_user)):
    with lock:
        cur = db.execute("UPDATE listings SET status='active' WHERE id=? AND seller_id=? AND status='paused'", (lid, user["id"]))
    if not cur.rowcount:
        raise HTTPException(409, "This listing can't be relisted.")
    return {"ok": True}


@app.get("/v1/users/{uid}")
def profile(uid: int):
    if not fetch1("SELECT 1 FROM users WHERE id=?", uid):
        raise HTTPException(404, "No such user.")
    reviews = fetch("""SELECT o.rating, o.review, o.closed_at, u.name AS buyer FROM orders o JOIN users u ON u.id=o.buyer_id
                   WHERE o.seller_id=? AND o.rating IS NOT NULL ORDER BY o.closed_at DESC LIMIT 20""", uid)
    return {**seller_stats(uid),
            "reviewList": [{"rating": r["rating"], "text": r["review"], "at": r["closed_at"], "buyer": r["buyer"].split()[0]} for r in reviews],
            "listings": list_listings(seller=uid)}


@app.get("/v1/categories")
def categories():
    return CATEGORIES


# ---------------------------------------------------------------- orders

def order_row(oid: int) -> sqlite3.Row:
    o = fetch1("SELECT * FROM orders WHERE id=?", oid)
    if not o:
        raise HTTPException(404, "No such order.")
    return o


def party(o: sqlite3.Row, user: sqlite3.Row) -> str:
    if user["id"] == o["buyer_id"]:
        return "buyer"
    if user["id"] == o["seller_id"]:
        return "seller"
    raise HTTPException(404, "No such order.")


def order_json(o: sqlite3.Row, role: str | None = None) -> dict:
    d = {"id": o["id"], "ref": o["ref"], "listingId": o["listing_id"], "title": o["title"],
         "amount": o["amount"], "fee": o["fee"], "sellerGets": o["amount"] - o["fee"], "currency": o["currency"],
         "status": o["status"], "createdAt": o["created_at"], "paidAt": o["paid_at"], "shipBy": o["ship_by"],
         "shippedAt": o["shipped_at"], "releaseAt": o["release_at"], "closedAt": o["closed_at"],
         "payoutStatus": o["payout_status"], "refundStatus": o["refund_status"],
         "rating": o["rating"], "review": o["review"],
         "buyer": fetch1("SELECT name FROM users WHERE id=?", o["buyer_id"])["name"],
         "seller": seller_stats(o["seller_id"])}
    if role:
        d["role"] = role
        d["deliveryAddress"] = o["delivery_address"]
        d["shipNote"] = o["ship_note"]
        d["disputeReason"] = o["dispute_reason"]
        d["payWindowEnds"] = o["created_at"] + PAY_WINDOW_MIN * 60
        d["events"] = [dict(e) for e in fetch("SELECT at, actor, kind, note FROM events WHERE order_id=? ORDER BY id", o["id"])]
        d["messages"] = [{"at": m["at"], "from": "buyer" if m["user_id"] == o["buyer_id"] else "seller", "body": m["body"]}
                         for m in fetch("SELECT * FROM messages WHERE order_id=? ORDER BY id", o["id"])]
    return d


class NewOrder(BaseModel):
    listingId: int
    deliveryAddress: str = Field(min_length=5, max_length=500)


@app.post("/v1/orders")
def create_order(body: NewOrder, user=Depends(current_user)):
    with lock:
        lst = db.execute("SELECT * FROM listings WHERE id=?", (body.listingId,)).fetchone()
        if not lst or lst["status"] != "active":
            raise HTTPException(409, "Sorry, this item is no longer available.")
        if lst["seller_id"] == user["id"]:
            raise HTTPException(400, "You can't buy your own item.")
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("UPDATE listings SET status='reserved' WHERE id=?", (lst["id"],))
            fee = round(lst["price"] * FEE_PERCENT / 100)
            cur = db.execute(
                "INSERT INTO orders(ref, listing_id, buyer_id, seller_id, title, amount, fee, currency, status, delivery_address, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (f"TS-{secrets.token_hex(8)}", lst["id"], user["id"], lst["seller_id"], lst["title"], lst["price"], fee,
                 lst["currency"], "awaiting_payment", body.deliveryAddress.strip(), now()))
            log(cur.lastrowid, "buyer", "created", f"Item reserved for {PAY_WINDOW_MIN} minutes while you pay.")
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return order_json(order_row(cur.lastrowid), "buyer")


@app.get("/v1/orders")
def my_orders(user=Depends(current_user)):
    rows = fetch("SELECT * FROM orders WHERE buyer_id=? OR seller_id=? ORDER BY id DESC", user["id"], user["id"])
    return [order_json(o) | {"role": "buyer" if o["buyer_id"] == user["id"] else "seller"} for o in rows]


@app.get("/v1/orders/{oid}")
def get_order(oid: int, user=Depends(current_user)):
    o = order_row(oid)
    return order_json(o, party(o, user))


def allowed_return(url: str) -> bool:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return False
    return "*" in ALLOWED_ORIGINS or f"{p.scheme}://{p.netloc}" in ALLOWED_ORIGINS


class Pay(BaseModel):
    returnUrl: str


@app.post("/v1/orders/{oid}/pay")
def pay(oid: int, body: Pay, user=Depends(current_user)):
    o = order_row(oid)
    if party(o, user) != "buyer":
        raise HTTPException(403, "Only the buyer pays.")
    if o["status"] != "awaiting_payment":
        raise HTTPException(409, "This order isn't waiting for payment.")
    if not allowed_return(body.returnUrl):
        raise HTTPException(400, "Return address not allowed.")
    try:
        url = provider.initialize(reference=o["ref"], amount=o["amount"], currency=o["currency"],
                                  email=user["email"], callback_url=body.returnUrl)
    except payments.PaymentError as e:
        raise HTTPException(502, f"Payment provider error: {e}")
    return {"url": url}


def mark_paid(ref: str, amount: int | None, currency: str | None, via: str) -> None:
    o = fetch1("SELECT * FROM orders WHERE ref=?", ref)
    if not o:
        return
    if amount is not None and (amount != o["amount"] or (currency or "").upper() != o["currency"]):
        with lock:
            log(o["id"], "system", "payment_mismatch", f"Received {amount} {currency}; expected {o['amount']} {o['currency']}.")
        return
    t = now()
    fields = dict(paid_at=t, ship_by=t + int(SHIP_DAYS * DAY))
    if transition(o["id"], ("awaiting_payment",), "paid", "system", "paid",
                  f"Payment received ({via}). Money is held in escrow. Seller has {SHIP_DAYS:g} days to ship.", **fields):
        return
    # Paid after the order had already expired: keep it if the item is still free, otherwise refund.
    if o["status"] == "cancelled":
        with lock:
            cur = db.execute("UPDATE listings SET status='reserved' WHERE id=? AND status='active'", (o["listing_id"],))
        if cur.rowcount and transition(o["id"], ("cancelled",), "paid", "system", "paid",
                                       f"Late payment received ({via}). Order revived; money held in escrow.", **fields):
            return
        if transition(o["id"], ("cancelled",), "refunded", "system", "refund",
                      "Payment arrived after the order expired and the item was gone. Refunding.", closed_at=t):
            do_refund(o["id"])


@app.post("/v1/orders/{oid}/verify")
def verify(oid: int, user=Depends(current_user)):
    """Called when the buyer comes back from checkout, in case the webhook is slow."""
    o = order_row(oid)
    role = party(o, user)
    if o["status"] in ("awaiting_payment", "cancelled"):
        try:
            v = provider.verify(o["ref"])
        except payments.PaymentError as e:
            raise HTTPException(502, str(e))
        if v["paid"]:
            mark_paid(o["ref"], v["amount"], v["currency"], "confirmed on return")
    return order_json(order_row(oid), role)


@app.post("/v1/webhooks/paystack")
async def paystack_webhook(request: Request):
    body = await request.body()
    if not provider.check_webhook(body, request.headers.get("x-paystack-signature", "")):
        raise HTTPException(401, "Bad signature.")
    evt = json.loads(body)
    data = evt.get("data") or {}
    kind = evt.get("event", "")
    if kind == "charge.success":
        mark_paid(data.get("reference", ""), data.get("amount"), data.get("currency"), "Paystack")
    elif kind in ("transfer.success", "transfer.failed", "transfer.reversed"):
        o = fetch1("SELECT * FROM orders WHERE payout_ref=?", data.get("reference", ""))
        if o:
            ok = kind == "transfer.success"
            with lock:
                db.execute("UPDATE orders SET payout_status=? WHERE id=?", ("paid" if ok else "failed", o["id"]))
                log(o["id"], "system", "payout_paid" if ok else "payout_failed",
                    "Money sent to the seller's bank account." if ok else f"Bank transfer {kind.split('.')[1]}. Support will retry.")
    return {"ok": True}


class Note(BaseModel):
    note: str = Field("", max_length=1000)


@app.post("/v1/orders/{oid}/ship")
def ship(oid: int, body: Note, user=Depends(current_user)):
    o = order_row(oid)
    if party(o, user) != "seller":
        raise HTTPException(403, "Only the seller can mark this as sent.")
    t = now()
    if not transition(oid, ("paid",), "shipped", "seller", "shipped",
                      "Seller marked the item as sent" + (f": {body.note.strip()}" if body.note.strip() else "."),
                      shipped_at=t, release_at=t + int(INSPECTION_DAYS * DAY), ship_note=body.note.strip(), was_shipped=1):
        raise HTTPException(409, "This order can't be marked as sent right now.")
    return order_json(order_row(oid), "seller")


@app.post("/v1/orders/{oid}/confirm")
def confirm(oid: int, user=Depends(current_user)):
    o = order_row(oid)
    if party(o, user) != "buyer":
        raise HTTPException(403, "Only the buyer can confirm delivery.")
    if not release(oid, "buyer", "Buyer confirmed the item arrived as described. Money released to the seller.",
                   frm=("paid", "shipped")):
        raise HTTPException(409, "This order can't be confirmed right now.")
    return order_json(order_row(oid), "buyer")


class Dispute(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)


@app.post("/v1/orders/{oid}/dispute")
def dispute(oid: int, body: Dispute, user=Depends(current_user)):
    o = order_row(oid)
    if party(o, user) != "buyer":
        raise HTTPException(403, "Only the buyer can open a dispute.")
    if not transition(oid, ("paid", "shipped"), "disputed", "buyer", "disputed", body.reason.strip(),
                      dispute_reason=body.reason.strip()):
        raise HTTPException(409, "A dispute can only be opened while the money is still held.")
    return order_json(order_row(oid), "buyer")


@app.post("/v1/orders/{oid}/cancel")
def cancel(oid: int, user=Depends(current_user)):
    o = order_row(oid)
    role = party(o, user)
    t = now()
    if o["status"] == "awaiting_payment" and role == "buyer":
        if transition(oid, ("awaiting_payment",), "cancelled", "buyer", "cancelled", "Buyer cancelled before paying.", closed_at=t):
            free_listing(o["listing_id"])
    elif o["status"] == "paid" and (role == "seller" or (role == "buyer" and t > o["ship_by"])):
        why = "Seller cancelled the sale." if role == "seller" else "Seller didn't send the item in time; buyer cancelled."
        refund(oid, role, why, frm=("paid",))
    else:
        raise HTTPException(409, "This order can't be cancelled right now." if role == "seller" or o["status"] != "paid"
                            else "You can cancel for a refund if the seller hasn't sent the item by the deadline, or open a dispute.")
    return order_json(order_row(oid), role)


class Message(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@app.post("/v1/orders/{oid}/messages")
def message(oid: int, body: Message, user=Depends(current_user)):
    o = order_row(oid)
    role = party(o, user)
    with lock:
        db.execute("INSERT INTO messages(order_id, user_id, body, at) VALUES (?,?,?,?)", (oid, user["id"], body.body.strip(), now()))
    return order_json(order_row(oid), role)


class Review(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str = Field("", max_length=1000)


@app.post("/v1/orders/{oid}/review")
def review(oid: int, body: Review, user=Depends(current_user)):
    o = order_row(oid)
    if party(o, user) != "buyer" or o["status"] != "released":
        raise HTTPException(409, "You can rate the seller once the order is complete.")
    with lock:
        cur = db.execute("UPDATE orders SET rating=?, review=? WHERE id=? AND rating IS NULL", (body.rating, body.text.strip(), oid))
    if not cur.rowcount:
        raise HTTPException(409, "You've already rated this order.")
    return order_json(order_row(oid), "buyer")


# ---------------------------------------------------------------- settlement

def free_listing(listing_id: int, shipped: bool = False) -> None:
    # An item that was sent and came back (or went missing) waits for the seller to relist it.
    with lock:
        db.execute("UPDATE listings SET status=? WHERE id=? AND status='reserved'", ("paused" if shipped else "active", listing_id))


def release(oid: int, actor: str, note: str, frm=("paid", "shipped", "disputed")) -> bool:
    if not transition(oid, frm, "released", actor, "released", note, closed_at=now()):
        return False
    o = order_row(oid)
    with lock:
        db.execute("UPDATE listings SET status='sold' WHERE id=?", (o["listing_id"],))
    pay_out(oid)
    return True


def pay_out(oid: int) -> None:
    o = order_row(oid)
    seller = fetch1("SELECT * FROM users WHERE id=?", o["seller_id"])
    if not seller["recipient"]:
        with lock:
            db.execute("UPDATE orders SET payout_status='awaiting_bank' WHERE id=?", (oid,))
            log(oid, "system", "payout_waiting", "Seller needs to add a bank account to receive this money.")
        return
    reference = f"{o['ref']}-payout-{secrets.token_hex(3)}"
    with lock:  # claim the payout so two callers can't both send it
        cur = db.execute("UPDATE orders SET payout_status='sending', payout_ref=? WHERE id=? AND payout_status IN ('', 'awaiting_bank', 'failed')",
                         (reference, oid))
    if not cur.rowcount:
        return
    try:
        provider.transfer(recipient=seller["recipient"], amount=o["amount"] - o["fee"], reference=reference,
                          reason=f"Tradesafe order {o['ref']}")
        status, note = ("pending", "Bank transfer to the seller started.") if provider.live else ("paid", "Money sent to the seller (demo).")
    except payments.PaymentError as e:
        status, note = "failed", f"Bank transfer failed: {e}. Support will retry."
    with lock:
        db.execute("UPDATE orders SET payout_status=? WHERE id=?", (status, oid))
        log(oid, "system", "payout_" + status, note)


def refund(oid: int, actor: str, note: str, frm=("paid", "shipped", "disputed")) -> bool:
    o = order_row(oid)
    if not transition(oid, frm, "refunded", actor, "refund", note, closed_at=now()):
        return False
    free_listing(o["listing_id"], shipped=bool(o["was_shipped"]))
    do_refund(oid)
    return True


def do_refund(oid: int) -> None:
    o = order_row(oid)
    with lock:
        cur = db.execute("UPDATE orders SET refund_status='sending' WHERE id=? AND refund_status IN ('', 'failed')", (oid,))
    if not cur.rowcount:
        return
    try:
        ref = provider.refund(o["ref"], o["amount"])
        status, note = "done", "Refund sent to the buyer's card or account."
    except payments.PaymentError as e:
        ref, status, note = "", "failed", f"Refund failed: {e}. Support will retry."
    with lock:
        db.execute("UPDATE orders SET refund_status=?, refund_ref=? WHERE id=?", (status, ref, oid))
        log(oid, "system", "refund_" + status, note)


def sweep(t: int | None = None) -> None:
    """Deadlines: unpaid orders expire, unsent items are refunded, silent buyers are treated as satisfied."""
    t = t or now()
    for o in fetch("SELECT id, listing_id FROM orders WHERE status='awaiting_payment' AND created_at<?", t - PAY_WINDOW_MIN * 60):
        if transition(o["id"], ("awaiting_payment",), "cancelled", "system", "expired", "Not paid in time. Item released.", closed_at=t):
            free_listing(o["listing_id"])
    for o in fetch("SELECT id FROM orders WHERE status='paid' AND ship_by<?", t):
        refund(o["id"], "system", "Seller didn't send the item in time. Full refund to the buyer.")
    for o in fetch("SELECT id FROM orders WHERE status='shipped' AND release_at<?", t):
        release(o["id"], "system", f"No problem reported within {INSPECTION_DAYS:g} days of sending. Money released to the seller.",
                frm=("shipped",))


# ---------------------------------------------------------------- admin

@app.get("/v1/admin/orders", dependencies=[Depends(require_admin)])
def admin_orders(status: str = "disputed"):
    sql = "SELECT * FROM orders" + (" WHERE status=?" if status != "all" else "") + " ORDER BY id DESC LIMIT 200"
    rows = fetch(sql, status) if status != "all" else fetch(sql)
    out = []
    for o in rows:
        out.append(order_json(o, "admin") | {"buyerEmail": fetch1("SELECT email FROM users WHERE id=?", o["buyer_id"])["email"],
                                             "sellerEmail": fetch1("SELECT email FROM users WHERE id=?", o["seller_id"])["email"]})
    return out


class Resolve(BaseModel):
    outcome: str = Field(pattern="^(release|refund)$")
    note: str = Field(min_length=5, max_length=2000)


@app.post("/v1/admin/orders/{oid}/resolve", dependencies=[Depends(require_admin)])
def resolve(oid: int, body: Resolve):
    order_row(oid)
    note = f"Dispute decided: {body.note.strip()}"
    settle = release if body.outcome == "release" else refund
    ok = settle(oid, "support", note, frm=("disputed",))
    if not ok:
        raise HTTPException(409, "Only open disputes can be resolved.")
    return order_json(order_row(oid), "admin")


@app.post("/v1/admin/orders/{oid}/retry", dependencies=[Depends(require_admin)])
def retry(oid: int):
    o = order_row(oid)
    if o["status"] == "released" and o["payout_status"] == "failed":
        pay_out(oid)
    elif o["status"] == "refunded" and o["refund_status"] == "failed":
        do_refund(oid)
    else:
        raise HTTPException(409, "Nothing to retry.")
    return order_json(order_row(oid), "admin")


# ---------------------------------------------------------------- demo checkout & health

@app.get("/v1/fake-pay/{ref}", response_class=HTMLResponse)
def fake_pay_page(ref: str, next: str = ""):
    if provider.name != "fake":
        raise HTTPException(404)
    o = fetch1("SELECT * FROM orders WHERE ref=?", ref)
    if not o:
        raise HTTPException(404, "No such order.")
    amount = f"{o['currency']} {o['amount'] / 100:,.2f}"
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Demo checkout</title><body style="font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<p style="background:#fff3cd;padding:12px;border-radius:8px"><b>Demo mode.</b> No real money moves. Set up Paystack to take real payments.</p>
<h2>Pay {html.escape(amount)}</h2><p>{html.escape(o['title'])}</p>
<form method=post><input type=hidden name=next value="{html.escape(next)}">
<button style="font-size:18px;padding:12px 20px;background:#0a7d4f;color:#fff;border:0;border-radius:8px">Pay {html.escape(amount)} (demo)</button></form>"""


@app.post("/v1/fake-pay/{ref}")
def fake_pay(ref: str, next: str = Form("")):
    if provider.name != "fake":
        raise HTTPException(404)
    nxt = next
    provider.paid.add(ref)
    mark_paid(ref, None, None, "demo checkout")
    return RedirectResponse(nxt if allowed_return(nxt) else "/v1/health", status_code=303)


@app.get("/v1/health")
def health():
    return {"ok": True, "payments": provider.name, "live": provider.live, "currency": CURRENCY,
            "feePercent": FEE_PERCENT, "shipDays": SHIP_DAYS, "inspectionDays": INSPECTION_DAYS,
            "payWindowMin": PAY_WINDOW_MIN, "maxPrice": MAX_PRICE, "categories": CATEGORIES}
