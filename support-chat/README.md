# Support chat: end-to-end encrypted customer service

Customers chat with the Ogarider team at **`https://ogarider.name.ng/support.html`**. The team answers at **`https://ogarider.name.ng/support-agent.html`** (not linked from the site; bookmark it).

Every message and photo is locked in the sender's browser and unlocked only in the customer's browser and on the team's devices. This folder is the **relay**: a small server that passes sealed messages along and keeps them for 30 days. It has no keys and cannot read anything. If someone broke into it, they'd see who chatted and when, but not what was said.

## What customers get

- A chat page in the site's style that works well on phones: no app and no account. Name, order number (optional) and a message is all it takes.
- Photos (shrunk, and with location and camera details removed before they're encrypted), clickable links, and ticks: 🕓 sending, ✓ delivered, ✓✓ seen by the team.
- "Ogarider is typing…", live replies, and messages that wait and send by themselves after a dropped connection.
- The chat stays in their browser. Reopening the page brings it back.
- **🔒 Encrypted** shows a safety number they can compare with the team's over the phone, plus **Delete this chat**, which deletes it for everyone.

## What the team gets

- An inbox with **Open / Solved / All** tabs, search by name, order number or words (it runs on the device, after unlocking), unread badges and live updates.
- Your first name on your replies ("Ada · Ogarider support"), quick-reply chips you can edit in **Settings**, photos, **Mark solved** (it reopens by itself if the customer writes again), **Verify** (the safety number) and **Delete chat**.
- A sound and browser notifications for new messages (turn notifications on in **Settings**).
- The same inbox on every staff phone and computer, each unlocked with the team key backup.

## Set it up (once)

1. **Start the relay on Render.** Render → **New → Blueprint** → pick this repository. It reads [`render.yaml`](../render.yaml) and creates `support-chat` with a 1 GB disk for chats. When it's live, copy its address (like `https://support-chat-xxxx.onrender.com`) and, under **Environment**, the generated `AGENT_PASSWORD`. That's the team password.
2. **Create the team key.** On your main computer, open `support-agent.html` → **First time? Create the team key**. Choose a passphrase (a few random words). The browser downloads `ogarider-support-team-key.json`. That's the backup.
   **Keep the backup file and the passphrase somewhere safe, apart from each other.** Anyone with both can read customer chats. If both are lost, existing chats can't be opened again (start fresh with a new key).
3. **Publish it.** The next screen asks for the relay address and the same GitHub token as the menu admin page. **Publish to the website** writes the public half of the key and the relay address into [`support.json`](../support.json). The chat page goes live about a minute later.
4. **Sign in** with your first name and the team password.

**Adding another staff phone or computer:** open `support-agent.html` on it, choose the backup file, type the passphrase, then sign in. (Send the file and passphrase separately, never in the same message.)

## How the encryption works

The code is in [`assets/js/e2ee.js`](../assets/js/e2ee.js), using the browser's built-in Web Crypto:

| Piece | How |
|---|---|
| Keys | ECDH P-256. Each chat gets a brand-new customer key pair, made in their browser. The team has one key pair. |
| Message key | ECDH shared secret → HKDF-SHA-256 (salted with the chat id) → AES-256-GCM |
| Each message | Fresh random 96-bit IV. The chat id, sender (customer/team), message id and time are authenticated, so the relay can't move, re-attribute or back-date a message without it failing to open. |
| Where private keys live | IndexedDB as *non-extractable* keys: page scripts can use them but can't read them out. |
| Team key backup | Private key encrypted with the passphrase: PBKDF2-SHA-256 (600,000 rounds) → AES-256-GCM |
| Safety number | 60 digits from both public keys, identical on both screens |

**Why the relay can't sneak in its own key:** the pages and the team's public key are served by the website (GitHub Pages, straight from this repository), not by the relay. The relay only ever receives sealed envelopes. Customer pages also refuse to talk to the relay from any other website (`ALLOWED_ORIGINS`), and the pages set a strict Content Security Policy.

**What it doesn't hide:** that a chat exists, when messages were sent, their size, and the customer's IP address (as with any website). Chats use a long-term team key, so unlike Signal there is no *forward secrecy*: someone who later gets the backup file **and** its passphrase could read old chats they had also copied from the relay. Deleting chats (or the 30-day expiry) limits that.

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `AGENT_PASSWORD` | Team password for the inbox. Without it customers can still write, but nobody can sign in. |
| `ALLOWED_ORIGINS` | Websites allowed to use the relay, comma-separated. Default `https://ogarider.name.ng,localhost`. |
| `DATA_DIR` | Where sealed chats are saved (`conversations.json`). Default `./data`. |
| `RETENTION_DAYS` | Chats idle this long are deleted. Default 30. |
| `AGENT_KEY_ID` | Optional: the `teamKeyId` from `support.json`. When set, the relay refuses new chats sealed for any other key. |
| `MAX_MESSAGE_BYTES` | Largest message (photos included). Default 2.5 MB. |
| `PORT`, `HOST` | Where to listen. Default `127.0.0.1:8787`. |

## Run it on your computer

```sh
cd support-chat
AGENT_PASSWORD=test npm start        # relay on http://127.0.0.1:8787
npm test                             # crypto + relay tests
```

Serve the website from the repository root (for example `python3 -m http.server 8080`) and open `http://localhost:8080/support-agent.html`. Create a key, put `http://127.0.0.1:8787` as the chat server and choose **Skip for now** (or paste the JSON it shows into `support.json`), then open `support.html` in another browser to chat with yourself.
