/* ============================================================
   CONFIGURATION — this is the only file you normally edit.
   ============================================================

   The tracker runs in one of two modes automatically:

   • DEMO MODE  (default, right now)
     Nothing is configured, so everything runs on THIS browser's
     local storage. Great for trying the app, but data is NOT
     shared across devices and is NOT real. A yellow banner shows.

   • LIVE MODE  (real public app)
     Paste your Firebase project's web config below and list your
     admin email(s). The app then uses Firebase Auth + Firestore,
     so customers can sign in from anywhere and balances/messages
     are shared and secured.

   See tracker/README.md for the 5-minute Firebase setup.
   ============================================================ */

window.APP_CONFIG = {
  // 1) Your admin email address(es). Whoever signs in on the admin
  //    page with one of these emails is the administrator.
  //    (Create this account in Firebase Console → Authentication.)
  adminEmails: [
    "you@example.com",
  ],

  // 2) Firebase web config. Copy it from:
  //    Firebase Console → Project settings → Your apps → SDK setup → Config.
  //    Leave the placeholders as-is to stay in DEMO MODE.
  firebase: {
    apiKey:            "PASTE_YOUR_API_KEY",
    authDomain:        "PASTE_YOUR_PROJECT.firebaseapp.com",
    projectId:         "PASTE_YOUR_PROJECT_ID",
    storageBucket:     "PASTE_YOUR_PROJECT.appspot.com",
    messagingSenderId: "PASTE_SENDER_ID",
    appId:             "PASTE_APP_ID",
  },

  // Cosmetic
  brandName: "Ledgerline",
  currency:  "USD",   // ISO code used to format money (en-US locale)
};
