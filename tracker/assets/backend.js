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
  const V = "10.12.2";
  const base = "https://www.gstatic.com/firebasejs/" + V + "/";
  let ready = null; // memoized promise resolving to { auth, db, fns }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      const appMod = await import(base + "firebase-app.js");
      const authMod = await import(base + "firebase-auth.js");
      const fsMod = await import(base + "firebase-firestore.js");
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FB);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      return { app, auth, db, appMod, authMod, fsMod };
    })();
    return ready;
  }

  function friendly(e) {
    const c = (e && e.code) || "";
    if (c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-credential"))
      return new Error("Wrong email or password.");
    if (c.includes("email-already-in-use")) return new Error("A customer with that email already exists.");
    if (c.includes("weak-password")) return new Error("Password must be at least 6 characters.");
    if (c.includes("invalid-email")) return new Error("That email address looks invalid.");
    if (c.includes("too-many-requests")) return new Error("Too many attempts. Please wait a moment.");
    return new Error((e && e.message) || "Something went wrong.");
  }

  return {
    mode: "live",

    onAuth(cb) {
      let unsub = () => {};
      init().then(({ auth, authMod, db, fsMod }) => {
        unsub = authMod.onAuthStateChanged(auth, async (u) => {
          if (!u) return cb(null);
          if (isAdminEmail(u.email)) return cb({ uid: u.uid, email: u.email, name: "Administrator", isAdmin: true });
          let name = u.email;
          try {
            const s = await fsMod.getDoc(fsMod.doc(db, "customers", u.uid));
            if (s.exists()) name = s.data().name || u.email;
          } catch (e) {}
          cb({ uid: u.uid, email: u.email, name, isAdmin: false });
        });
      }).catch(() => cb(null));
      return () => unsub();
    },

    async adminSignIn(email, password) {
      const { auth, authMod } = await init();
      email = String(email).trim();
      if (!isAdminEmail(email)) throw new Error("That email is not registered as an administrator.");
      try {
        await authMod.signInWithEmailAndPassword(auth, email, password);
      } catch (e) { throw friendly(e); }
    },

    async customerSignIn(email, password) {
      const { auth, authMod } = await init();
      try {
        await authMod.signInWithEmailAndPassword(auth, String(email).trim(), password);
      } catch (e) { throw friendly(e); }
    },

    async signOut() {
      const { auth, authMod } = await init();
      await authMod.signOut(auth);
    },

    async createCustomer({ email, password, name, startingBalance }) {
      const { app, appMod, authMod, db, fsMod } = await init();
      email = String(email).trim();
      const start = Number(startingBalance) || 0;
      // Create the auth user in a SECONDARY app so the admin stays signed in.
      const secApp = appMod.initializeApp(FB, "secondary-" + Date.now());
      let uid;
      try {
        const secAuth = authMod.getAuth(secApp);
        const cred = await authMod.createUserWithEmailAndPassword(secAuth, email, password);
        uid = cred.user.uid;
        await authMod.signOut(secAuth);
      } catch (e) {
        throw friendly(e);
      } finally {
        try { await appMod.deleteApp(secApp); } catch (e) {}
      }
      // Write the profile doc as the admin (primary session).
      await fsMod.setDoc(fsMod.doc(db, "customers", uid), {
        email, name: name || email, balance: start,
        createdAt: fsMod.serverTimestamp(), createdBy: "admin",
      });
      if (start > 0) {
        await fsMod.addDoc(fsMod.collection(db, "customers", uid, "transactions"), {
          type: "fund", amount: start, note: "Opening balance", by: "admin", ts: fsMod.serverTimestamp(),
        });
      }
      return { uid };
    },

    async adjustBalance(uid, delta, note) {
      const { db, fsMod } = await init();
      await fsMod.runTransaction(db, async (tx) => {
        const ref = fsMod.doc(db, "customers", uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Customer not found.");
        const cur = Number(snap.data().balance) || 0;
        const next = cur + delta;
        if (next < 0) throw new Error("Balance cannot go below $0.00.");
        tx.update(ref, { balance: next });
        const txnRef = fsMod.doc(fsMod.collection(db, "customers", uid, "transactions"));
        tx.set(txnRef, {
          type: delta >= 0 ? "fund" : "deduct", amount: Math.abs(delta),
          note: note || "", by: "admin", ts: fsMod.serverTimestamp(),
        });
      });
    },

    listCustomers(cb) {
      let unsub = () => {};
      init().then(({ db, fsMod }) => {
        const q = fsMod.query(fsMod.collection(db, "customers"), fsMod.orderBy("createdAt", "desc"));
        unsub = fsMod.onSnapshot(q, (snap) => {
          cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
        }, () => cb([]));
      });
      return () => unsub();
    },

    watchCustomer(uid, cb) {
      let unsub = () => {};
      init().then(({ db, fsMod }) => {
        unsub = fsMod.onSnapshot(fsMod.doc(db, "customers", uid), (s) => {
          cb(s.exists() ? { uid: s.id, ...s.data() } : null);
        }, () => cb(null));
      });
      return () => unsub();
    },

    watchTransactions(uid, cb) {
      let unsub = () => {};
      init().then(({ db, fsMod }) => {
        const q = fsMod.query(fsMod.collection(db, "customers", uid, "transactions"), fsMod.orderBy("ts", "desc"));
        unsub = fsMod.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
      });
      return () => unsub();
    },

    watchMessages(uid, cb) {
      let unsub = () => {};
      init().then(({ db, fsMod }) => {
        const q = fsMod.query(fsMod.collection(db, "customers", uid, "messages"), fsMod.orderBy("ts", "asc"));
        unsub = fsMod.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
      });
      return () => unsub();
    },

    async sendMessage(uid, { from, text }) {
      const { auth, db, fsMod } = await init();
      text = String(text || "").trim();
      if (!text) return;
      await fsMod.addDoc(fsMod.collection(db, "customers", uid, "messages"), {
        from, text, senderUid: (auth.currentUser && auth.currentUser.uid) || "", ts: fsMod.serverTimestamp(),
      });
    },
  };
}

const backend = IS_LIVE ? liveBackend() : demoBackend();
export default backend;
export { IS_LIVE, CFG };
