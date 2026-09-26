# Land & Properties — TV / screen ad

A full-screen, looping slideshow of land and properties for sale, meant to
play on a TV or display screen (reception, shop window, expo stand). Plain
HTML — no build step, no framework. Open `index.html` in any browser.

## Play it on a screen

1. Open **`index.html`** in a browser on the device connected to the TV.
2. Press **F** for full screen (or click the tab's full-screen control).
3. Leave it running. It loops on its own.

Controls while it's open: **Space** = pause/play · **←/→** = move between
slides · **F** = full screen · **click** = pause/play. The mouse pointer
hides itself after a couple of seconds so it looks clean on a display.

Live online (once the site is on GitHub Pages) it will be at
`https://ogarider.name.ng/land-tv/`.

## Edit your properties

Open `index.html` and edit the two blocks near the top of the `<script>`:

- **`CONFIG`** — your business name, tagline and phone number.
- **`PROPERTIES`** — the list of slides. Copy one entry to add another.
  - `title` is the only required field.
  - `status`: `"available"`, `"hot"` (shows a red "Selling fast" pill) or `"sold"`.
  - `facts`: up to a few `["Label", "Value"]` pairs. Any fact whose label or
    value mentions a price / ₦ is highlighted in gold.
  - `photo`: leave it `""` to get a styled placeholder background, or drop a
    photo into this folder and set e.g. `"photos/plot1.jpg"`.

To change how long each slide shows, edit `--slide-seconds` in the CSS
`:root` block. To rebrand the colours, edit the other `:root` variables.

## The "Scan to enquire" QR code

`enquiry-qr.svg` is the QR shown bottom-right. To point it at your own
WhatsApp (or website / map pin), run:

```
python3 make-qr.py "https://wa.me/2348012345678?text=Hi, I saw your property on the screen"
```

Then refresh the page. (Needs Python with the `segno` package:
`pip install segno`.)
