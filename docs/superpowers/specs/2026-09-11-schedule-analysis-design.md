# SRF Park TLV schedule analysis: design spec

**Date:** 2026-09-11
**Status:** Approved in brainstorming, pending spec review
**Builds on:** [2026-09-10-surf-schedule-design.md](2026-09-10-surf-schedule-design.md) (the schedule board, live since PR #1)
**Visual reference:** [assets/2026-09-11-schedule-analysis-mockup.html](assets/2026-09-11-schedule-analysis-mockup.html) (self-contained; real park data for the 90 days 13.6–10.9.2026 against the same weeks of 2025, upcoming sessions as published on 11.9.2026 20:38; static except the heatmap metric switch)

## 1. Goal

A dedicated **analysis tab** that turns the park's schedule into business answers: how full the park runs, which sessions and hours sell and which don't, how demand changes over time, how fast sessions fill, and what needs attention in the next two days. It leads with plain-language conclusions and shows the evidence under them. It updates every time the data refreshes.

To make that possible, the project starts **keeping history**: the final result of every session since the park opened (backfilled from the park), and from now on, snapshots of how bookings build up before each session.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Audience | Park side (business): occupancy, strong and weak slots, sell-out speed, schedule mix |
| Revenue | Estimated at list price from an editable price table, always labeled "estimate at list price" |
| Architecture | Approach A: the scraper keeps monthly history files; the page computes the analysis in the browser |
| History depth | Everything the park still serves: from 2.4.2025 (its first sessions), backfilled once |
| Placement | A top-level tab "ניתוח" next to "לוח", at `#analysis` |
| Default period | Last 90 days, compared with the same weeks last year |
| Snapshot frequency | Cron at :17 and :47; optional free external trigger documented, no code |

### Out of scope

Per-booking data (the park doesn't expose who booked or when, only counts), realized prices from packs and memberships, weather, exports/CSV, alerts, forecasting models, English UI. The schedule tab is unchanged apart from one small fix (section 4.5).

## 2. What the park's data can and can't tell

Found by probing the API (same endpoint as the schedule spec, section 2) on 2026-09-11:

- **Past dates work.** `from_date` in the past returns that 3-day window with booked counts. For 10.9.2026, all 33 rows matched our own snapshot taken after the day's sessions, so a past window gives **final** counts.
- **History starts 2.4.2025.** Windows before that are empty. 2.4.2025–10.9.2026 is about 181 windows and 15,200 rows.
- **Booking times are not exposed.** How fast a session fills can only come from our own repeated snapshots, so that part of the analysis builds up from now on.
- **Rows that must not count as normal sessions** (numbers are for 2.4.2025–10.9.2026):

| Pattern | Rows | Meaning |
|---|---|---|
| Capacity 0 on the row's side | 663 | Session not offered (mostly the June 2025 soft opening and March 2026 closures) |
| `disabled` true | 241 | Blocked, mostly private events ("Special Private Event", "אירוע סגור") |
| `wave_level` 7 | 26 | Internal special events ("L7 - Air Section") |
| Booked above capacity | 274 | Overbooking, usually after a capacity cut |

- **Names are messy:** 183 distinct names for surf and lesson rows ("סשן L5", "T-Time Mega Turns - Advanced", …). Grouping uses the level, never the name.
- **Bay age group:** the park's `age_group` field says "all" on most kids' groups, so kids vs adults comes from the name: `ילדים` or `גילאי` means kids.
- **Closures:** `close_days` carries the reason (maintenance, "לאור הנחיית פיקוד העורף", breakdowns, holidays). 19 closed days so far.

## 3. Core definitions

Used everywhere (scraper, analysis, page):

- **Session:** one scheduler row, meaning one side of one time slot. Reef right and reef left count separately, and each Bay group counts separately. This matches the park's own model and the schedule file.
- **Kind:**

| Kind | Rule (first match wins) |
|---|---|
| `cancelled` | capacity is 0 |
| `blocked` | the park's `disabled` flag is set |
| `event` | level 7 |
| `lesson` | Bay |
| `surf` | reef, levels 1–6 |
| `removed` | set by the history update: the session was in our snapshots but the park's past data no longer has it |

- **Counted sessions:** kind `surf` or `lesson`, dated yesterday or earlier. Only these enter occupancy, spots sold, revenue and sell-out numbers.
- **Level key:** `bay-adult`, `bay-kids`, `L1`…`L6`. The level filter chip "Bay" selects both Bay keys.
- **Spots sold** = Σ min(booked, capacity). **Occupancy** = spots sold ÷ Σ capacity.
- **Sold out:** booked ≥ capacity. **Sell-out share** = sold-out sessions ÷ sessions.
- **Price** (from `site/config.js`, applied at view time so a price edit re-prices all history): reef L1–L4 ₪360, reef L5–L6 ₪390, Bay adults ₪250, Bay kids ₪195. Source: the park's single-session list prices on 11.9.2026.
- **Estimated revenue** = Σ booked × price (actual people, overbooking included). **Empty-spot value** = Σ max(0, capacity − booked) × price.
- **Day open:** a date with at least one counted session. **Closed day:** a date with a `close_days` entry.

## 4. History data

### 4.1 Files

`site/data/history/YYYY-MM.json`, one per calendar month of the session date:

```json
{
  "month": "2026-09",
  "names": ["L6 - Ocean T (T3)", "L4 – Advanced (T1 Only)"],
  "closed": [{ "date": "2026-09-21", "text": "יום כיפור" }],
  "sessions": [
    {"id":37315,"date":"2026-09-11","start":"06:00","end":"07:00","level":6,"area":"reef","side":"right","kids":false,"name":0,"kind":"surf","capacity":12,"booked":8,"final":true,"pace":[[20160,0],[4312,3],[610,7],[95,8]]}
  ]
}
```

- `name` is an index into `names`.
- `final`: `true` once the count came from the park's past data; `"snapshot"` if the park's past data never arrived and the last snapshot was taken as final (section 4.3); `false` while the session is upcoming.
- `pace`: `[minutes before start, booked]` pairs, oldest first, appended only when the booked count differs from the last entry. The first entry is the first time we saw the session. Empty for backfilled sessions.
- Sessions sorted by date, start, area, side, id. **One session per line** (the file is written by hand-formatting, not `JSON.stringify(…, 2)`), so each run's git diff shows only the sessions that changed.
- Size: about 1,100 sessions and 200 KB per busy month (about 25 KB compressed).

`site/data/history/index.json`:

```json
{ "updatedAt": "2026-09-11T20:47:05+03:00", "first": "2025-04-02", "months": ["2025-04", "…", "2026-09"], "snapshots": 412, "snapshotsSince": "2026-09-12" }
```

`snapshots` counts successful history updates since collection started, and `snapshotsSince` is the date of the first one.

### 4.2 `schedule.json` change

`normalizeRow` adds `"blocked": true|false` to every session (the park's `disabled` flag). Today a disabled session is indistinguishable from a full one. The schedule views ignore the new field.

### 4.3 Each history update

`scraper/update-history.mjs` runs after every successful scrape:

1. **Upcoming:** for every session in the fresh `schedule.json`, upsert its row by id in its month file. Copy the latest fields (a session can change level, capacity or name) and recompute `kind`. Append a pace entry if booked changed or the row is new. Minutes before start = start time (Israel local) − `fetchedAt`, rounded to the minute.
2. **Final counts:** fetch the past windows from the day after the last day that has the park's final counts — at least the last 3 days (today − 3), at most 30 days back — one 3-day window at a time; normally that is one window. For each of its rows, set capacity, booked, kind and `final: true`. Rows we hold for those dates that the window lacks become `kind: "removed"`. Merge its close days into `closed`. If this fetch fails, skip this step, log a warning, and keep going.
3. **Fallback:** any row dated before today − 3 that still isn't final gets `final: "snapshot"` with its last known numbers. This covers the park no longer serving past data.
4. Write the changed month files and `index.json`, with `snapshots` + 1.

Politeness: one extra request per run (about 36 more a day at the new cron). A run after a gap (the time between the backfill and the first run, or an outage) makes one request per missed 3 days.

### 4.4 Backfill

`scraper/backfill.mjs` (`npm run backfill`): fetch every 3-day window from 1.4.2025 to yesterday with `fetchWindow` (retries included), pausing 1.5 s between requests (about 5 minutes). Write rows as `final: true` with empty `pace`. It is idempotent and merges into existing files without touching existing `pace` arrays. Run once during implementation and commit the result. Sanity check against this spec's exploration: 14,283 counted sessions and 70% occupancy for 2.4.2025–10.9.2026.

### 4.5 Related fix

Level 7 sessions reach the schedule views with a chip that has no color class. Give `.lv7` the Mist background with white text. The chip text stays "L7".

## 5. Scraper and workflow

| File | Change |
|---|---|
| `scraper/normalize.mjs` | Add `blocked` (4.2) |
| `scraper/history.mjs` | **New.** Pure logic: `classify`, `isKids`, `upsertUpcoming`, `applyFinal`, `finalizeStale`, `formatMonth` (one-line-per-session writer), `indexFor` |
| `scraper/update-history.mjs` | **New.** CLI for 4.3: reads `schedule.json` and the month files, fetches the past window, writes files |
| `scraper/backfill.mjs` | **New.** CLI for 4.4 |
| `package.json` | Scripts `backfill`, `update-history`, and `update` (= scrape then update-history, for the local fallback) |
| `.github/workflows/update.yml` | See below |
| `README.md` | History, backfill, and an optional external trigger |

**Workflow:**
- Cron becomes `'17,47 3-20 * * *'`. GitHub dropped most hourly runs on 11.9 (2 of about 10 fired), so twice an hour aims for roughly one run an hour after drops.
- The scrape step gets `id: scrape`.
- A new step "Update history" runs `node scraper/update-history.mjs` with `if: steps.scrape.outcome == 'success' && vars.SCRAPE_IN_ACTIONS != 'false'` and `continue-on-error: true`. A history failure never blocks the schedule commit or the deploy.
- The commit step checks and adds `site/data/` instead of just `schedule.json`. The message stays `data: update schedule`.

**Optional reliable trigger (README only):** a free cron service such as cron-job.org can call the same `workflow_dispatch` endpoint the refresh button uses, every 30 minutes. It needs a fine-grained token with Actions: Read and write on this repo only.

## 6. Analysis logic (`site/lib/`)

| File | Responsibility |
|---|---|
| `site/lib/history.mjs` | Which month files a date range needs; merging loaded months; period presets and the comparison range |
| `site/lib/analytics.mjs` | Pure functions over session rows: aggregate, KPIs, heatmap, level table, slot ranking, trend, pace, upcoming and at-risk, operations |
| `site/lib/insights.mjs` | The rules in 6.9, returning `{ rule, tone, impact, text, link }` |
| `site/lib/render-analysis.mjs` | HTML and SVG for each section. All park text escaped |

### 6.1 Period and comparison

- Presets: 30 days, **90 days** (default), 12 months (365 days), all. Every period ends **yesterday**, since today's sessions aren't final.
- Comparison: the same range shifted back **364 days** (weekday-aligned) if history covers it; otherwise the previous range of equal length if history covers that; otherwise none. "All" has no comparison. The page names the comparison range under the filters.
- The level filter (shared with the schedule tab) applies to every section. The period is saved in `localStorage` as `srfsc.period`.

### 6.2 The big picture (KPIs)

Six tiles: occupancy (dark, the lead tile), spots sold, estimated revenue, sell-out share, empty-spot value, days open. The last tile also shows closed days and total capacity.
- Each tile shows the change against the comparison: **points** for ratios ("▼ 8 נק׳"), **percent** for amounts ("▲ 1%"), then the comparison value.
- A change in the bad direction is colored Rescue ink. For empty-spot value, up is bad.

### 6.3 Heatmap

Start hour (rows) × weekday (columns, Sunday first on the right). Metric switch: occupancy, sell-out share, revenue. Cells with fewer than 4 sessions are empty dashed boxes. Six color steps:
- occupancy: 40 / 55 / 70 / 85 / 95%
- sell-out share: 10 / 25 / 40 / 60 / 80%
- revenue: 20 / 40 / 60 / 80 / 95% of the largest cell

Hovering or tapping a cell shows day, hour, session count, occupancy and sell-out share.

### 6.4 Level table

One row per level key: sessions, occupancy bar with last year's value as a tick, change in points, sell-out share, revenue with its share, and a supply-against-demand pair of bars (the level's share of all capacity against its share of all spots sold).

### 6.5 Strongest and weakest recurring slots

A slot is weekday + start + level key, and needs at least **4 distinct dates** in the period. Slots are ranked by occupancy, then sell-out share. The page shows the top 10 and the bottom 10; if fewer than 20 slots qualify, the lists don't repeat a slot. Each row shows "מלא ב־N%" when its sell-out share is 50% or more, and otherwise its empty-spot value.

### 6.6 Trend

Weekly buckets for periods up to 92 days, monthly above that. Bars show this period's occupancy (or revenue, by switch). An orange line shows the comparison buckets (weekly: −364 days; monthly: same month last year). Weeks containing closed days get a dashed mark under the bar. Time runs **right to left**, like the week view.

### 6.7 Fill speed (pace)

Uses final sessions that have pace entries.
- **Ready** when at least 30 such sessions have a first entry at least 7 days (10,080 minutes) before their start.
- **Before that,** the section shows a "collecting" card: the snapshot count, what will appear, and the expected date (first snapshot + 14 days). The mockup also shows a clearly labeled illustrative curve.
- **Booked at lead L** = the booked value of the last pace entry whose minutes-before is at least L. A session without such an entry is left out of that point.
- **Fill curve:** mean of booked ÷ capacity at leads 14, 10, 7, 5, 3, 2, 1, 0 days, per level key, and for weekdays against weekends.
- **Sell-out lead:** the minutes-before of the first entry with booked ≥ capacity. Show the median in days per level key, over sessions that sold out.
- **Last-24h share** = Σ(final booked − booked at 24 h) ÷ Σ final booked, over sessions with an entry at 24 h or more.
- **Released by cancellations** = Σ decreases between consecutive entries, plus the drop from the last entry to the final count if it's lower.

### 6.8 Coming up and operations

**Coming up** (from `schedule.json`, so it works from day one):
- Booked share per day from today through `publishedThrough`, counted kinds only. Today's finished sessions are excluded.
- **At-risk sessions:** sides starting within the next 48 hours with occupancy below 40%, grouped by date + start + level key and sorted by time. Show 7, then "ועוד N".
- Once pace is ready, each day also shows ahead or behind the usual fill at its lead time, in points, from the weekday or weekend curve.

**Operations** for the period:
- closed days with the park's reasons;
- blocked sessions with their most common names;
- cancelled and removed sessions;
- overbooked sides and the extra people;
- a coverage line: history start, counted sessions, snapshots since.

### 6.9 Insights ("מה בולט")

Each rule fires only under its condition. Fired insights are sorted by impact in ₪ (largest first), followed by the rules with no ₪ value, and at most 6 are shown. Every insight links to its section. Average price = period revenue ÷ period booked.

| Rule | Fires when | Impact | Example text (from the mockup data) |
|---|---|---|---|
| `trend` | \|Δ occupancy\| ≥ 3 points and the comparison has ≥ 100 sessions | \|Δ occupancy\| × capacity × average price | "התפוסה ירדה ב־8 נקודות מאשתקד, מ־76% ל־68%. ההיצע גדל ב־12% וההזמנות כמעט לא השתנו." (the second sentence appears when capacity and bookings changed ≥ 5 points apart) |
| `level-drop` | Levels down ≥ 10 points, ≥ 20 sessions in both periods (up to 2, one insight) | Σ \|Δ revenue\| | "הירידות הגדולות מאשתקד: L3 מ־80% ל־60%, L4 מ־88% ל־71%." |
| `level-gain` | Same, up ≥ 10 points | Σ \|Δ revenue\| | "עלייה מאשתקד: Bay מבוגרים מ־49% ל־61%." |
| `weekend` | Friday–Saturday occupancy ≥ weekday occupancy + 10 points | gap × weekday capacity × average price | "שישי־שבת מלאים ב־82%, ימי חול ב־63%. אם ימי החול היו מתמלאים כמו סוף השבוע, זה ₪2,520,792 נוספים." |
| `undersupply` | A level key sells out in ≥ 35% of ≥ 20 sessions | level revenue × sell-out share | "Bay ילדים נמכר עד המקום האחרון ב־37% מהסשנים: הביקוש גבוה מההיצע, כדאי לשקול עוד סשנים." |
| `weak-level` | A level key below 50% occupancy over ≥ 20 sessions | its empty-spot value | Template (didn't fire on the mockup data): "{level} מתמלא רק ב־{occupancy}%: {empty-spot value} במקומות ריקים בתקופה." |
| `weak-hours` | Sunday–Thursday heatmap cells below 50% with ≥ 10 sessions; the 3 with the largest empty-spot value | Σ their empty-spot value | "השעות החלשות: ב׳ 09:00 (34%), ד׳ 09:00 (40%), א׳ 09:00 (40%). יחד ₪317,710 במקומות ריקים." |
| `at-risk` | At least one at-risk session (6.8) | Σ their empty-spot value | "17 סשנים ב־48 השעות הקרובות מלאים בפחות מ־40%: ₪114,830 פתוחים למכירה." |
| `early-sellout` | Pace ready; a level key's median sell-out lead ≥ 3 days | none | Template: "{level} נמכר עד הסוף בדרך כלל {days} ימים מראש." |
| `late-demand` | Pace ready; last-24h share ≥ 40% | none | Template: "{share}% מההזמנות מגיעות ב־24 השעות האחרונות." |

Tone: `trend` and level movers follow the direction. `weekend` is neutral. `undersupply` and `early-sellout` are good (demand). `weak-*` and `at-risk` are bad.

## 7. The page

- **Tabs:** under the header, "לוח" and "ניתוח" (Secular One, 20 px, deep underline on the active tab). `#analysis` opens the analysis tab. `#day`, `#week` and `#month` open the schedule as before, and no hash keeps today's default.
- **Controls:** the schedule tab keeps its view switch. The analysis tab shows the period switch instead, beside the same level chips, and the comparison line under them.
- **Section order:**

| # | Section | Anchor |
|---|---|---|
| 1 | KPIs | `kpis` |
| 2 | What stands out | `insights` |
| 3 | When it's busy | `heat` |
| 4 | What sells | `levels` |
| 5 | Strongest and weakest slots | `slots` |
| 6 | Trend | `trend` |
| 7 | Fill speed | `pace` |
| 8 | Coming up | `upcoming` |
| 9 | Operations and coverage | `ops` |

- **Visual:** the schedule spec's palette and type (its section 7), plus:

| Token | Hex | Use |
|---|---|---|
| Rescue ink | `#B23A0C` | Text for changes in the bad direction (Rescue itself is too light for text) |
| Heat 0–5 | `#EEF3F2` `#D3E3E3` `#A8C6CA` `#6F9AA4` `#3B6B79` `#0F2B35` | Heatmap steps; white text from step 3 up |

  In this tab, orange means one thing: **compare against this**. That covers bad-direction changes, last year's line in the trend, and last year's tick on occupancy bars. Insight cards carry a 4 px start border: orange for bad, deep for good, line color for neutral.
- **Charts:** hand-made SVG and CSS grid, no library. SVG text is `direction: ltr` (under the page's RTL, text anchors otherwise flip and collide with bars). Money shows as `₪12.6M`, `₪318K` or `₪8,500`, in a left-to-right isolate.
- **Phones (≤ 720 px):** KPIs in 2 columns. Insights, slot lists, pace and coming up in one column. The heatmap fits 7 columns at 375 px. The level table scrolls sideways inside its card. The page never scrolls sideways (verified on the mockup at 375 px).
- **States:** "טוען היסטוריה…" while loading. Each section with too little data says so ("אין מספיק נתונים בתקופה") rather than drawing empty charts.

## 8. Loading and refresh

- **First open of the tab:** fetch `data/history/index.json` (`cache: "no-cache"`), then the month files the period and its comparison need, in parallel. They stay cached in memory, and changing the period fetches only the missing months. "All" loads every month (about 3 MB, about 400 KB compressed).
- **After "עדכון עכשיו" succeeds:** besides `schedule.json`, `refresh()` also fetches `site/data/history/index.json` and the month files covering today − 3 … yesterday (one or two files) through the contents API with `Accept: application/vnd.github.raw+json`. This bypasses the Pages CDN, as the schedule already does. These replace the cached copies, and the active tab re-renders.
- `refresh()` takes an optional list of extra paths and returns their parsed contents next to the schedule.

## 9. Errors

| Situation | Behavior |
|---|---|
| History files fail to load | The analysis tab shows "לא הצלחנו לטעון את ההיסטוריה" with a retry. The schedule tab is unaffected |
| Refresh succeeded but its history fetch failed | Keep the cached history. Note "הלוח עודכן, הניתוח לא" |
| Too little data for a section or rule | The section says so. Rules don't fire |
| History update fails in Actions | The step is marked failed with `continue-on-error`. Schedule commit and deploy go ahead. The next run catches up (upcoming rows) and the fallback finalizes old rows (4.3) |
| Past-window fetch fails | Skip finalization this run, warn |
| Unexpected park rows | Skipped with a warning, as in the scraper today |

## 10. Testing

`node --test`, no dependencies, run in every workflow run.

**Scraper:**
- `classify` on real fixture rows: capacity 0, the disabled row 38905, the overbooked row 37616, level 7, and Bay kids/adults by name.
- `upsertUpcoming`:
  - new row
  - changed booked (appends pace)
  - unchanged booked (no entry)
  - a field change (level, capacity) updates the row and its kind
  - minutes-before computed in Israel time across a DST change
- `applyFinal`: final counts, `removed` for rows missing from the window, close-day merge.
- `finalizeStale`: rows older than today − 3 become `final: "snapshot"`.
- `formatMonth`: one session per line, stable order, parses back to the same object.
- Backfill merge keeps existing `pace`.
- `blocked` in `normalizeRow`.

**Analysis:** small hand-built histories with known answers for:
- aggregates, including overbooking capped for occupancy but not for revenue;
- period and comparison ranges, including history too short for last year;
- heatmap threshold of 4 sessions;
- slot minimum of 4 dates and no repeats;
- weekly or monthly trend switch at 92 days;
- pace readiness, booked at lead, sell-out lead, last-24h share, cancellations;
- at-risk grouping and the 48 h and 40% thresholds;
- each insight rule firing and not firing at its threshold, and sorting by impact with the no-₪ rules last.

**Refresh:** the fake GitHub API returns the extra paths, and a failed history fetch after a successful run is reported without failing the refresh.

**Data check:** after the backfill, 14,283 counted sessions and 70% occupancy for 2.4.2025–10.9.2026 (section 4.4).

**Visual:** at 1280 px and 375 px in the browser: no page-wide horizontal scroll, no clipped KPI, slot or at-risk rows, chart labels clear of bars, and the console clean.

## 11. Rollout

- The backfill commit adds about 3 MB of JSON once. Later commits touch only changed lines.
- No new owner setup. The optional external trigger (section 5) is the one step for reliable half-hourly snapshots.
- Fill-speed charts appear about 14 days after the first snapshot. Everything else works from the first deploy.

## 12. Risks

| Risk | Mitigation |
|---|---|
| The park stops serving past dates | Snapshots still record every upcoming session. Rows older than 3 days are finalized from their last snapshot (`final: "snapshot"`) |
| GitHub keeps dropping cron runs | Twice-hourly cron, the button, and the optional external trigger. The pace section reports its snapshot count |
| List prices change or packs dominate | Prices live in `config.js` and re-price all history. Every revenue figure says "estimate at list price" |
| Repo growth from frequent data commits | One line per session keeps diffs small. About 3 MB of history once, then small deltas |
| A park rename or a new session type | Grouping uses level, area and the kids rule, never names. Unknown shapes are skipped with warnings |
