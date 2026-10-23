/* End-to-end encryption for the support chat (the customer page and the team inbox).

   Only the customer's browser and the support team's browsers hold the keys.
   The relay server stores and forwards sealed envelopes it cannot open.

   - Keys: ECDH on P-256. Each customer conversation gets a brand-new key pair,
     made in the customer's browser. The support team has one key pair; only
     its public half is ever given to the server. Each chat remembers the team
     key it started with, and the safety number below exposes any swap.
   - Message key: ECDH shared secret -> HKDF-SHA-256 (salted with the
     conversation id) -> AES-256-GCM.
   - Every message: fresh random 96-bit IV. The conversation id, the sender
     ("customer" or "agent"), the message id and the time are authenticated as
     associated data, so the relay can't move a message to another chat, pass
     a customer's words off as the team's, or change when it was sent.
   - Safety number: 60 digits from both public keys, the same on both screens.
     Reading it out over the phone proves nobody is in the middle.
   - Team key backup: the private key, encrypted with a passphrase
     (PBKDF2-SHA-256, 600,000 rounds -> AES-256-GCM), to restore on another
     device.

   Works in browsers and in Node 20+ (globalThis.crypto). */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const VERSION = 1;
const LABEL = "secure-chat/v" + VERSION;
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const BACKUP_ITERATIONS = 600000;

// Base64url without padding ------------------------------------------------

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("bad base64");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomId(bytes = 16) {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

// Keys ---------------------------------------------------------------------

// A new key pair. extractable is only true for the team key, while its backup
// is being written; everything kept in a browser is stored non-extractable.
export async function generateKeyPair(extractable = false) {
  // (The extractable flag only applies to the private half.)
  const pair = await subtle.generateKey(ECDH, extractable, ["deriveBits"]);
  const publicJwk = cleanPublicJwk(await subtle.exportKey("jwk", pair.publicKey));
  return { privateKey: pair.privateKey, publicJwk };
}

// Only the fields that define the key, in a fixed order, so a key always
// serialises (and fingerprints) the same way.
export function cleanPublicJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("not a P-256 public key");
  }
  if (fromB64(jwk.x).length !== 32 || fromB64(jwk.y).length !== 32) throw new Error("not a P-256 public key");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function importPublicKey(jwk) {
  // importKey also checks that the point is really on the curve.
  return subtle.importKey("jwk", cleanPublicJwk(jwk), ECDH, true, []);
}

export async function importPrivateKey(jwk, extractable = false) {
  const { kty, crv, x, y, d } = jwk || {};
  if (typeof d !== "string") throw new Error("not a private key");
  return subtle.importKey("jwk", { kty, crv, x, y, d }, ECDH, extractable, ["deriveBits"]);
}

// The 65-byte uncompressed point: 0x04 || x || y.
function rawPoint(jwk) {
  const clean = cleanPublicJwk(jwk);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(fromB64(clean.x), 1);
  out.set(fromB64(clean.y), 33);
  return out;
}

async function sha256(bytes) {
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

// Short machine id for a public key (base64url of its SHA-256).
export async function keyId(jwk) {
  return toB64(await sha256(rawPoint(jwk)));
}

// 30 digits for one key: six 5-byte chunks of its hash, each mod 100000.
async function keyDigits(jwk) {
  const hash = await sha256(enc.encode(LABEL + " safety number|" + toB64(rawPoint(jwk))));
  let out = "";
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + hash[i + j];
    out += String(n % 100000).padStart(5, "0");
  }
  return out;
}

// The safety number both sides see for a conversation: 12 groups of 5 digits.
export async function safetyNumber(jwkA, jwkB) {
  const halves = [await keyDigits(jwkA), await keyDigits(jwkB)].sort();
  return (halves[0] + halves[1]).match(/\d{5}/g).join(" ");
}

// The team key alone, for printing on a notice in the shop: 6 groups of 5.
export async function keyFingerprint(jwk) {
  return (await keyDigits(jwk)).match(/\d{5}/g).join(" ");
}

// The AES key shared by one customer and the support team.
export async function conversationKey(myPrivateKey, theirPublicJwk, conversationId) {
  const theirs = await importPublicKey(theirPublicJwk);
  const secret = await subtle.deriveBits({ name: "ECDH", public: theirs }, myPrivateKey, 256);
  const hkdf = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(LABEL + "|" + conversationId), info: enc.encode(LABEL + " message key") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Messages -----------------------------------------------------------------

function associatedData(env) {
  return enc.encode([LABEL, env.conv, env.from, env.id, env.ts].join("|"));
}

// Seals any JSON value. Returns the envelope the relay stores.
export async function seal(key, { conv, from, payload, id = randomId(), ts = Date.now() }) {
  if (from !== "customer" && from !== "agent") throw new Error("from must be customer or agent");
  const env = { v: VERSION, id, conv, from, ts };
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(env), tagLength: 128 },
    key,
    enc.encode(JSON.stringify(payload)),
  );
  return { ...env, iv: toB64(iv), ct: toB64(ct) };
}

// Opens an envelope, or throws if it was tampered with or isn't for this key.
export async function open(key, env) {
  if (!env || env.v !== VERSION) throw new Error("unsupported message version");
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(env.iv), additionalData: associatedData(env), tagLength: 128 },
    key,
    fromB64(env.ct),
  );
  return JSON.parse(dec.decode(plain));
}

// Team key backup ----------------------------------------------------------

async function backupKey(passphrase, salt, iterations) {
  const base = await subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function exportBackup(privateKey, publicJwk, passphrase) {
  const jwk = await subtle.exportKey("jwk", privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const pub = cleanPublicJwk(publicJwk);
  const key = await backupKey(passphrase, salt, BACKUP_ITERATIONS);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(LABEL + " backup|" + pub.x + "|" + pub.y) },
    key,
    enc.encode(JSON.stringify({ d: jwk.d })),
  );
  return {
    kind: "secure-chat-team-key-backup",
    v: VERSION,
    publicKey: pub,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: BACKUP_ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    ct: toB64(ct),
  };
}

// Returns { privateKey (non-extractable), publicJwk }. Throws "wrong passphrase".
export async function importBackup(backup, passphrase) {
  if (!backup || backup.kind !== "secure-chat-team-key-backup" || backup.v !== VERSION) throw new Error("not a support key backup");
  const pub = cleanPublicJwk(backup.publicKey);
  const iterations = backup.kdf && backup.kdf.iterations;
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 10000000) throw new Error("not a support key backup");
  const key = await backupKey(passphrase, fromB64(backup.kdf.salt), iterations);
  let secret;
  try {
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(backup.iv), additionalData: enc.encode(LABEL + " backup|" + pub.x + "|" + pub.y) },
      key,
      fromB64(backup.ct),
    );
    secret = JSON.parse(dec.decode(plain));
  } catch (_) {
    throw new Error("wrong passphrase");
  }
  const privateKey = await importPrivateKey({ ...pub, d: secret.d });
  return { privateKey, publicJwk: pub };
}

// Browser storage (IndexedDB keeps non-extractable CryptoKeys) ---------------

export function idbStore(dbName) {
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function run(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => { d.close(); resolve(req && req.result); };
      tx.onerror = tx.onabort = () => { d.close(); reject(tx.error); };
    }));
  }
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)),
    del: (k) => run("readwrite", (s) => s.delete(k)),
  };
}
