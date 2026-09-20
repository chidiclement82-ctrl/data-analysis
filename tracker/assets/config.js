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
    "chidiclement82@gmail.com",
  ],

  // 2) Firebase web config. Copy it from:
  //    Firebase Console → Project settings → Your apps → SDK setup → Config.
  //    Leave the placeholders as-is to stay in DEMO MODE.
  firebase: {
    apiKey:            "AIzaSyA44IWA-l8vqG5kDhHSn4jAWyBRfk0855A",
    authDomain:        "ledgerline-e4476.firebaseapp.com",
    projectId:         "ledgerline-e4476",
    storageBucket:     "ledgerline-e4476.firebasestorage.app",
    messagingSenderId: "126839041623",
    appId:             "1:126839041623:web:6fa144632a525a506cfd12",
  },

  // Cosmetic
  brandName: "Ledgerline",
  currency:  "USD",   // ISO code used to format money (en-US locale)
};
