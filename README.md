# Ogarider — Restaurant Website

A fast, mobile-friendly restaurant website built with plain HTML, CSS and JavaScript. It has no build step and no framework. Edit the files, push, and the site updates.

Live address, once GitHub Pages is switched on: **https://ogarider.name.ng/**

## Put it online (one-time setup)

1. Merge the pull request into `main`.
2. On GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab and re-run "Deploy site to GitHub Pages" if it already ran. The site is live about a minute later.

After that, every change pushed to `main` goes live automatically.

## Links

| Who | Link | What it's for |
|---|---|---|
| Everyone | `https://ogarider.name.ng/` | The homepage: two buttons, Order on WhatsApp and View restaurants |
| Customers | `https://ogarider.name.ng/restaurants.html` | All restaurants; tap one to see its menu |
| Customers | `https://ogarider.name.ng/order.html` | Order food on WhatsApp. Linked from the green button on the homepage |
| Admin | `https://ogarider.name.ng/admin.html` | Edit restaurants, dishes, prices and photos (not linked from the site; bookmark it) |

## Editing the menu (admin page)

All restaurants, foods, photos and prices live in [`menu.json`](menu.json). The restaurants page and the order page both read it, and the admin page edits it.

On `admin.html` you can:
- Set the **homepage photo**: the background behind "FOOD IS READY" and the two buttons.
- **Add restaurants**, each with a name, a short description and a photo or logo. When there's more than one, customers pick a restaurant on the restaurants page.
- Add up to **5 food photos per restaurant**. They slide sideways by themselves under the restaurant's name and description when a customer opens its menu.
- **Add foods under each restaurant**, grouped in sections, with a name, price (in naira), description and **photo**. Photos are shrunk automatically so the site stays fast.
- Mark a food **sold out**. It stays on the menu but can't be ordered.
- Tag foods **Spicy**, **Popular** or **Vegetarian**.
- Delete and reorder foods, sections and restaurants.

**How customers see it:** the restaurants page shows every restaurant as a card, one under another. Customers scroll up and down, tap a restaurant to see its menu, and tap **← All restaurants** to go back. The order page works the same way, and customers can add foods from several restaurants to one order. A restaurant with no foods yet shows "Menu coming soon".

Tap **Save & publish** when you're done. The website updates in about a minute. Orders that include foods from several restaurants arrive on WhatsApp grouped by restaurant.

**Signing in (once per phone or computer):** the admin page signs in with a GitHub access token, and saving writes `menu.json` straight into this repository.
1. Open [this link](https://github.com/settings/tokens/new?scopes=public_repo&description=Food%20Is%20Ready%20menu%20editor).
2. Choose an expiration and click **Generate token**.
3. Paste the token (it starts with `ghp_`) into the admin page.

Keep the token private, like a password.

**Signing in on your phone (or another device):** on a phone or computer that's already signed in, open the admin page and tap **📱 Sign in on your phone or another device**. Scan the QR code with your phone's camera, or tap **Copy sign-in link** and open the link on your phone. The admin page opens already signed in. The code and link contain your token, so keep them private.

For tighter security, use a [fine-grained token](https://github.com/settings/personal-access-tokens/new) instead:
- **Repository access:** Only select repositories → `data-analysis`.
- **Permissions:** Contents → **Read and write**.

## Order on WhatsApp

Customers pick dishes on `order.html` (the menu and prices come straight from the homepage), enter their name and delivery address, then tap **Send on WhatsApp**. WhatsApp opens with the whole order already written, including dishes, quantities, total, name and delivery address. Ordering is delivery only. They press send, and the order arrives on the restaurant's WhatsApp, where staff reply as in any normal chat.

There's no database, no login and no monthly cost.

**Switch it on:** open [`assets/js/order.js`](assets/js/order.js) and put your WhatsApp number, with country code, in `WHATSAPP_NUMBER` at the top, e.g. `"+234 801 234 5678"`. Until then, the order page says "Online ordering is coming soon" and shows your phone number.

Dishes marked sold out on the admin page show on the order page but can't be picked.

## Where to change things

Everything you'd normally change is in the files below. Look for comments marked `EDIT` in each one.

### `index.html`: the homepage

The homepage does one job: it shows the logo, **FOOD IS READY** and two buttons, **ORDER ON WHATSAPP** (opens `order.html`) and **VIEW RESTAURANTS** (opens `restaurants.html`). The background photo is set on the admin page.

| To change… | Find… |
|---|---|
| Headline or button words | the `<main class="hero landing">` block |
| Google search info (name, phone, hours) | the `application/ld+json` block at the top |

### `restaurants.html`: the restaurant list

Lists every restaurant from `menu.json`. Customers tap one to see its menu. The words above the list are in the `section-head` block.

### `assets/js/order.js`: WhatsApp orders

`WHATSAPP_NUMBER` at the top is where orders are sent (see "Order on WhatsApp" above). If you change your phone number, also update it in `order.html`.

### `assets/css/style.css`: colours and fonts

The `:root` block at the top holds the brand colours (`--ember` is the main accent) and fonts.

## Share image and icons

- `assets/images/og-image.png` (1200×630) is the preview shown when the link is shared on WhatsApp, Facebook, X and similar. Replace it with your own image of the same size.
- `assets/logo-mark.svg` is the Ogarider logo (a steaming pot badge). `assets/favicon.svg` is the same logo for the browser tab; the PNG icons next to it are for phones' home screens.

## Your domain: ogarider.name.ng

The site uses the custom domain **ogarider.name.ng**, bought from WhoGoHost. The old address `chidiclement82-ctrl.github.io/data-analysis` forwards to it automatically.

**WhoGoHost DNS records** (Client Area → Domains → My Domains → Manage → DNS Management):

| Type | Host | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | chidiclement82-ctrl.github.io |

**GitHub:** Settings → Pages → Custom domain = `ogarider.name.ng`, with **Enforce HTTPS** ticked.

Renew the domain on WhoGoHost before it expires, or the site stops loading at this address.

## Preview on your computer

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

```
index.html            homepage: two buttons
restaurants.html      restaurant list and menus
order.html            order on WhatsApp
404.html              "page not found" page
assets/css/style.css  design
assets/css/chat.css   design for the order page
assets/js/home.js     homepage photo
assets/js/restaurants.js  restaurant list and menus
assets/js/order.js    order page and your WhatsApp number
admin.html            menu editor (admin)
assets/js/admin.js    menu editor code
assets/images/menu/   food and restaurant photos uploaded from the admin page
menu.json             the menu: dishes, prices, sections
assets/images/        photos and share image
robots.txt, sitemap.xml, site.webmanifest   for search engines and phones
.github/workflows/pages.yml                 publishes to GitHub Pages
```
