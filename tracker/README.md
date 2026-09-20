# Ledgerline — Personal Money Tracker

Two public web apps that share one secure backend:

| Page | Public link (after Pages is enabled) | Who uses it |
|------|--------------------------------------|-------------|
| **Customer** | `https://chidiclement82-ctrl.github.io/data-analysis/tracker/` | Customers sign in to see their balance & message you |
| **Admin** | `https://chidiclement82-ctrl.github.io/data-analysis/tracker/admin.html` | You create accounts, fund/deduct, and reply |

## What it does

- **Admin** creates customer accounts (email + password), sets an opening balance, and **funds (credits)** or **deducts (debits)** any customer.
- **Customers** sign in on the customer link only, see their **balance** and full **activity history**, and **message** the admin.
- **Two-way messaging** between each customer and the admin, live.
- **Security is enforced server-side:** a customer can *never* change their own balance — only the admin can. Customers can only read their own account.

## Runs in two modes

It works **right now in DEMO MODE** (no setup): all data lives in your browser's
local storage so you can click through everything. A yellow banner shows when
you're in demo mode. Demo admin login: **`admin@demo.test` / `admin123`**.

To make it a **real, public, multi-device app**, connect Firebase (free):

## Firebase setup (~5 minutes)

1. **Create a project** at <https://console.firebase.google.com> → *Add project*.
2. **Add a Web app**: Project Overview → the `</>` icon → register the app.
   Copy the `firebaseConfig` values it shows you.
3. **Enable sign-in**: Build → **Authentication** → *Get started* →
   **Email/Password** → enable → Save.
4. **Create the database**: Build → **Firestore Database** → *Create database*
   → start in **production mode** → pick a location.
5. **Create your admin user**: Authentication → **Users** → *Add user* →
   enter your admin email + a password. This is how you'll sign in to the admin page.
6. **Paste your config**: open [`assets/config.js`](assets/config.js) and
   - put your admin email in `adminEmails`
   - paste the Firebase config values (replace every `PASTE_...`)
7. **Paste the security rules**: Firestore Database → **Rules** tab → paste the
   contents of [`firestore.rules`](firestore.rules) → **Publish**.
   Make sure the email in that file's `adminEmails()` matches step 6.
8. **Commit & push** your edited `config.js`. GitHub Pages redeploys, the yellow
   banner disappears, and the app is live for real.

> Keep the admin email identical in `config.js` **and** `firestore.rules` — that
> pairing is what grants admin powers.

## Enable the public links (one-time)

If you haven't already: on GitHub, **Settings → Pages → Source → GitHub Actions**.
The included workflow publishes the whole repo, so both links above go live.

## Security notes (please read)

- The Firebase web config is **not a secret** — it's meant to ship in the browser.
  Your data is protected by the **security rules**, not by hiding the config.
- Anyone with the customer link can *attempt* to sign in, but only accounts you
  create will work. Balances and other customers' data are inaccessible to them.
- This is a **personal tracker**, not a regulated financial product. Don't store
  real card numbers, bank credentials, or government IDs in it.
