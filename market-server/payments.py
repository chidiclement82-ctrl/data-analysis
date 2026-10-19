"""Payment providers for the escrow marketplace.

The server never touches card details. The buyer pays on the provider's own
checkout page, the money lands in the platform's provider balance, and the
server later either transfers it to the seller (release) or refunds the buyer.

PAYMENTS=paystack  real money through Paystack (needs PAYSTACK_SECRET_KEY)
PAYMENTS=fake      demo mode: a built-in "pay" page marks orders paid, no money moves
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class PaymentError(Exception):
    pass


class FakeProvider:
    """Stand-in used for demos and tests. Nothing real happens."""

    name = "fake"
    live = False

    def __init__(self, public_url: str):
        self.public_url = public_url.rstrip("/")
        self.paid: set[str] = set()

    def initialize(self, *, reference: str, amount: int, currency: str, email: str, callback_url: str) -> str:
        return f"{self.public_url}/v1/fake-pay/{reference}?next={urllib.parse.quote(callback_url, safe='')}"

    def verify(self, reference: str) -> dict:
        return {"paid": reference in self.paid, "amount": None, "currency": None}

    def refund(self, reference: str, amount: int) -> str:
        return f"fake-refund-{reference}"

    def resolve_account(self, bank_code: str, account_number: str) -> str:
        return "Demo Account Holder"

    def create_recipient(self, *, name: str, bank_code: str, account_number: str, currency: str) -> str:
        return f"RCP_fake_{bank_code}_{account_number}"

    def transfer(self, *, recipient: str, amount: int, reference: str, reason: str) -> str:
        return f"fake-transfer-{reference}"

    def banks(self, currency: str) -> list[dict]:
        return [{"name": "Demo Bank", "code": "000"}]

    def check_webhook(self, body: bytes, signature: str) -> bool:
        return False


class PaystackProvider:
    """Paystack (Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire).

    Amounts are in the currency's smallest unit (kobo, pesewas, cents).
    Transfers need a verified Paystack business and a funded balance;
    turn off the transfer OTP in the dashboard so releases go out automatically.
    """

    name = "paystack"
    live = True
    base = "https://api.paystack.co"

    def __init__(self, secret_key: str):
        self.secret = secret_key

    def _call(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            try:
                msg = json.load(e).get("message", str(e))
            except Exception:
                msg = str(e)
            raise PaymentError(msg) from e
        except OSError as e:
            raise PaymentError(f"Could not reach Paystack: {e}") from e
        if not body.get("status"):
            raise PaymentError(body.get("message", "Paystack request failed"))
        return body.get("data") or {}

    def initialize(self, *, reference: str, amount: int, currency: str, email: str, callback_url: str) -> str:
        d = self._call("POST", "/transaction/initialize", {
            "reference": reference, "amount": amount, "currency": currency,
            "email": email, "callback_url": callback_url,
        })
        return d["authorization_url"]

    def verify(self, reference: str) -> dict:
        d = self._call("GET", f"/transaction/verify/{urllib.parse.quote(reference)}")
        return {"paid": d.get("status") == "success", "amount": d.get("amount"), "currency": d.get("currency")}

    def refund(self, reference: str, amount: int) -> str:
        d = self._call("POST", "/refund", {"transaction": reference, "amount": amount})
        return str(d.get("id", ""))

    def resolve_account(self, bank_code: str, account_number: str) -> str:
        q = urllib.parse.urlencode({"account_number": account_number, "bank_code": bank_code})
        return self._call("GET", f"/bank/resolve?{q}")["account_name"]

    def create_recipient(self, *, name: str, bank_code: str, account_number: str, currency: str) -> str:
        d = self._call("POST", "/transferrecipient", {
            "type": "nuban" if currency == "NGN" else ("ghipss" if currency == "GHS" else "basa"),
            "name": name, "account_number": account_number, "bank_code": bank_code, "currency": currency,
        })
        return d["recipient_code"]

    def transfer(self, *, recipient: str, amount: int, reference: str, reason: str) -> str:
        d = self._call("POST", "/transfer", {
            "source": "balance", "amount": amount, "recipient": recipient,
            "reference": reference, "reason": reason[:100],
        })
        return d.get("transfer_code", "")

    def banks(self, currency: str) -> list[dict]:
        country = {"NGN": "nigeria", "GHS": "ghana", "KES": "kenya", "ZAR": "south africa"}.get(currency, "nigeria")
        q = urllib.parse.urlencode({"country": country, "currency": currency, "perPage": 200})
        req = urllib.request.Request(self.base + f"/bank?{q}", headers={"Authorization": f"Bearer {self.secret}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                rows = json.load(r).get("data") or []
        except OSError as e:
            raise PaymentError(f"Could not reach Paystack: {e}") from e
        return [{"name": b["name"], "code": b["code"]} for b in rows if b.get("active", True)]

    def check_webhook(self, body: bytes, signature: str) -> bool:
        expected = hmac.new(self.secret.encode(), body, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature or "")


def make_provider(public_url: str):
    choice = os.environ.get("PAYMENTS", "").strip().lower()
    secret = os.environ.get("PAYSTACK_SECRET_KEY", "").strip()
    if choice == "fake" or (not choice and not secret):
        return FakeProvider(public_url)
    if not secret:
        raise RuntimeError("PAYMENTS=paystack needs PAYSTACK_SECRET_KEY")
    return PaystackProvider(secret)
