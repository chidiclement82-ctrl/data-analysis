---
title: Tradesafe Marketplace
emoji: 🛡️
colorFrom: green
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Tradesafe escrow marketplace server

This is the backend for the [Tradesafe marketplace](../market/), a buy-and-sell site where **the buyer's money is held until they confirm the item arrived**. It stores users, listings and orders, takes payments through Paystack, and pays sellers or refunds buyers.

## How the money moves

1. The buyer pays on **Paystack's** checkout page (card, bank transfer, USSD). The money lands in *your* Paystack balance, not the seller's. This server never sees card details.
2. The seller has `SHIP_DAYS` to mark the item as sent. If they don't, the buyer is **refunded automatically**.
3. The buyer confirms delivery and the seller is paid (price minus `FEE_PERCENT`) by a **Paystack transfer** to their verified bank account. If the buyer says nothing for `INSPECTION_DAYS` after sending, the money is released automatically.
4. If the buyer reports a problem, the money is **frozen** until support decides on the admin page (`market/#/admin`): refund the buyer or pay the seller.

Every step is written to the order's timeline. State changes are atomic, so a double tap, a repeated webhook or the deadline checker racing a user can never pay out twice. Payments for the wrong amount are not accepted. A payment that arrives after the order expired is either kept, if the item is still free, or refunded.

## Before you take real money

- **Licensing.** Holding other people's money can be a regulated activity (in Nigeria, talk to a lawyer about CBN rules on payment services and escrow). Paystack also has to approve your business for this use. Settle this before going live.
- **Paystack setup.** Verify your business. In **Settings → Preferences** turn **off** "Confirm transfers before sending" (the OTP), or releases will wait for you to type a code. Keep enough balance for transfers: Paystack settles card payments to your bank on a schedule, so ask Paystack about keeping funds in your balance for payouts.
- **A database that survives restarts.** Everything lives in `DATA_DIR` (a SQLite file plus photos). If that folder is wiped, you lose the record of who is owed what. On Hugging Face, add **Persistent storage** to the Space (Settings → Persistent storage; paid), which is mounted at `/data`. Anywhere else, mount a volume at `/data`. Back the folder up.
- **An always-on server.** Free Hugging Face Spaces sleep after about 48 hours idle. Deadlines are only checked while the server is awake (every minute, and they catch up on wake). For real money, use always-on hardware.

## Put it online on Hugging Face Spaces

1. Create a Space: **New → Space**, SDK **Docker**, template **Blank**. Add **Persistent storage** (see above).
2. In **Settings → Variables and secrets** add:
   - Secret **`PAYSTACK_SECRET_KEY`**: from the Paystack dashboard, Settings → API Keys. Start with the `sk_test_…` key, then switch to `sk_live_…`.
   - Secret **`ADMIN_TOKEN`**: a long random password for the support desk.
   - Variable **`PUBLIC_URL`**: the Space's address, e.g. `https://your-name-tradesafe.hf.space`.
   - Variable **`ALLOWED_ORIGINS`**: `https://ogarider.name.ng` (your site).
3. Upload this folder's files, or let GitHub do it (below).
4. In Paystack, **Settings → API Keys & Webhooks → Webhook URL**: `https://your-name-tradesafe.hf.space/v1/webhooks/paystack`.
5. Put the Space's address in [`market/js/config.js`](../market/js/config.js) and push. The site is at `https://ogarider.name.ng/market/`.

Without `PAYSTACK_SECRET_KEY` the server runs in **demo mode**. A built-in checkout page pretends to take payment, and the site shows a "Demo mode" banner.

### Deploy automatically from GitHub

`.github/workflows/market-server.yml` runs the tests on every change and, on `main`, uploads this folder to your Space. In the GitHub repository's **Settings → Secrets and variables → Actions** add:
- Secret **`HF_TOKEN`**: a Hugging Face token with **write** permission (already there if you set up the face swap server).
- Variable **`MARKET_HF_SPACE`**: e.g. `your-name/tradesafe`.

## Run it on your computer

```bash
cd market-server
pip install -r requirements.txt
ADMIN_TOKEN=admin uvicorn app:app --port 7860      # demo mode
# in another terminal, from the repository root:
python3 -m http.server 8000                          # open http://localhost:8000/market/
```

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | *(none)* | Turns on real payments. Without it, demo mode. |
| `PAYMENTS` | auto | `paystack` or `fake`. Forces a mode. |
| `PUBLIC_URL` | `http://localhost:7860` | This server's own address (used in photo links and the demo checkout). |
| `ALLOWED_ORIGINS` | `*` | Sites allowed to call the server. Also limits where buyers can be sent back to after paying. **Set it in production.** |
| `ADMIN_TOKEN` | *(none)* | Password for the support desk. Without it, the admin API is off. |
| `CURRENCY` | `NGN` | `NGN`, `GHS`, `KES` or `ZAR`, whatever your Paystack account supports. |
| `FEE_PERCENT` | `2.5` | Your fee, taken from the seller's payout. Paystack's own fees come out of your balance. |
| `SHIP_DAYS` | `3` | Days a seller has to send the item after payment before the buyer is refunded. |
| `INSPECTION_DAYS` | `3` | Days a buyer has after sending to confirm or dispute before money is released. |
| `PAY_WINDOW_MIN` | `30` | Minutes an item stays reserved while the buyer pays. |
| `MAX_PRICE` | `5000000` | Highest price allowed for one item, in naira (or your currency). Limits risk while you're starting out. |
| `MAX_PHOTO_MB` | `2` | Largest photo upload (the site shrinks photos before uploading). |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the database and photos are kept. |

## API

All requests and responses are JSON. Signed-in calls send `Authorization: Bearer <token>`; admin calls send `X-Admin-Token`. Money is always in the currency's smallest unit (kobo).

| Method & path | What it does |
|---|---|
| `GET /v1/health` | Mode (demo or live), currency, fee, deadlines, categories |
| `POST /v1/auth/register`, `/login`, `/logout` · `GET /v1/me` | Accounts |
| `GET /v1/banks` · `PUT /v1/me/payout` | Bank list; verify and save the seller's payout account |
| `GET /v1/listings?q=&category=` · `GET /v1/listings/{id}` | Browse, with the seller's track record |
| `POST /v1/listings` · `DELETE /v1/listings/{id}` · `POST /v1/listings/{id}/relist` · `GET /v1/my/listings` | Sell |
| `GET /v1/users/{id}` | Public seller profile and reviews |
| `POST /v1/orders` | Reserve an item and create an order |
| `POST /v1/orders/{id}/pay` · `/verify` | Get the checkout link; re-check payment on return |
| `POST /v1/orders/{id}/ship` · `/confirm` · `/dispute` · `/cancel` · `/messages` · `/review` | The escrow steps |
| `GET /v1/orders` · `GET /v1/orders/{id}` | Your orders, with timeline and messages |
| `POST /v1/webhooks/paystack` | Paystack events (signature checked) |
| `GET /v1/admin/orders?status=` · `POST /v1/admin/orders/{id}/resolve` · `/retry` | Support desk |

## Tests

```bash
pip install -r requirements.txt pytest httpx
python -m pytest -q tests
```

The tests cover the happy path, disputes both ways, every deadline, cancellations, late and wrong-amount payments, double-confirm protection, access between strangers, and webhook signatures.
