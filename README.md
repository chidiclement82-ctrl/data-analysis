# Data Analysis Dashboard

An interactive, static data dashboard that publishes to a public GitHub Pages URL.

**Live URL (after setup below):**
`https://chidiclement82-ctrl.github.io/data-analysis/`

## What's here

```
index.html          The dashboard page
assets/style.css     Styling + light/dark theme tokens
assets/dashboard.js  Renders the KPI tiles, charts, and table
data/data.js         >>> Your data lives here — edit this file <<<
.github/workflows/   Auto-deploy to GitHub Pages on push to main
```

The dashboard shows KPI stat tiles, a revenue trend line chart (this year vs last
year), a revenue-by-category bar chart, and a data table view. Charts are built
with [Chart.js](https://www.chartjs.org/) and support light and dark themes.

## Use your own data

Open `data/data.js` and replace the sample values. Everything on the page is
driven by that one file — the tiles, the labels, and both charts. No build step,
no dependencies to install.

## Preview locally

Because `data/data.js` is loaded as a plain script, you can just open
`index.html` in a browser. Or run a tiny local server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publish the public link (one-time setup)

1. Merge this branch into `main` (or push these files to `main`).
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The "Deploy dashboard to GitHub Pages" workflow runs and publishes the site.

After the first run, every push to `main` republishes automatically. The public
link appears in **Settings → Pages** and on the workflow's summary page.
