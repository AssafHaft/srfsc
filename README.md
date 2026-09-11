# SRF Park TLV session board

A glanceable Hebrew schedule of surf sessions at [SRF Park TLV](https://www.srfparktlv.co.il/sessions/?zone=reef-right%7Creef-left%7Cbay): opening hours, the wave level of every session, and spots left on each side, with today always front and centre. A second tab, "ניתוח", analyses the park's history: occupancy, strong and weak slots, trends, fill speed and the sessions at risk in the next two days.

- Site: https://assafhaft.github.io/srfsc/
- Design: [schedule](docs/superpowers/specs/2026-09-10-surf-schedule-design.md), [analysis](docs/superpowers/specs/2026-09-11-schedule-analysis-design.md)

## How it works

GitHub Actions runs every half hour (06:17–23:47 Israel time) and whenever someone presses "עדכון עכשיו" on the page:

1. `scraper/scrape.mjs` reads the park's schedule API and writes `site/data/schedule.json`.
2. `scraper/update-history.mjs` records that snapshot into the monthly history files in `site/data/history/`, and takes the park's final counts for the last 3 days.
3. The workflow commits `site/data/` and deploys `site/` to GitHub Pages.

The page is static HTML and JavaScript with no build step and no dependencies. The analysis tab computes everything in the browser from the history files, and revenue figures are estimates at the list prices in `site/config.js`.

## Working on it

Needs Node 20 or newer. There's nothing to install.

```bash
npm test               # all unit tests (node --test)
npm run scrape         # fetch the live schedule into site/data/schedule.json
npm run update-history # record it into site/data/history/
npm run update         # both of the above
npm run backfill       # one-time: import every past session the park still serves (about 5 minutes)
npm run serve          # preview the site at http://localhost:8000/
```

## One-time setup

Do steps 1 and 2 before merging into `main` — the merge runs the workflow, and it fails at the Pages step if Pages isn't enabled yet.

1. Make the repo public: Settings → General → Danger Zone → Change visibility.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions tab → **Update schedule** → **Run workflow** (or wait for the next scheduled run).
4. For the refresh button, create a fine-grained token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories → srfsc**
   - Permissions: **Actions: Read and write**, **Contents: Read-only**

   Paste it into the page the first time you press "עדכון עכשיו". It's stored only in that browser.

## More reliable snapshots (optional)

GitHub often skips scheduled runs, and the fill-speed charts are only as good as the snapshots behind them. A free cron service can start the same workflow the refresh button does:

1. Create another fine-grained token, limited to **srfsc**, with **Actions: Read and write** only.
2. At a service such as [cron-job.org](https://cron-job.org), create a job that runs every 30 minutes:
   - URL: `https://api.github.com/repos/AssafHaft/srfsc/actions/workflows/update.yml/dispatches`
   - Method: `POST`
   - Headers: `Authorization: Bearer <the token>`, `Accept: application/vnd.github+json`
   - Body: `{"ref":"main"}`

The token then lives at that service, so keep it limited to this repo and Actions, and give it an expiry.

## If the park blocks GitHub's servers

The scraper is standalone, so it can run on your own computer instead:

1. Settings → Secrets and variables → Actions → Variables → add `SCRAPE_IN_ACTIONS` = `false`. The workflow then only deploys what's committed.
2. Run these every half hour on your computer (for example with Windows Task Scheduler):

   ```bash
   npm run update
   git add site/data
   git commit -m "data: update schedule"
   git push
   ```

The refresh button won't be able to scrape in this mode; it will just redeploy.
