# SRF Park TLV surf schedule: design spec

**Date:** 2026-09-10
**Status:** Approved in brainstorming, pending spec review
**Visual reference:** [assets/2026-09-10-surf-schedule-mockup.html](assets/2026-09-10-surf-schedule-mockup.html) (self-contained; real park data for 10–24/09/2026, clock fixed at Thursday 10/09 16:20)

## 1. Goal

A personal, glanceable schedule board for SRF Park TLV's wave lagoon (reef right, reef left, Bay), hosted on GitHub Pages. In one look it answers: which wave, when, and is there room. Today is always the most prominent thing on the page.

It shows everything the park has published (about two weeks ahead): opening and closing hours per day, the session and wave level for each hour, and spots left on each side. Data refreshes automatically every hour, and on demand from a button on the page.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Refresh button | Starts the GitHub Actions scrape workflow through the GitHub API, using a fine-grained token stored in the browser |
| Horizon | Upcoming only (today → last published day). No history archive |
| Language | Hebrew, right-to-left. Session names as the park publishes them (`name` field) |
| Hosting | GitHub Pages from a **public** repo (`AssafHaft/srfsc`) |
| Data flow | One workflow scrapes, commits `site/data/schedule.json`, then deploys Pages (approach A) |
| Level filter chips | Kept |

### Out of scope

History of past days, English UI, notifications or alerts, booking from the page, other parks or zones, dark mode.

## 2. Data source: the park's API

Found by reading the park's `sessions.js` bundle and probing the endpoint on 2026-09-10.

```
GET https://www.srfparktlv.co.il/products/sessions-react/?ajax=1&from_date=DD/MM/YY
Headers: X-Requested-With: XMLHttpRequest, browser-like User-Agent
```

- Returns one **3-day window** starting at `from_date`: `{ success, scheduler[], close_days[], dateArray[], from_date, to_date }`.
- Without `ajax=1` the server answers `302 → //abuse.spd.co.il`. With it, a plain script (curl, Node `fetch`) gets `200 application/json`; no cookies or CSRF token needed.
- No CORS headers, so a browser page on another origin cannot call it. That's why scraping happens in GitHub Actions.
- The park publishes about 14 days ahead ("לו"ז הפעילות מתעדכן שבועיים מראש"). On 2026-09-10 data ran through 24/09; windows from 25/09 on were empty.

### Fields used from each `scheduler` row

Each row is **one side** of one session.

| Field | Meaning |
|---|---|
| `scheduler_id` | Unique id of this row |
| `name` | Session name as shown on the park's Hebrew site, e.g. `L5 - Expert (T2 Only)`, `שיעור גלישה למתחילים ב Bay - בוגרים מעל גיל 16` |
| `date`, `startTime`, `endTime` | `2026-09-10`, `06:00:00`, `07:00:00` |
| `wave_level` | 1–6 for the reef |
| `area` | `reef` or `bay` |
| `area_number` | `right` or `left`; for Bay it may also be a comma list of pool numbers `1`–`6` |
| `right_max_users`, `right_count_users`, `left_max_users`, `left_count_users` | Capacity and booked count per side |
| `disabled` | `0` or `true` |

`close_days[]` entries: `{ date, text, text_en }`, e.g. `2026-09-21`, `יום כיפור`. A date can also have no sessions and no close-day entry (20/09/2026, Yom Kippur eve).

### Normalization rules

These mirror the park's own `computeBox` function so our numbers match its site:

- **Side:** `area_number === "left"` → left, `"right"` → right. For Bay, a list containing `4`/`5`/`6` → left, containing `1`/`2`/`3` → right (the latter wins if both appear).
- **Spots left:** `max(0, <side>_max_users − <side>_count_users)` for that side. `capacity` is `<side>_max_users`.
- **Level:** Bay rows are level 0 (shown as "Bay"); reef rows use `wave_level`.
- **Available:** `spotsLeft > 0 && !disabled`. A disabled row shows as full.
- Rows whose side can't be determined are skipped and logged as a warning. They don't fail the run.

## 3. Data file: `site/data/schedule.json`

One entry per scheduler row (per side). The page pairs rows into slots for display.

```json
{
  "fetchedAt": "2026-09-10T16:17:00+03:00",
  "publishedThrough": "2026-09-24",
  "days": [
    {
      "date": "2026-09-10",
      "open": "06:00",
      "close": "22:00",
      "closed": null,
      "sessions": [
        { "id": 37303, "start": "06:00", "end": "07:00", "name": "L6 Pro (T2+B2)",
          "level": 6, "area": "reef", "side": "right",
          "capacity": 15, "booked": 7, "spotsLeft": 8, "available": true }
      ]
    },
    { "date": "2026-09-20", "open": null, "close": null, "closed": null, "sessions": [] },
    { "date": "2026-09-21", "open": null, "close": null, "closed": "יום כיפור", "sessions": [] }
  ]
}
```

- `days` covers every date from today (Israel time) through `publishedThrough`, including empty and closed days, sorted by date. Sessions sorted by `start`, then `area` (reef before bay), then `side` (right before left).
- `open`/`close` = first session start / last session end of that day. The park publishes no separate opening hours.
- `publishedThrough` = the latest date that has sessions or a close-day entry.
- `fetchedAt` = ISO timestamp with Israel offset.
- Written with stable key order and 2-space indentation so git diffs are readable.

## 4. Scraper (`scraper/`)

Node 22 (as on the Actions runner; works on Node 20+), ES modules, **no dependencies**.

| File | Responsibility |
|---|---|
| `scraper/fetch.mjs` | `fetchWindow(fromDate)` for one 3-day window, with headers and retries. `fetchHorizon(today)` walks windows forward |
| `scraper/normalize.mjs` | Pure function: raw windows → the data file model (section 3). All the rules from section 2 |
| `scraper/dates.mjs` | Israel-time helpers: today's date, `DD/MM/YY` formatting, adding days |
| `scraper/scrape.mjs` | CLI entry: fetch, normalize, validate, compare with the existing file, write |

**Walking the horizon:** start at today's date in `Asia/Jerusalem`, request consecutive 3-day windows, stop after **2 consecutive windows with no sessions and no close days**, and never request more than **12 windows**.

**Retries:** each request is retried up to 3 times (waits of 2 s, 4 s, 8 s) on network errors, non-200 responses, non-JSON bodies or `success !== true`. If a window still fails, the scraper exits non-zero without writing anything.

**Refuse to overwrite with nothing:** if the scrape returns zero sessions and no close days while the existing file has sessions dated today or later, exit non-zero (most likely blocked) and keep the existing file.

**Validation:** every kept row must have a valid date, `HH:MM` times with end after start, and non-negative integer counts. Rows failing validation are skipped and logged.

Politeness: about 6–8 requests per run, at most once an hour plus manual refreshes.

## 5. Workflow (`.github/workflows/update.yml`)

One job that scrapes, commits and deploys. Pushes made with `GITHUB_TOKEN` don't trigger other workflows, so everything happens in this single job.

- **Triggers:**
  - `schedule: cron "17 3-20 * * *"`: hourly at minute 17 (off the busy top of the hour), 06:17–23:17 Israel summer time (05:17–22:17 in winter).
  - `workflow_dispatch`: the page's refresh button.
  - `push` to `main`: deploys code changes.
- **Permissions:** `contents: write`, `pages: write`, `id-token: write`.
- **Concurrency:** group `update`, `cancel-in-progress: false`. Runs never overlap; a button press while the hourly run is going waits in the queue.
- **Steps:**
  1. `actions/checkout`
  2. `actions/setup-node` (Node 22)
  3. `node --test`: the unit tests gate every run
  4. `node scraper/scrape.mjs`
  5. If `site/data/schedule.json` changed: commit as `github-actions[bot]` with message `data: update schedule`, `git pull --rebase` (in case you pushed code meanwhile), then push
  6. `actions/configure-pages`
  7. `actions/upload-pages-artifact` with path `site`
  8. `actions/deploy-pages`

`fetchedAt` changes every run, so in practice every successful run commits (about 18 small commits a day). The commits also count as repository activity, which should keep GitHub from pausing the schedule after 60 days of inactivity on a public repo. The stale-data warning (section 8) catches it if that assumption is wrong.

## 6. The page (`site/`)

Static HTML, CSS and plain JavaScript modules. No build step, no dependencies.

| File | Responsibility |
|---|---|
| `site/index.html` | Shell: header, controls, view container, token panel |
| `site/styles.css` | All styling (tokens in section 7) |
| `site/config.js` | `owner: "AssafHaft"`, `repo: "srfsc"`, `workflow: "update.yml"`, `branch: "main"` |
| `site/app.js` | Loads data, holds UI state, renders views, wires events |
| `site/lib/time.mjs` | Israel-time "today" and "now" via `Intl.DateTimeFormat(..., { timeZone: "Asia/Jerusalem" })`, date math, formatting (`10.9`) |
| `site/lib/schedule.mjs` | Pure view logic: pair right/left rows into slots, week and month ranges, past and now detection, day summaries |
| `site/lib/stale.mjs` | Stale-data rule |
| `site/lib/refresh.mjs` | Refresh flow as a small state machine over an injected `fetch` (testable without a browser) |
| `site/lib/render.mjs` | HTML builders for week, month, day. All park text escaped |

### Views

The view lives in the URL hash (`#day`, `#week`, `#month`) so it can be bookmarked. With no hash, the default is `#week` at 720 px wide or more and `#day` below that.

**Week:** the 7 days starting today, drawn as a calendar. Today is the first column (rightmost), next to the hour column.
- The hour column shows full times (`15:00`) from the earliest start to the latest end across the 7 days, at a fixed 56 px per hour. Day columns are at least 140 px wide.
- Each day header shows the day name ("היום" for today), the date (`10.9`) and the opening hours in full ("פתוח 06:00–22:00"), or "סגור" / "אין סשנים".
- Each session is a **block** placed at its start time, with height equal to its length, so a 90-minute Bay lesson visibly spans an hour and a half. Every block shows its start–end time on top (`17:30–19:00`), then the level chip and spots left.
- Blocks use the full column width unless they overlap (standard calendar overlap layout, worked out per cluster of overlapping blocks). Where reef and Bay overlap, reef takes the right 64% and Bay the left 36%. Blocks of the same area that overlap at different times split their share side by side.
- Bay blocks have a light sand tint and no chip, since the tint marks them as Bay. Their time may wrap onto two lines (they're 90 minutes tall).
- Rows with the same start, end and area share one block:
  - a right/left reef pair with the same name: one chip, then right number, pier line, left number
  - different sessions on the two sides (e.g. 20:00 on 10/09): one line with a chip and number for each side, split by the pier line
  - simultaneous Bay groups (e.g. two kids' lessons at 15:30 on 12/09, three groups at 18:30 on 14/09): one number per group, in a wrapping row under the time
- Block text is compact (11–12 px) so a reef block fits in about 90 px: time on the first line, chip and spots on the second.
- Today's column has a "now" line at the current minute with a light "עכשיו" tag. Today's finished blocks are grey.
- Clicking a day header opens that day's view. A legend under the grid explains the chip, the orange marker, "מלא", and that block height is session length.
- On narrow screens the grid scrolls sideways inside its box, hour column pinned, opening with today in view.

**Month:** from the Sunday of the current week through the week containing `publishedThrough`, plus one more week (6.9–3.10 on 10/09).
- Title names the month or months covered ("ספטמבר–אוקטובר 2026"). The first day of a new month shows as `1.10`.
- Each day cell shows the date, opening hours in full (`06:00–22:00`, hidden on phones), a strip of that day's reef levels in time order, and total spots left.
- Past days are dimmed (number only). Today is dark. Closed days show "סגור" and the reason. Days with no sessions show "אין סשנים". Days after `publishedThrough` have a dashed outline and "טרם פורסם".
- Clicking a day with sessions opens its day view.

**Day:** a list of sessions. Each row is led by the start time in large dark type (`16:00`) with the end time under it ("עד 17:00"; beside it on phones), then the level chip, session name (level prefix and "כולל גלשן סופט" suffix stripped into a small note), and a capacity bar plus spots left for each side (one bar for Bay).
- The header shows "היום" (for today), day name and date, the opening hours in full on their own line ("פתוח 06:00–22:00"), then total spots left. Previous/next buttons move within today through `publishedThrough`.
- For today, finished sessions are hidden behind a "הצגת N סשנים שכבר הסתיימו" button, so the list opens at what's happening now; the current session is highlighted with an "עכשיו" tag.

**Header:** title "לוח סשנים", subtitle "ריף ימין, ריף שמאל ו־Bay ב־SRF Park TLV", freshness ("עודכן לפני 12 דקות", "הלוח פורסם עד יום חמישי, 24.9"), the refresh button, the view switch, and the level filter chips (Bay, L1–L6).

**Level filter:** multi-select chips. With any selected, other levels are faded in all views. The selection is saved in `localStorage`.

## 7. Visual design

**Subject and principles:**
1. Today is deep water: the only dark element is today's column (or today's month cell).
2. Each color means one thing: level color = wave level; rescue orange = 1–3 spots left; grey/faded = full or over. Nothing decorative.
3. Every reef cell is split like the lagoon's central pier: right reef on the right, left reef on the left.
4. Numbers first: spots left are the highest-contrast text in each cell, in tabular figures.

**Palette:**

| Token | Hex | Use |
|---|---|---|
| Foam | `#F1F6F5` | Page background |
| Deck | `#FFFFFF` | Cards (month cells, day list) |
| Deep | `#0F2B35` | Text; today's column and cell |
| Deep 2 | `#244652` | Lines and block borders inside today's column |
| Deep 3 | `#17394A` | Session blocks inside today's column |
| Sand tint | `#FBF5E6` (border `#EBD9A8`) | Bay session blocks |
| Mist | `#5F7A83` | Secondary text |
| Mist 2 | `#9DB4BA` | Faded text, dashed outlines |
| Line | `#D8E3E2` | Hairlines, pier line |
| Rescue | `#FF5A1F` | Background of the 1–3 spots marker (text on it is Deep) |
| L1–L6 | `#91C36B` `#6F9B5C` `#487037` `#81ABCA` `#225A8C` `#8A71B2` | The park's own level colors |
| Bay | `#E2B860` | Sand, since the park gives Bay the same blue as L4 |

Chip text is Deep on Bay, L1, L2 and L4, and white on L3, L5 and L6 (for contrast).

**Type:** Secular One for dates and headings; IBM Plex Sans Hebrew (400/500/600) for everything else, with `font-variant-numeric: tabular-nums` on numbers. Both from Google Fonts, falling back to `system-ui`. Time ranges are wrapped in a left-to-right isolate so `06:00–07:00` never reverses inside Hebrew text.

**Quality floor:** visible keyboard focus, `prefers-reduced-motion` respected (the refresh icon's spin is the only animation), no horizontal page scroll at 375 px, text contrast of at least 4.5:1 for body text.

## 8. Refresh flow and errors on the page

### Refresh button

1. **No token saved:** open a panel explaining the one-time setup (section 10), with a link to GitHub's new-token page and a field to paste the token. Saved in `localStorage` under `srfsc.githubToken`.
2. **Start:** `POST /repos/AssafHaft/srfsc/actions/workflows/update.yml/dispatches` with `{ "ref": "main", "return_run_details": true }`.
   - `200` with `workflow_run_id` → follow that run.
   - `204` with no body (its default without `return_run_details: true`) → `GET .../actions/workflows/update.yml/runs?event=workflow_dispatch&per_page=5` and take the newest run created after the click (retry the lookup for up to 30 s).
3. **Wait:** poll `GET .../actions/runs/{id}` every 5 s. Button text: "ממתין בתור" while `queued`, "מעדכן…" plus elapsed time while `in_progress`. All GitHub API calls use `cache: "no-store"`, because GitHub API responses carry `max-age=60`.
4. **Success** (`completed` + `success`): fetch `GET .../contents/site/data/schedule.json?ref=main` with `Accept: application/vnd.github.raw+json`, re-render, show "עודכן עכשיו". Reading from the API matters: GitHub Pages' CDN caches files for 10 minutes and ignores `?t=` query strings (verified 2026-09-10).
5. **Outcomes:**

| Situation | Page shows |
|---|---|
| Run failed | "העדכון נכשל" + link to the run's log (`html_url`) |
| 10 minutes without completion | "העדכון עדיין רץ" + link to the run |
| `401` | Token expired or invalid: clear it, reopen the token panel |
| `403` / `404` | "לטוקן אין גישה" + which settings to check (repo access, Actions: Read and write, Contents: Read-only) |
| Network error | "אין חיבור ל־GitHub" + retry |

### Normal page load

Fetch `data/schedule.json` with `cache: "no-cache"`. If it fails, show "לא הצלחנו לטעון את הלוח" with a retry button.

### Stale data warning

Shown in the header when the data is stale. Stale means either:
- the current Israel time is between 07:00 and 23:30 and `fetchedAt` is more than 3 hours old, or
- `fetchedAt` is more than 12 hours old at any time.

This catches failing runs, a blocked scraper, and GitHub pausing the schedule.

### Safety

- All park text is escaped before it goes into HTML.
- The token is never committed and never sent anywhere except `api.github.com`.
- It sits in the browser storage for `https://assafhaft.github.io`, which every GitHub Pages site under the account shares. Accepted, because the token is limited to this repo, Actions (read/write) and Contents (read).

## 9. Testing

`node --test`, no dependencies. Tests also run as the first step of every workflow run.

**Scraper:**
- **Fixtures:** real park responses saved under `scraper/test/fixtures/`. Capture them early in implementation, while the 10–24/09/2026 windows are still live, because they contain the edge cases:
  - Bay rows
  - the Yom Kippur close day (21/09) and a day with nothing (20/09)
  - an hour where the right and left reefs run different sessions (10/09 20:00)
  - full sessions, and a `disabled` row if one can be found
- **`normalize`:** side rules including Bay pool numbers, spots left, level 0 for Bay, disabled means unavailable, open/close hours, closed and empty days, `publishedThrough`, sort order.
- **`fetchHorizon`** with a fake `fetch`: stops after 2 empty windows, caps at 12, retries then fails, a close-day-only window doesn't stop the walk.
- **`scrape`:** refuses to overwrite with zero sessions; skips invalid rows with a warning.
- **Dates:** Israel "today" around midnight and across the daylight-saving change; `DD/MM/YY` formatting.

**Page logic (`site/lib/*.mjs`):**
- Week and month ranges, including month boundaries.
- Right/left pairing and block grouping (same start, end and area).
- Week block layout:
  - full width when a block overlaps nothing
  - 64/36 reef/Bay split inside an overlapping cluster
  - side-by-side sub-lanes for same-area overlaps
  - blocks that only touch (one ends as the next starts) don't overlap
- Past and now detection, stale rule.
- **Refresh state machine** against a fake GitHub API:
  - `200` with a run id
  - `204` then run lookup
  - run failure
  - timeout
  - `401`
  - `403`/`404`

**Visual:** headless Edge screenshots of each view at 1280×1000 and at narrow width, plus a 375 px overflow check (page width equals viewport width in every view).

**Live check:** after the first deploy, run the workflow manually and confirm the runner can reach the park (see risks).

## 10. One-time setup (done by the owner)

1. Make the repo public: Settings → General → Danger Zone → Change visibility.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. After merging, run the workflow once from the Actions tab (or wait for the next hourly run).
4. For the refresh button, create a fine-grained token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories → srfsc**
   - Permissions: **Actions: Read and write**, **Contents: Read-only**
   - Expiry: your choice; the page asks for a new token when it expires.

   Paste it into the page the first time you press "עדכון עכשיו".

## 11. Risks

| Risk | Mitigation |
|---|---|
| The park's Cloudflare blocks GitHub's runner IPs (untested; requests from a home connection work) | Found in the live check. Fallback: run `node scraper/scrape.mjs` on the owner's PC with Windows Task Scheduler and push with git. The scraper is standalone, so nothing else changes |
| The park changes its API or field names | Tests catch our side. The scraper fails loudly instead of writing bad data. The stale warning shows on the page |
| GitHub pauses the schedule after 60 days | Data commits count as activity. The stale warning catches it if not |
| Scheduled runs are delayed by GitHub under load | Minute 17 avoids the busiest time. The refresh button covers urgent checks |
