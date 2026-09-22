# Food Is Ready — Restaurant Website

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
| Customers | `https://chidiclement82-ctrl.github.io/data-analysis/order.html` | Order food on WhatsApp. Linked from the "Order on WhatsApp" buttons on the homepage |
| Admin | `https://chidiclement82-ctrl.github.io/data-analysis/admin.html` | Edit dishes and prices. Linked as "Admin" in the footer |

## Editing the menu (admin page)

All dishes, prices and sections live in [`menu.json`](menu.json). The homepage menu and the order page both read it, and the admin page edits it.

On `admin.html` you can:
- Change dish names, prices (in naira) and descriptions.
- Mark a dish **sold out**. It stays on the menu but can't be ordered.
- Tag dishes **Spicy**, **Popular** or **Vegetarian**.
- Add, delete and reorder dishes and whole menu sections.

Tap **Save & publish** when you're done. The website updates in about a minute.

**Signing in (once per phone or computer):** the admin page signs in with a GitHub access token, and saving writes `menu.json` straight into this repository.
1. Open [this link](https://github.com/settings/tokens/new?scopes=public_repo&description=Food%20Is%20Ready%20menu%20editor).
2. Choose an expiration and click **Generate token**.
3. Paste the token (it starts with `ghp_`) into the admin page.

Keep the token private, like a password.

For tighter security, use a [fine-grained token](https://github.com/settings/personal-access-tokens/new) instead:
- **Repository access:** Only select repositories → `data-analysis`.
- **Permissions:** Contents → **Read and write**.

## Order on WhatsApp

Customers pick dishes on `order.html` (the menu and prices come straight from the homepage), enter their name and choose pickup or delivery, then tap **Send on WhatsApp**. WhatsApp opens with the whole order already written, including dishes, quantities, total, name and address. They press send, and the order arrives on the restaurant's WhatsApp, where staff reply as in any normal chat.

There's no database, no login and no monthly cost.

**Switch it on:** open [`assets/js/order.js`](assets/js/order.js) and put your WhatsApp number, with country code, in `WHATSAPP_NUMBER` at the top, e.g. `"+234 801 234 5678"`. Until then, the order page says "Online ordering is coming soon" and shows your phone number.

Dishes marked sold out on the admin page show on the order page but can't be picked.

## Where to change things

Everything you'd normally change is in the files below. Look for comments marked `EDIT` in each one.

### `index.html`: all the words, menu and details

| To change… | Find… |
|---|---|
| Restaurant name | `Food <em>Is</em> Ready` in the header, footer, `<title>` and share tags at the top |
| Headline and intro | the `HERO` section |
| Your story | the `ABOUT` section |
| Menu items, prices and sections | the admin page (`admin.html`), or edit `menu.json` directly |
| Reviews / quotes | the `QUOTES` section |
| Events | the `EVENTS` section |
| Phone, email, address | the `RESERVE`, `VISIT` and footer sections |
| **Opening hours** | the hours table in `VISIT`. Only change `data-open` / `data-close` (24-hour time, e.g. `17:00`), or write `data-closed` for a day off. The displayed times, the booking time slots and the "Open now" badge all update from this automatically. Late closing such as `data-close="01:00"` works too |
| Map | the `iframe` in `VISIT`. Replace `Times+Square,New+York` with your address |
| Social links | the `Follow` list in the footer |
| Google search info | the `application/ld+json` block at the top. Keep name, phone, address and hours in step with the page |

### `assets/js/order.js`: WhatsApp orders

`WHATSAPP_NUMBER` at the top is where orders are sent (see "Order on WhatsApp" above). If you change your phone number, also update it in `order.html`.

### `assets/js/main.js`: booking settings

The `SETTINGS` block at the top:

- `BOOKING_WHATSAPP`: the WhatsApp number that receives booking requests. "Request Booking" opens the guest's WhatsApp with the booking already written, and they press send.
- `FORM_ENDPOINT`: optional. To receive bookings by email instead:
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
order.html            order on WhatsApp
404.html              "page not found" page
assets/css/style.css  design
assets/css/chat.css   design for the order page
assets/js/main.js     menu tabs, booking form, opening hours
assets/js/order.js    order page and your WhatsApp number
admin.html            menu editor (admin)
assets/js/admin.js    menu editor code
menu.json             the menu: dishes, prices, sections
assets/images/        photos and share image
robots.txt, sitemap.xml, site.webmanifest   for search engines and phones
.github/workflows/pages.yml                 publishes to GitHub Pages
```
