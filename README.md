# Ember & Vine — Restaurant Website

A fast, mobile-friendly restaurant website built with plain HTML, CSS and JavaScript. It has no build step and no framework. Edit the files, push, and the site updates.

Live address, once GitHub Pages is switched on: **https://chidiclement82-ctrl.github.io/data-analysis/**

## Put it online (one-time setup)

1. Merge the pull request into `main`.
2. On GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab and re-run "Deploy site to GitHub Pages" if it already ran. The site is live about a minute later.

After that, every change pushed to `main` goes live automatically.

## Links

| Who | Link | What it's for |
|---|---|---|
| Everyone | `https://chidiclement82-ctrl.github.io/data-analysis/` | The main website |
| Customers | `https://chidiclement82-ctrl.github.io/data-analysis/order.html` | Order food by chat. Linked from the "Order by chat" button on every page |
| Staff | `https://chidiclement82-ctrl.github.io/data-analysis/admin.html` | Staff inbox (password protected). Linked as "Staff login" in the footer |

## Order chat (one-time setup, about 15 minutes)

Customers chat with the kitchen on `order.html`. They type what they want, or tap **Menu** to pick dishes and send an order with a running total. Staff sign in on `admin.html` to see every conversation live, reply, and set each order's status: New → Confirmed → Preparing → Ready → Completed, or Cancelled. Customers see replies and status changes instantly.

The chat runs on **Firebase**, Google's hosted database. It's free for a restaurant's volume and needs no server of your own. Until it's set up, the order page shows "Online ordering is coming soon" with your phone number.

1. **Create a project.** Go to [console.firebase.google.com](https://console.firebase.google.com), click **Create a project**, and give it any name. You can switch Google Analytics off.
2. **Turn on sign-in.** Open **Build → Authentication → Get started → Sign-in method** and enable:
   - **Anonymous**, so customers can chat without making an account.
   - **Email/Password**, for staff.
3. **Create the database.** Open **Build → Firestore Database → Create database**. Choose **production mode** and a location near you.
4. **Add the security rules.** In Firestore, open the **Rules** tab, delete what's there, paste the whole of [`firestore.rules`](firestore.rules) and click **Publish**. These rules let each customer see only their own chat, and only staff see everything.
5. **Add your staff.** For each staff member:
   1. **Authentication → Users → Add user**: enter their email and a password, then copy the **User UID** shown in the list.
   2. **Firestore Database → Data → Start collection** (or open `admins` if it already exists). Set the collection ID to `admins`, set the **Document ID** to the UID you copied, and add one field, e.g. `name` = `Owner`. Save.

   Only people listed in `admins` can open the inbox. Anyone else who signs in is refused.
6. **Connect the website.** Open **Project settings** (the gear icon next to "Project Overview"). At the top of the **General** tab, copy two values into [`assets/js/firebase-config.js`](assets/js/firebase-config.js):
   - **Project ID** → `projectId`
   - **Web API Key** → `apiKey`. If it says there's no key, finish step 2 first; the key appears once Authentication is set up.

   The other values can stay empty. These values are meant to be public; the security rules are what protect your data.
7. Push to `main`. Open `admin.html`, sign in, then open `order.html` on your phone and send a test order.

**Using the inbox**

- Keep `admin.html` open on the counter tablet or laptop. New messages play a chime, show a count in the browser tab, and can pop up as desktop notifications (tap **Turn on alerts**).
- The one-tap replies above the reply box can be changed in `admin.html`; search for `EDIT: one-tap replies`.
- Menu prices shown in orders come straight from the menu on your homepage, so there's nothing extra to update. Items with a price range (like "$12–18") can't be picked from the menu, but customers can still type them.
- Customers return to their conversation by opening `order.html` again on the same phone or browser.

**Test locally without a Firebase project**

Run `npx firebase-tools emulators:start --project demo-restaurant` (needs Java), serve the folder, then open `http://localhost:8000/order.html?emulator` and `http://localhost:8000/admin.html?emulator`.

## Where to change things

Everything you'd normally change is in the files below. Look for comments marked `EDIT` in each one.

### `index.html`: all the words, menu and details

| To change… | Find… |
|---|---|
| Restaurant name | `Ember` / `Vine` in the header, footer, `<title>` and share tags at the top |
| Headline and intro | the `HERO` section |
| Your story | the `ABOUT` section |
| Menu items and prices | the `MENU` section. Each dish is one `<li>`: copy a line to add a dish, delete a line to remove one. Tags: `V` vegetarian, `VG` vegan, `GF` gluten-free |
| Menu categories | the tab buttons (`role="tab"`) and their matching `menu-panel` blocks |
| Reviews / quotes | the `QUOTES` section |
| Events | the `EVENTS` section |
| Phone, email, address | the `RESERVE`, `VISIT` and footer sections |
| **Opening hours** | the hours table in `VISIT`. Only change `data-open` / `data-close` (24-hour time, e.g. `17:00`), or write `data-closed` for a day off. The displayed times, the booking time slots and the "Open now" badge all update from this automatically. Late closing such as `data-close="01:00"` works too |
| Map | the `iframe` in `VISIT`. Replace `Times+Square,New+York` with your address |
| Social links | the `Follow` list in the footer |
| Google search info | the `application/ld+json` block at the top. Keep name, phone, address and hours in step with the page |

### `assets/js/firebase-config.js`: order chat

Paste your Firebase settings here (see "Order chat" above). If you change your phone number, also update it in `order.html`.

### `assets/js/main.js`: booking settings

The `SETTINGS` block at the top:

- `BOOKING_EMAIL`: where booking requests go.
- `FORM_ENDPOINT`: optional, but recommended. By default, "Request Booking" opens the guest's email app with the booking already written, and they press send. To receive bookings straight to your inbox instead:
  1. Make a free form at [formspree.io](https://formspree.io).
  2. Paste its URL here, e.g. `"https://formspree.io/f/abcdwxyz"`.
  3. Bookings then arrive by email with no action from the guest. Spam protection is built in.
- `LAST_SEATING_MINUTES_BEFORE_CLOSE` and `SLOT_MINUTES`: control which times guests can pick.

### `assets/css/style.css`: colours and fonts

The `:root` block at the top holds the brand colours (`--ember` is the main accent) and fonts.

## Photos

Put photos in `assets/images/`; `.jpg` files around 1600px wide work well. The coloured "art" blocks are placeholders:

- **About section:** replace the contents of `<div class="art-panel art-fire" …>` with
  `<img src="assets/images/kitchen.jpg" alt="Describe the photo">`.
- **Event cards:** replace `<div class="card-art art-wine" aria-hidden="true"></div>` with
  `<img class="card-art" src="assets/images/wine.jpg" alt="…" style="object-fit:cover;width:100%">`.

## Share image and icons

- `assets/images/og-image.png` (1200×630) is the preview shown when the link is shared on WhatsApp, Facebook, X and similar. Replace it with your own image of the same size.
- `assets/favicon.svg` is the browser-tab icon. The PNG icons next to it are for phones' home screens.

## Using your own domain

1. Add the domain under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions.
2. Replace `https://chidiclement82-ctrl.github.io/data-analysis/` with your domain in `index.html`, `robots.txt` and `sitemap.xml`.

## Preview on your computer

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

```
index.html            the whole site
order.html            customer order chat
admin.html            staff inbox (login)
404.html              "page not found" page
assets/css/style.css  design
assets/css/chat.css   design for the chat and inbox
assets/js/main.js     menu tabs, booking form, opening hours
assets/js/order.js    customer chat
assets/js/admin.js    staff inbox
assets/js/chat-common.js     shared chat code
assets/js/firebase-config.js your Firebase settings
firestore.rules       database security rules (paste into Firebase)
firebase.json         for the Firebase command-line tools (optional)
assets/images/        photos and share image
robots.txt, sitemap.xml, site.webmanifest   for search engines and phones
.github/workflows/pages.yml                 publishes to GitHub Pages
```
