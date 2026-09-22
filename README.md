# Ember & Vine — Restaurant Website

A fast, mobile-friendly restaurant website built with plain HTML, CSS and JavaScript. No build step and no framework, so it can be hosted anywhere for free.

## What's included

- **Hero section** with the main buttons ("Reserve a Table" and "View the Menu")
- **Our Story** section with the restaurant's background and some stats
- **Tabbed menu**: starters, mains, pasta, dessert and drinks, with dietary tags (V / VG / GF)
- **Press quotes** and **events / private dining** cards
- **Reservation form** that shows only valid times for the chosen day, checks the fields and sends the request by email
- **Hours and map**: today's row is highlighted and a live "Open now" / "Closed now" badge is shown
- **SEO**: page description, social sharing tags and `schema.org/Restaurant` data, so Google can show your hours and address
- Accessibility features: skip link, keyboard-friendly tabs and reduced-motion support. There is also a custom 404 page.

## Preview locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Put it online (free, with GitHub Pages)

1. Merge this branch into `main`.
2. In the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Each push to `main` then deploys the site to `https://<your-username>.github.io/<repo-name>/`.
4. Optional: to use a custom domain such as `emberandvine.com`, add it under **Settings → Pages → Custom domain** and point your DNS at GitHub.

The site also works on Netlify, Vercel or Cloudflare Pages. Drag and drop the folder, or connect the repo. No build command is needed.

## Make it yours

| What | Where |
|---|---|
| Name, text, menu items, prices | `index.html` |
| Address, phone, hours for Google | the `application/ld+json` block at the top of `index.html` |
| Opening hours (for the time picker and "Open now" badge) | `HOURS` at the top of `assets/js/main.js`; keep it in sync with the hours table in `index.html` |
| Email that receives bookings | `BOOKING_EMAIL` in `assets/js/main.js` |
| Colours and fonts | `:root` variables at the top of `assets/css/style.css` |
| Map | the `iframe` `src` in the Visit section. Replace `Times+Square,New+York` with your address |
| Photos | put images in `assets/images/`. Swap the decorative `.art-panel` / `.card-art` blocks for `<img>` tags (there's a comment showing how) |

## Reservations

Out of the box, the form opens the guest's email app with the booking details already filled in. This needs no server.

To receive bookings straight to your inbox instead, with no email app on the guest's side:

- **Formspree / Basin / Getform**: create a free form, then give the `<form>` an `action="https://formspree.io/f/…"` and `method="POST"`. Also remove the `mailto` redirect in `main.js`.
- **OpenTable / Resy / SevenRooms**: replace the form with the booking widget from your provider.
