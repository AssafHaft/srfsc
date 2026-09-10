# SRF Park TLV session board

A glanceable Hebrew schedule of surf sessions at [SRF Park TLV](https://www.srfparktlv.co.il/sessions/?zone=reef-right%7Creef-left%7Cbay): opening hours, the wave level of every session, and spots left on each side, with today always front and centre.

- Site: https://assafhaft.github.io/srfsc/
- Design: [docs/superpowers/specs/2026-09-10-surf-schedule-design.md](docs/superpowers/specs/2026-09-10-surf-schedule-design.md)

## How it works

GitHub Actions runs `scraper/scrape.mjs` every hour (06:17–23:17 Israel time) and whenever someone presses "עדכון עכשיו" on the page. The scraper reads the park's schedule API, writes `site/data/schedule.json`, commits it, and deploys `site/` to GitHub Pages. The page is static HTML and JavaScript with no build step and no dependencies.

## Working on it

Needs Node 20 or newer. There's nothing to install.

```bash
npm test          # all unit tests (node --test)
npm run scrape    # fetch the live schedule into site/data/schedule.json
npm run serve     # preview the site at http://localhost:8000/
```

## One-time setup

1. Make the repo public: Settings → General → Danger Zone → Change visibility.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions tab → **Update schedule** → **Run workflow** (or wait for the next hourly run).
4. For the refresh button, create a fine-grained token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories → srfsc**
   - Permissions: **Actions: Read and write**, **Contents: Read-only**

   Paste it into the page the first time you press "עדכון עכשיו". It's stored only in that browser.

## If the park blocks GitHub's servers

The scraper is standalone, so it can run on your own computer instead:

1. Settings → Secrets and variables → Actions → Variables → add `SCRAPE_IN_ACTIONS` = `false`. The workflow then only deploys what's committed.
2. Run these hourly on your computer (for example with Windows Task Scheduler):

   ```bash
   node scraper/scrape.mjs
   git add site/data/schedule.json
   git commit -m "data: update schedule"
   git push
   ```

The refresh button won't be able to scrape in this mode; it will just redeploy.
