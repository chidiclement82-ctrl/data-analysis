# Ember & Vine — Restaurant Website

A fast, mobile-friendly restaurant website built with plain HTML, CSS and JavaScript. It has no build step and no framework. Edit the files, push, and the site updates.

Live address, once GitHub Pages is switched on: **https://chidiclement82-ctrl.github.io/data-analysis/**

## Put it online (one-time setup)

1. Merge the pull request into `main`.
2. On GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab and re-run "Deploy site to GitHub Pages" if it already ran. The site is live about a minute later.

After that, every change pushed to `main` goes live automatically.

## Where to change things

Everything you'd normally change is in three files. Look for comments marked `EDIT` in each one.

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
404.html              "page not found" page
assets/css/style.css  design
assets/js/main.js     menu tabs, booking form, opening hours
assets/images/        photos and share image
robots.txt, sitemap.xml, site.webmanifest   for search engines and phones
.github/workflows/pages.yml                 publishes to GitHub Pages
```
