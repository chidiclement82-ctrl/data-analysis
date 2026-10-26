# Banter FC ⚽

A fun football banter page. It's plain HTML, CSS and JavaScript with no build step and no server.

Live at **https://ogarider.name.ng/banter/** once merged into `main`. GitHub Pages publishes it with the rest of the site.

## What's on it

- **Roast Machine:** pick your club and a rival, then get a roast you can send on WhatsApp.
- **Why We Lost:** a random excuse generator for after a bad result.
- **Bottle-o-meter:** a made-up "bottle risk" score for any club, with an animated gauge.
- **Are You a Glory Hunter?:** a five-question test with a verdict at the end.
- **Fan Card:** type your name and download your own Banter FC ID card as a PNG.
- **House Rules:** keep the banter about football.

The page remembers your club and name on your phone, so you don't have to pick them again.

## Adding clubs or jokes

Everything lives at the top of [`js/banter.js`](js/banter.js):

- `CLUBS`: each club's name, nickname, colours (used on the fan card), `bottle` score (0–100) and roasts.
- `GENERIC_ROASTS`: roasts that work for any club. `{r}` becomes the rival and `{m}` becomes your club.
- `EXCUSES`, `QUIZ`, `FAN_TITLES`: the excuse parts, quiz questions and fan card titles.

Keep the jokes about clubs and football, not about real people.
