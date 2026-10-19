"""Escrow flow tests with the demo payment provider: python -m pytest -q tests"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="market-test-")
os.environ["PAYMENTS"] = "fake"
os.environ["ADMIN_TOKEN"] = "admin-secret"
os.environ["ALLOWED_ORIGINS"] = "https://shop.example"
os.environ["FEE_PERCENT"] = "2.5"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import app as server  # noqa: E402

RETURN = "https://shop.example/market/#/orders"
ADMIN = {"X-Admin-Token": "admin-secret"}
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module")
def c():
    with TestClient(server.app) as client:
        yield client


_n = 0


def user(c, name="Ada Obi"):
    global _n
    _n += 1
    r = c.post("/v1/auth/register", json={"email": f"u{_n}@example.com", "name": name, "password": "correct horse"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def listing(c, seller, price=25000):
    r = c.post("/v1/listings", headers=seller, json={
        "title": "iPhone 12, 128GB", "description": "Clean, no scratches, battery 89%.",
        "category": "Phones & tablets", "price": price, "location": "Lagos", "photo": PNG})
    assert r.status_code == 200, r.text
    return r.json()


def paid_order(c, buyer, seller, **kw):
    lst = listing(c, seller, **kw)
    o = c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "12 Allen Ave, Ikeja"}).json()
    url = c.post(f"/v1/orders/{o['id']}/pay", headers=buyer, json={"returnUrl": RETURN}).json()["url"]
    path = url.replace(server.PUBLIC_URL, "").split("?")[0]
    r = c.post(path, data={"next": RETURN}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == RETURN
    return c.get(f"/v1/orders/{o['id']}", headers=buyer).json(), lst


def add_bank(c, who):
    assert c.put("/v1/me/payout", headers=who, json={"bankCode": "000", "accountNumber": "0123456789"}).status_code == 200


def test_auth(c):
    h = user(c)
    assert c.get("/v1/me", headers=h).json()["name"] == "Ada Obi"
    assert c.get("/v1/me").status_code == 401
    r = c.post("/v1/auth/login", json={"email": f"u{_n}@example.com", "password": "nope"})
    assert r.status_code == 401
    assert c.post("/v1/auth/register", json={"email": f"u{_n}@example.com", "name": "X Y", "password": "12345678"}).status_code == 409


def test_happy_path_buyer_confirms(c):
    seller, buyer = user(c, "Seller"), user(c, "Buyer")
    add_bank(c, seller)
    o, lst = paid_order(c, buyer, seller)
    assert o["status"] == "paid" and o["amount"] == 2_500_000 and o["fee"] == 62_500
    assert c.get(f"/v1/listings/{lst['id']}").json()["status"] == "reserved"
    # The buyer can't mark it sent; the seller can't release their own money.
    assert c.post(f"/v1/orders/{o['id']}/ship", headers=buyer, json={}).status_code == 403
    assert c.post(f"/v1/orders/{o['id']}/confirm", headers=seller).status_code == 403
    assert c.post(f"/v1/orders/{o['id']}/ship", headers=seller, json={"note": "GIG Logistics #4411"}).json()["status"] == "shipped"
    o = c.post(f"/v1/orders/{o['id']}/confirm", headers=buyer).json()
    assert o["status"] == "released" and o["payoutStatus"] == "paid"
    # Confirming twice can't pay out twice.
    assert c.post(f"/v1/orders/{o['id']}/confirm", headers=buyer).status_code == 409
    assert c.get(f"/v1/listings/{lst['id']}").json()["status"] == "sold"
    assert c.post(f"/v1/orders/{o['id']}/review", headers=buyer, json={"rating": 5, "text": "Legit!"}).status_code == 200
    stats = c.get(f"/v1/listings/{lst['id']}").json()["seller"]
    assert stats["completedSales"] == 1 and stats["rating"] == 5


def test_strangers_cannot_see_orders(c):
    seller, buyer, other = user(c), user(c), user(c)
    o, _ = paid_order(c, buyer, seller)
    assert c.get(f"/v1/orders/{o['id']}", headers=other).status_code == 404
    assert c.post(f"/v1/orders/{o['id']}/confirm", headers=other).status_code == 404


def test_cannot_buy_own_or_reserved_item(c):
    seller, buyer, b2 = user(c), user(c), user(c)
    lst = listing(c, seller)
    assert c.post("/v1/orders", headers=seller, json={"listingId": lst["id"], "deliveryAddress": "Somewhere"}).status_code == 400
    assert c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "Somewhere"}).status_code == 200
    assert c.post("/v1/orders", headers=b2, json={"listingId": lst["id"], "deliveryAddress": "Somewhere"}).status_code == 409


def test_dispute_refund(c):
    seller, buyer = user(c), user(c)
    o, lst = paid_order(c, buyer, seller)
    c.post(f"/v1/orders/{o['id']}/ship", headers=seller, json={})
    assert c.post(f"/v1/orders/{o['id']}/dispute", headers=buyer, json={"reason": "It's a fake, not an iPhone."}).json()["status"] == "disputed"
    # Nobody but support can settle a dispute.
    assert c.post(f"/v1/orders/{o['id']}/confirm", headers=buyer).status_code == 409
    assert c.get("/v1/admin/orders").status_code == 403
    assert any(x["id"] == o["id"] for x in c.get("/v1/admin/orders", headers=ADMIN).json())
    r = c.post(f"/v1/admin/orders/{o['id']}/resolve", headers=ADMIN, json={"outcome": "refund", "note": "Photos show a counterfeit."})
    assert r.json()["status"] == "refunded" and r.json()["refundStatus"] == "done"
    assert c.get(f"/v1/listings/{lst['id']}").json()["status"] == "paused"  # item was sent; seller relists by hand
    assert c.post(f"/v1/admin/orders/{o['id']}/resolve", headers=ADMIN, json={"outcome": "release", "note": "again"}).status_code == 409


def test_dispute_release_without_bank_then_bank_added(c):
    seller, buyer = user(c), user(c)
    o, _ = paid_order(c, buyer, seller)
    c.post(f"/v1/orders/{o['id']}/dispute", headers=buyer, json={"reason": "Seller isn't answering me."})
    r = c.post(f"/v1/admin/orders/{o['id']}/resolve", headers=ADMIN, json={"outcome": "release", "note": "Courier confirms delivery."})
    assert r.json()["payoutStatus"] == "awaiting_bank"
    add_bank(c, seller)
    assert c.get(f"/v1/orders/{o['id']}", headers=seller).json()["payoutStatus"] == "paid"


def test_deadlines(c):
    seller, buyer = user(c), user(c)
    # Seller never ships → buyer refunded automatically.
    o, lst = paid_order(c, buyer, seller)
    server.sweep(o["shipBy"] + 1)
    o = c.get(f"/v1/orders/{o['id']}", headers=buyer).json()
    assert o["status"] == "refunded" and o["refundStatus"] == "done"
    assert c.get(f"/v1/listings/{lst['id']}").json()["status"] == "active"
    # Buyer goes silent after delivery → seller paid when the inspection window ends.
    o, _ = paid_order(c, buyer, seller)
    o = c.post(f"/v1/orders/{o['id']}/ship", headers=seller, json={}).json()
    server.sweep(o["releaseAt"] - 10)
    assert c.get(f"/v1/orders/{o['id']}", headers=buyer).json()["status"] == "shipped"
    server.sweep(o["releaseAt"] + 1)
    assert c.get(f"/v1/orders/{o['id']}", headers=buyer).json()["status"] == "released"
    # Unpaid order expires and frees the item.
    lst = listing(c, seller)
    o = c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "12 Allen Ave"}).json()
    server.sweep(o["createdAt"] + server.PAY_WINDOW_MIN * 60 + 1)
    assert c.get(f"/v1/orders/{o['id']}", headers=buyer).json()["status"] == "cancelled"
    assert c.get(f"/v1/listings/{lst['id']}").json()["status"] == "active"


def test_cancel_rules(c):
    seller, buyer = user(c), user(c)
    o, _ = paid_order(c, buyer, seller)
    assert c.post(f"/v1/orders/{o['id']}/cancel", headers=buyer).status_code == 409  # seller still has time
    assert c.post(f"/v1/orders/{o['id']}/cancel", headers=seller).json()["status"] == "refunded"


def test_late_payment_after_expiry(c):
    seller, buyer, b2 = user(c), user(c), user(c)
    lst = listing(c, seller)
    o = c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "12 Allen Ave"}).json()
    server.sweep(o["createdAt"] + server.PAY_WINDOW_MIN * 60 + 1)
    c.post("/v1/orders", headers=b2, json={"listingId": lst["id"], "deliveryAddress": "Somewhere else"})  # someone else takes it
    server.mark_paid(o["ref"], None, None, "test")
    o = c.get(f"/v1/orders/{o['id']}", headers=buyer).json()
    assert o["status"] == "refunded" and o["refundStatus"] == "done"


def test_wrong_amount_is_not_accepted(c):
    seller, buyer = user(c), user(c)
    lst = listing(c, seller)
    o = c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "12 Allen Ave"}).json()
    server.mark_paid(o["ref"], 100, "NGN", "test")
    assert c.get(f"/v1/orders/{o['id']}", headers=buyer).json()["status"] == "awaiting_payment"


def test_return_url_must_be_our_site(c):
    seller, buyer = user(c), user(c)
    lst = listing(c, seller)
    o = c.post("/v1/orders", headers=buyer, json={"listingId": lst["id"], "deliveryAddress": "12 Allen Ave"}).json()
    assert c.post(f"/v1/orders/{o['id']}/pay", headers=buyer, json={"returnUrl": "https://evil.example/"}).status_code == 400


def test_bad_photo_and_search(c):
    seller = user(c)
    r = c.post("/v1/listings", headers=seller, json={"title": "Shoes", "description": "Nice shoes, size 43",
                                                     "category": "Fashion", "price": 100, "photo": "data:image/png;base64,AAAA"})
    assert r.status_code == 400
    listing(c, seller)
    assert c.get("/v1/listings", params={"q": "iphone"}).json()
    assert not c.get("/v1/listings", params={"q": "zzzz-nothing"}).json()
    photo = c.get("/v1/listings").json()[0]["photo"].replace(server.PUBLIC_URL, "")
    assert c.get(photo).status_code == 200


def test_messages(c):
    seller, buyer = user(c), user(c)
    o, _ = paid_order(c, buyer, seller)
    c.post(f"/v1/orders/{o['id']}/messages", headers=buyer, json={"body": "When will you send it?"})
    o = c.post(f"/v1/orders/{o['id']}/messages", headers=seller, json={"body": "Tomorrow morning."}).json()
    assert [m["from"] for m in o["messages"]] == ["buyer", "seller"]


def test_webhook_rejects_unsigned(c):
    assert c.post("/v1/webhooks/paystack", content=b'{"event":"charge.success"}').status_code == 401


def test_paystack_signature():
    import hashlib
    import hmac

    import payments
    p = payments.PaystackProvider("sk_test_x")
    body = b'{"event":"charge.success"}'
    assert p.check_webhook(body, hmac.new(b"sk_test_x", body, hashlib.sha512).hexdigest())
    assert not p.check_webhook(body, "deadbeef")
