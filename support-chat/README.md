# Secure chat: end-to-end encrypted customer support

A customer support chat with **its own link**, separate from any website:

| Who | Address | What it's for |
|---|---|---|
| Customers | `https://secure-chat.onrender.com/` (your Render address, or your own domain) | Start or continue a chat. Share this link anywhere: WhatsApp status, Instagram bio, a QR code on the counter. |
| Your team | the same address + **`/team`** | The team inbox (not linked from the chat; bookmark it) |

Every message and photo is locked in the sender's browser and unlocked only in the customer's browser and on the team's devices. The server passes sealed messages along and keeps them for 30 days. It never has a private key and cannot read anything. If someone broke into it, they'd see that chats happened and when, but not what was said.

## What customers get

- A chat page in the site's style that works well on phones: no app and no account. Name, order number (optional) and a message is all it takes.
- Photos (shrunk, and with location and camera details removed before they're encrypted), clickable links, and ticks: 🕓 sending, ✓ delivered, ✓✓ seen by the team.
- "Typing…", live replies, and messages that wait and send by themselves after a dropped connection.
- The chat stays in their browser. Reopening the page brings it back.
- **🔒 Encrypted** shows a safety number they can compare with the team's over the phone, plus **Delete this chat**, which deletes it for everyone.

## What the team gets

- An inbox with **Open / Solved / All** tabs, search by name, order number or words (it runs on the device, after unlocking), unread badges and live updates.
- Your first name on your replies ("Ada · Bright Bakery"), quick-reply chips you can edit in **Settings**, photos, **Mark solved** (it reopens by itself if the customer writes again), **Verify** (the safety number) and **Delete chat**.
- A sound and browser notifications for new messages (turn notifications on in **Settings**).
- The same inbox on every staff phone and computer, each unlocked with the team key backup.

The chat's name and the optional contact button (for example **Call us**) come from the server settings below, so nothing in it is tied to one business.

## Set it up (once)

1. **Start it on Render.** Render → **New → Blueprint** → pick this repository. It reads [`render.yaml`](../render.yaml) and creates the `secure-chat` service with a 1 GB disk for chats. Fill in `BRAND_NAME` (what customers see) and, if you like, `CONTACT_URL`/`CONTACT_LABEL`. When it's live, its address is your chat link. Under **Environment**, copy the generated `AGENT_PASSWORD`: that's the team password.
   *Want your own domain, like `chat.yourbusiness.com`?* Render → the service → **Settings → Custom Domains**.
2. **Create the team key.** On your main computer, open **your link + `/team`** → **First time? Create the team key**. Choose a passphrase (a few random words). The browser downloads `secure-chat-team-key.json`. That's the backup.
   **Keep the backup file and the passphrase somewhere safe, apart from each other.** Anyone with both can read customer chats. If both are lost, existing chats can't be opened again (start fresh with a new key).
3. **Sign in** with your first name and the team password, then tap **Use this key for the chat**. The chat is open: share the link.

**Adding another staff phone or computer:** open `/team` on it, choose the backup file, type the passphrase, then sign in. (Send the file and passphrase separately, never in the same message.)

## Or host it on Netlify (free plan works)

This folder is also a ready Netlify project ([`netlify.toml`](netlify.toml)): the pages are served from `public/`, the API runs as a Netlify Function ([`netlify/functions/api.mjs`](netlify/functions/api.mjs)) and chats are kept in Netlify Blobs. Netlify has no always-open connection, so the pages check for news every 4 seconds while on screen (every 30 seconds in the background). Everything else works the same. A nightly function deletes chats older than `RETENTION_DAYS`.

1. Netlify → **Add new project → Import an existing project** → GitHub → this repository. Set **Base directory** to `support-chat`. Leave the build command empty.
2. **Project configuration → Environment variables**: add `AGENT_PASSWORD` (a long password for your team) and `BRAND_NAME`. Optionally add `CONTACT_URL`/`CONTACT_LABEL`. Then redeploy.
3. **Project configuration → Access & security → Visitor access**: make sure the production site is **not** behind team login or a password, or customers won't get in.
4. Open your Netlify address + `/team` and set up the team key as described above.

## Your own domain (e.g. `chat.yourbusiness.com`)

Buy the domain from any registrar, then:

- **Netlify:** **Domain management → Add a domain**, then follow the DNS steps it shows (usually one `CNAME` record pointing to `<your-project>.netlify.app`). HTTPS is set up for you.
- **Render:** the service → **Settings → Custom Domains → Add**, then add the `CNAME` record it shows at your registrar. HTTPS is automatic.

The team inbox is then at `https://<your domain>/team`. Moving the address doesn't affect the encryption, but each browser keeps its keys per address: open `/team` on the new address and unlock it with the backup file once. Customers' unfinished chats on the old address stay there.

## How the encryption works

The code is in [`public/assets/e2ee.js`](public/assets/e2ee.js), using the browser's built-in Web Crypto:

| Piece | How |
|---|---|
| Keys | ECDH P-256. Each chat gets a brand-new customer key pair, made in their browser. The team has one key pair. |
| Message key | ECDH shared secret → HKDF-SHA-256 (salted with the chat id) → AES-256-GCM |
| Each message | Fresh random 96-bit IV. The chat id, sender (customer/team), message id and time are authenticated, so the server can't move, re-attribute or back-date a message without it failing to open. |
| Where private keys live | IndexedDB as *non-extractable* keys: page scripts can use them but can't read them out. |
| Team key backup | Private key encrypted with the passphrase: PBKDF2-SHA-256 (600,000 rounds) → AES-256-GCM |
| Safety number | 60 digits from both public keys, identical on both screens |

**Keeping the server honest:** the pages are sent with a strict Content Security Policy (they can load nothing and talk to nothing except this server) and make no requests to other companies, not even for fonts. Each chat remembers the team key it started with. The team inbox warns you if the server ever hands out a team key that isn't yours. Because the same server delivers the pages, someone who took over the server could change them, so for the strongest guarantee, compare the safety number with the customer once (on a call or in person). You can also fix the key with `TEAM_KEY`, so it can't be changed from the inbox.

**What it doesn't hide:** that a chat exists, when messages were sent, their size, and the customer's IP address (as with any website). Chats use a long-term team key, so unlike Signal there is no *forward secrecy*: someone who later gets the backup file **and** its passphrase could read old chats they had also copied from the server. Deleting chats (or the 30-day expiry) limits that.

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `AGENT_PASSWORD` | Team password for `/team`. Without it customers can still write, but nobody can sign in. |
| `BRAND_NAME` | The name at the top of the chat and on the team's replies. Default `Secure Support`. |
| `REPLY_TIME` | The line under the name. Default "We usually reply within a few minutes". |
| `CONTACT_URL`, `CONTACT_LABEL` | Optional button at the top right, e.g. `tel:+2348012345678` and `Call us` (`https:`, `tel:` and `mailto:` links). |
| `DATA_DIR` | Where sealed chats and the team's public key are saved. Default `./data`. |
| `RETENTION_DAYS` | Chats idle this long are deleted. Default 30. |
| `TEAM_KEY` | Optional: fixes the team's public key (the JSON the inbox shows). Then it can't be changed from the inbox. |
| `ALLOWED_ORIGINS` | Optional: other websites allowed to call the chat API (for embedding later), comma-separated. |
| `MAX_MESSAGE_BYTES` | Largest message (photos included). Default 2.5 MB. |
| `PORT`, `HOST` | Where to listen. Default `127.0.0.1:8787`. |

## Run it on your computer

```sh
cd support-chat
AGENT_PASSWORD=test BRAND_NAME="My Shop" npm start
npm test                                          # crypto + server tests
```

Open `http://localhost:8787/team`, create a key, sign in with `test` and tap **Use this key for the chat**. Then open `http://localhost:8787/` in another browser (or a private window) and chat with yourself.
