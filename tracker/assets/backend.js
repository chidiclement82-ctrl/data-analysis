/* ============================================================
   backend.js — one interface, two implementations.

   The UI (admin.js / customer.js) only ever talks to this
   module. When Firebase is configured it uses Firebase Auth +
   Firestore (LIVE). Otherwise it uses localStorage (DEMO).

   Public API (all async unless noted):
     backend.mode                         -> 'live' | 'demo'
     backend.onAuth(cb) -> unsubscribe    cb(user|null); user = {uid,email,name,isAdmin}
     backend.adminSignIn(email, password)
     backend.customerSignIn(email, password)
     backend.signOut()
     backend.createCustomer({email,password,name,startingBalance})   [admin]
     backend.adjustBalance(uid, delta, note)                          [admin]
     backend.listCustomers(cb) -> unsubscribe                         [admin]
     backend.watchCustomer(uid, cb) -> unsubscribe    cb(customer|null)
     backend.watchTransactions(uid, cb) -> unsubscribe
     backend.watchMessages(uid, cb) -> unsubscribe
     backend.sendMessage(uid, {from, text})
   ============================================================ */

const CFG = window.APP_CONFIG || {};
const FB = CFG.firebase || {};
const IS_LIVE =
  !!FB.apiKey && !String(FB.apiKey).startsWith("PASTE_") &&
  !!FB.projectId && !String(FB.projectId).startsWith("PASTE_");

const ADMIN_EMAILS = (CFG.adminEmails || []).map((e) => String(e).trim().toLowerCase());
const CURRENCY = CFG.currency || "USD";

/* ---------- shared helpers ---------- */
export function fmtMoney(n) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(v);
  } catch (e) {
    return "$" + v.toFixed(2);
  }
}
export function fmtWhen(ts) {
  const ms = toMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  const now = Date.now();
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();      // Firestore Timestamp
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}
function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase());
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

/* ============================================================
   DEMO backend — localStorage, single browser, cross-tab live.
   ============================================================ */
function demoBackend() {
  const DB_KEY = "mt_demo_v2";
  const SESSION_KEY = "mt_demo_session_v2";
  const DEMO_ADMIN = { email: "admin@demo.test", password: "admin123" };

  function read() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { customers: {}, txns: {}, msgs: {} };
  }
  function write(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {}
    // notify this tab (storage event only fires in OTHER tabs)
    window.dispatchEvent(new Event("mt-demo-change"));
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function setSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    window.dispatchEvent(new Event("mt-demo-change"));
  }
  function onChange(fn) {
    const h = () => fn();
    window.addEventListener("mt-demo-change", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("mt-demo-change", h);
      window.removeEventListener("storage", h);
    };
  }

  function sessionUser() {
    const s = getSession();
    if (!s) return null;
    if (s.role === "admin") return { uid: "admin", email: s.email, name: "Administrator", isAdmin: true };
    const c = read().customers[s.uid];
    if (!c) return null;
    return { uid: c.uid, email: c.email, name: c.name, isAdmin: false };
  }

  return {
    mode: "demo",
    demoAdminHint: DEMO_ADMIN,

    onAuth(cb) {
      // Fire only when the signed-in identity actually changes — not on every
      // data write — to match Firebase's onAuthStateChanged semantics.
      let last;
      const key = (u) => (u ? (u.isAdmin ? "admin:" + u.email : "cust:" + u.uid) : "none");
      const fire = () => {
        const u = sessionUser();
        const k = key(u);
        if (k === last) return;
        last = k;
        cb(u);
      };
      fire();
      return onChange(fire);
    },

    async adminSignIn(email, password) {
      email = String(email).trim().toLowerCase();
      const okDefault = email === DEMO_ADMIN.email && password === DEMO_ADMIN.password;
      const okConfigured = isAdminEmail(email) && password && password.length >= 4;
      if (!okDefault && !okConfigured) throw new Error("Invalid admin credentials.");
      setSession({ role: "admin", email });
    },

    async customerSignIn(email, password) {
      email = String(email).trim().toLowerCase();
      const db = read();
      const c = Object.values(db.customers).find((x) => x.email === email);
      if (!c || c.password !== password) throw new Error("Wrong email or password.");
      setSession({ role: "customer", uid: c.uid, email });
    },

    async signOut() { setSession(null); },

    async createCustomer({ email, password, name, startingBalance }) {
      email = String(email).trim().toLowerCase();
      if (!email || !password) throw new Error("Email and password are required.");
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");
      const db = read();
      if (Object.values(db.customers).some((x) => x.email === email))
        throw new Error("A customer with that email already exists.");
      const uid = uuid();
      const start = Number(startingBalance) || 0;
      db.customers[uid] = { uid, email, password, name: name || email, balance: start, createdAt: Date.now() };
      db.txns[uid] = [];
      db.msgs[uid] = [];
      if (start > 0)
        db.txns[uid].push({ id: uuid(), type: "fund", amount: start, note: "Opening balance", by: "admin", ts: Date.now() });
      write(db);
      return { uid };
    },

    async adjustBalance(uid, delta, note) {
      const db = read();
      const c = db.customers[uid];
      if (!c) throw new Error("Customer not found.");
      const next = (Number(c.balance) || 0) + delta;
      if (next < 0) throw new Error("Balance cannot go below $0.00.");
      c.balance = next;
      (db.txns[uid] = db.txns[uid] || []).push({
        id: uuid(), type: delta >= 0 ? "fund" : "deduct",
        amount: Math.abs(delta), note: note || "", by: "admin", ts: Date.now(),
      });
      write(db);
    },

    listCustomers(cb) {
      const emit = () => {
        const db = read();
        cb(Object.values(db.customers).sort((a, b) => b.createdAt - a.createdAt));
      };
      emit();
      return onChange(emit);
    },

    watchCustomer(uid, cb) {
      const emit = () => cb(read().customers[uid] || null);
      emit();
      return onChange(emit);
    },

    watchTransactions(uid, cb) {
      const emit = () => {
        const arr = (read().txns[uid] || []).slice().sort((a, b) => b.ts - a.ts);
        cb(arr);
      };
      emit();
      return onChange(emit);
    },

    watchMessages(uid, cb) {
      const emit = () => {
        const arr = (read().msgs[uid] || []).slice().sort((a, b) => a.ts - b.ts);
        cb(arr);
      };
      emit();
      return onChange(emit);
    },

    async sendMessage(uid, { from, text }) {
      text = String(text || "").trim();
      if (!text) return;
      const db = read();
      (db.msgs[uid] = db.msgs[uid] || []).push({ id: uuid(), from, text, ts: Date.now() });
      write(db);
    },
  };
}

/* ============================================================
   LIVE backend — Firebase Auth + Firestore (loaded on demand).
   ============================================================ */
function liveBackend() {
  // Uses the Firebase "compat" SDK loaded via <script> tags in the page
  // (global `firebase`). This is more robust than dynamic ESM imports:
  // it loads at page load and fails loudly if it can't reach the network.
  let _svc = null;
  function svc() {
    if (_svc) return _svc;
    const fb = window.firebase;
    if (!fb || !fb.initializeApp) {
      throw new Error("Couldn't load Firebase. Check your internet connection and reload the page.");
    }
    const app = fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(FB);
    _svc = { fb, app, auth: fb.auth(app), db: fb.firestore(app) };
    return _svc;
  }
  function stamp() {
    return window.firebase.firestore.FieldValue.serverTimestamp();
  }

  function friendly(e) {
    const c = (e && e.code) || "";
    if (c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-credential") || c.includes("invalid-login"))
      return new Error("Wrong email or password.");
    if (c.includes("email-already-in-use")) return new Error("A customer with that email already exists.");
    if (c.includes("weak-password")) return new Error("Password must be at least 6 characters.");
    if (c.includes("invalid-email")) return new Error("That email address looks invalid.");
    if (c.includes("too-many-requests")) return new Error("Too many attempts. Please wait a moment.");
    if (c.includes("network-request-failed")) return new Error("Network problem reaching Firebase. Check your connection.");
    return new Error((e && e.message) || "Something went wrong.");
  }

  return {
    mode: "live",

    onAuth(cb) {
      let unsub = () => {};
      try {
        const { auth, db } = svc();
        unsub = auth.onAuthStateChanged(async (u) => {
          if (!u) return cb(null);
          if (isAdminEmail(u.email)) return cb({ uid: u.uid, email: u.email, name: "Administrator", isAdmin: true });
          let name = u.email;
          try {
            const s = await db.collection("customers").doc(u.uid).get();
            if (s.exists) name = s.data().name || u.email;
          } catch (e) {}
          cb({ uid: u.uid, email: u.email, name, isAdmin: false });
        });
      } catch (e) { cb(null); }
      return () => unsub();
    },

    async adminSignIn(email, password) {
      const { auth } = svc();
      email = String(email).trim();
      if (!isAdminEmail(email)) throw new Error("That email is not registered as an administrator.");
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (e) { throw friendly(e); }
    },

    async customerSignIn(email, password) {
      const { auth } = svc();
      try {
        await auth.signInWithEmailAndPassword(String(email).trim(), password);
      } catch (e) { throw friendly(e); }
    },

    async signOut() {
      const { auth } = svc();
      await auth.signOut();
    },

    async createCustomer({ email, password, name, startingBalance }) {
      const { fb, db } = svc();
      email = String(email).trim();
      const start = Number(startingBalance) || 0;
      // Create the auth user in a SECONDARY app so the admin stays signed in.
      const secApp = fb.initializeApp(FB, "secondary-" + Date.now());
      let uid;
      try {
        const cred = await secApp.auth().createUserWithEmailAndPassword(email, password);
        uid = cred.user.uid;
        await secApp.auth().signOut();
      } catch (e) {
        throw friendly(e);
      } finally {
        try { await secApp.delete(); } catch (e) {}
      }
      // Write the profile doc as the admin (primary session).
      await db.collection("customers").doc(uid).set({
        email, name: name || email, balance: start,
        createdAt: stamp(), createdBy: "admin",
      });
      if (start > 0) {
        await db.collection("customers").doc(uid).collection("transactions").add({
          type: "fund", amount: start, note: "Opening balance", by: "admin", ts: stamp(),
        });
      }
      return { uid };
    },

    async adjustBalance(uid, delta, note) {
      const { db } = svc();
      await db.runTransaction(async (tx) => {
        const ref = db.collection("customers").doc(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Customer not found.");
        const cur = Number(snap.data().balance) || 0;
        const next = cur + delta;
        if (next < 0) throw new Error("Balance cannot go below $0.00.");
        tx.update(ref, { balance: next });
        const txnRef = ref.collection("transactions").doc();
        tx.set(txnRef, {
          type: delta >= 0 ? "fund" : "deduct", amount: Math.abs(delta),
          note: note || "", by: "admin", ts: stamp(),
        });
      });
    },

    listCustomers(cb) {
      let unsub = () => {};
      try {
        const { db } = svc();
        unsub = db.collection("customers").orderBy("createdAt", "desc").onSnapshot(
          (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
          () => cb([]));
      } catch (e) { cb([]); }
      return () => unsub();
    },

    watchCustomer(uid, cb) {
      let unsub = () => {};
      try {
        const { db } = svc();
        unsub = db.collection("customers").doc(uid).onSnapshot(
          (s) => cb(s.exists ? { uid: s.id, ...s.data() } : null),
          () => cb(null));
      } catch (e) { cb(null); }
      return () => unsub();
    },

    watchTransactions(uid, cb) {
      let unsub = () => {};
      try {
        const { db } = svc();
        unsub = db.collection("customers").doc(uid).collection("transactions").orderBy("ts", "desc").onSnapshot(
          (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          () => cb([]));
      } catch (e) { cb([]); }
      return () => unsub();
    },

    watchMessages(uid, cb) {
      let unsub = () => {};
      try {
        const { db } = svc();
        unsub = db.collection("customers").doc(uid).collection("messages").orderBy("ts", "asc").onSnapshot(
          (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          () => cb([]));
      } catch (e) { cb([]); }
      return () => unsub();
    },

    async sendMessage(uid, { from, text }) {
      const { auth, db } = svc();
      text = String(text || "").trim();
      if (!text) return;
      await db.collection("customers").doc(uid).collection("messages").add({
        from, text, senderUid: (auth.currentUser && auth.currentUser.uid) || "", ts: stamp(),
      });
    },
  };
}

const backend = IS_LIVE ? liveBackend() : demoBackend();
export default backend;
export { IS_LIVE, CFG };
