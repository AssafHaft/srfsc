# SRF Park TLV one-time CMS import: design spec

Date: 2026-09-12. Builds on the analysis spec (`2026-09-11-schedule-analysis-design.md`) and on branch
`schedule-analysis`, which holds the history files and the analysis tab.

## 1. Goal

The park's management system (CMS) exported a "wave demand" report: one row per session side from
1.5.2025 to 10.9.2026 (17,912 rows). Merge it into our history once so the analysis is more accurate:

- public sessions take the park's own booked counts;
- bookings that never appear on the public schedule (camps, groups, events, private lessons, clubs,
  courses) are kept, by category, and analysed in their own section.

### Decisions made during brainstorming

- **One-off.** The export is imported once. There is no recurring import and no import UI.
- **Approach A.** Existing sections stay public-only, so periods before and after the export stay
  comparable. Hidden bookings get their own section, only for dates the export covers.
- **Categories only.** The repo and site are public. Hidden bookings are stored under one of 8
  category labels; no person's, child's or company's name is ever written. The owner approved that
  the resulting booking figures are public.

### Out of scope

Recurring imports; revenue for hidden bookings (no list price); levels or fill speed for hidden
bookings; private events that the public schedule already shows as blocked (they stay in the
operations section).

## 2. What the export holds

Columns (row 1, exact text): `תאריך`, `יום`, `שעה`, `איזור`, `שם`, `סוג`, `צד`, `מס' משתתפים מקסימלי`,
`מס' נרשמים`. One sheet, inline strings, no shared strings.

Findings against our history (run on 2026-09-12):

- **Hours only.** `שעה` is always a whole hour. A session starting at 14:30 appears at 15:00.
- **Different names.** The export often names a public session differently from the public site
  ("סשן L5" for "T-Time Mega Turns"), so names can't be the match key.
- **No cancellations.** The 648 sessions we hold as cancelled (capacity 0) show in the export with
  full capacity and 0 booked.
- **Unreliable levels.** `סוג` is empty on hidden bookings and often wrong on Bay rows (intro
  lessons are tagged "L4 - Advanced").
- **Pairing works by slot.** Pairing by date, area, side and hour pairs 14,564 of our 14,566 rows in
  the export's range. Booked counts agree on 13,326 of 13,659 counted public sessions; on the other
  333 the export is usually lower, 418 people in total.
- **Hidden bookings.** 3,348 export rows (18,325 bookings) pair with nothing we hold.

## 3. Hidden-booking categories

Shared by the import and the page, in `site/lib/history.mjs`:

```js
export const HIDDEN_CATEGORIES = [
  'קבוצות וארגונים', 'קייטנות', 'אירועים', 'שיעורים פרטיים',
  'חוגים', 'קורסי Bay', 'שימוש פנימי ושריונים', 'שיעורי Bay קבוצתיים',
];
```

The import picks a row's category from its original name, first match wins (case-insensitive):

| Order | Category | Name matches |
|---|---|---|
| 1 | שימוש פנימי ושריונים | `צוות\|מדריכ\|מציל\|שותפים\|תחזוק\|SRF(?! ?KAMP)\|בדיק\|צילומ\|שמור\|שמירת\|שריון\|חסום\|סגור` |
| 2 | קייטנות | `קייטנ\|CAMP\|KAMP\|Surf n.? ?Slice` |
| 3 | קורסי Bay | `קורס` |
| 4 | חוגים | `חוג` |
| 5 | אירועים | `אירוע\|יום הולדת\|מצו\|גיבוש\|כנס\|השקה\|event` |
| 6 | שיעורים פרטיים | `פרטי\|פרטית\|הדרכה\|זוגי` |
| 7 | שיעורי Bay קבוצתיים | `שיעור גלישה\|מפגש היכרות\|לימוד גלישה` |
| 8 | קבוצות וארגונים | anything else |

Measured shares of hidden bookings: groups 37%, camps 24%, events 18%, private 6%, clubs 6%,
courses 4%, internal 3%, Bay group lessons 2%.

## 4. The import

### 4.1 Files

- `scraper/cms.mjs`: pure logic. `readXlsx(buffer)` → rows of cell strings; `parseExport(rows)` →
  `{ rows, skipped }`; `categoryOf(name)`; `pairExport(store, exportRows)`; `mergeExport(store,
  exportRows)` → `{ store, summary }`.
- `scraper/import-cms.mjs`: CLI. `node scraper/import-cms.mjs <file.xlsx> [--dry-run]`. Reads the
  history months the export's dates span (`readMonths`), merges, prints the summary, and unless
  `--dry-run` writes the months (`writeMonths`) and `index.json` (`writeIndex`).
- `package.json`: script `import-cms`.
- `.gitignore`: `*.xlsx`.

### 4.2 Reading the .xlsx

No new dependency. `readXlsx` walks the zip's central directory, inflates entries with
`zlib.inflateRawSync` (method 8) or copies them (method 0), finds the first sheet listed in
`xl/workbook.xml` through `xl/_rels/workbook.xml.rels`, and reads its cells. It supports inline
strings (`t="inlineStr"`), shared strings (`t="s"`) and plain values, and places cells by their
column letters so empty cells stay empty.

### 4.3 Parsing and validation

- The header row must equal the 9 column names in §2 (trimmed); otherwise the import stops with a
  message naming the first mismatch.
- Each data row becomes `{ date, hour, area: 'reef' | 'bay', side: 'right' | 'left', name, level,
  capacity, booked }`:
  - `side` is `right` when `צד` contains `ימין`, `left` when it contains `שמאל`;
  - `level` is the digit after `L` in `סוג`, or null;
  - `capacity` and `booked` must be non-negative integers.
- A row with a bad date (not `YYYY-MM-DD`), hour (not `HH:MM`), area (`ריף` / `ביי`), side or number
  is skipped and counted by reason in the summary.

### 4.4 Pairing

- Our rows: every history row dated inside the export's first..last date.
- Slot: our start rounded up to the next whole hour when its minutes aren't 0 (14:30 → 15:00);
  the export's hour as is.
- Rows pair only inside the same date, area, side and slot. Each candidate pair gets a score:
  0 for the same name (trimmed, whitespace collapsed), 1 for the same level (reef only), 2 otherwise.
  Ties break on |capacity difference| + |booked difference|, then on row order. Pairs are taken
  greedily from the lowest score; each row pairs at most once.

### 4.5 Merging

- **Paired rows** take the export's `booked`. Everything else stays ours: id, times, level, kind
  (cancelled, blocked and removed included), capacity, kids, name, final, pace.
- **Unpaired export rows** become new rows:

  ```js
  { id: -n, date, start: hour, end: hour + 1h, level: 0, area, side,
    kids: isKids(originalName), name: categoryOf(originalName), kind: 'hidden',
    capacity, booked, final: true, pace: [] }
  ```

  `n` counts 1, 2, 3… over the unpaired rows in export order, so ids are stable and never clash with
  the park's positive ids. A 23:00 row ends at 23:59. The original name is used only for `kids` and `categoryOf` and is never
  stored.
- **Our unpaired rows** stay as they are.
- `index.json` gains `cms: { from, to, importedAt }` (the export's first and last date, and the
  import time).

### 4.6 Safety

- The import refuses to run when `index.json` already has `cms` ("already imported on …"), so hidden
  rows can't be duplicated.
- It writes nothing until every step has succeeded, and nothing at all with `--dry-run`.
- The summary lists: rows read, rows skipped by reason, pairs, booked changes (count and net people),
  our rows not in the export, hidden rows and bookings per category.

## 5. Keeping hidden rows through daily updates

In `scraper/history.mjs`:

- `applyFinal` never overwrites a `hidden` row and never marks one `removed`. Without this, the next
  run's final-count pass would mark 9.9 and 10.9 as removed.
- `finalFrom` ignores `hidden` rows when finding the last day with the park's final counts.
- `nextIndex` carries `prev.cms` forward unchanged.

`upsertUpcoming` and `finalizeStale` need no change: they match by the park's ids and hidden rows are
already final.

## 6. Analysis

### 6.1 Existing sections

- Definitions don't change. `isCounted` stays `surf` or `lesson`, so hidden rows never enter the
  KPIs, heatmap, levels, slots, trend, pace or operations.
- The KPI footnote's last sentence becomes: "התפוסה והמקומות כוללים רק את הלוח הציבורי, בלי סשנים
  שבוטלו. הזמנות שלא עברו בלוח מופיעות ב״מה לא בלוח הציבורי״."
- The coverage line in the operations section adds `· נתוני מערכת הניהול 1.5.2025–10.9.2026` (from
  `index.cms`) when present.

### 6.2 `hidden(rows, range, cms)` in `analytics.mjs`

- **Window:** the part of `range` inside `cms.from..cms.to`. No overlap, or no `cms`, gives
  `{ window: null }`.
- **Comparison window:** the window shifted back by the range's comparison offset
  (`daysBetween(range.compare.from, range.from)`: 364 days for last year, the period length for the
  previous period). It's used only when it starts on or after `cms.from`; otherwise there is no
  comparison.
- **Level filter:** it doesn't apply here.
- **Returned for the window** (and the same totals for the comparison window):
  - `people`: Σ booked of hidden rows; `sessions`: their count;
  - `share`: people ÷ (people + Σ booked of counted public rows in the window);
  - `reefShare`: hidden reef rows ÷ reef rows of kind surf, event, blocked or hidden in the window;
  - `categories`: one entry per category that occurs, sorted by people:
    `{ label, people, sessions, share, avgSize, bayShare, cmpPeople }` (`share` of the window's
    hidden people; `cmpPeople` null without a comparison);
  - `buckets`: people per week when the window is 92 days or less, else per calendar month (the
    trend section's rule);
  - `grid`: people per weekday × start hour, hours that occur only;
  - `partial`: true when the window is shorter than the range.
- `analyse()` adds `hidden: hidden(rows, range, index?.cms ?? null)` and `coverage.cms`.

### 6.3 The section: "מה לא בלוח הציבורי"

Placed after "מה נמכר" (id `a-hidden`); `LINKS.hidden = 'לפעילות הסגורה'`.

- **Subtitle:** "הזמנות שלא הופיעו בלוח הציבורי: קבוצות, קייטנות, אירועים, פרטיים וחוגים. לפי ייצוא
  מערכת הניהול, 1.5.2025–10.9.2026. סינון הרמות לא חל כאן." When `partial`, it adds "בתקופה שנבחרה
  הנתונים מכסים רק את <window dates>."
- **Empty state (no window):** "אין נתוני מערכת ניהול לתקופה הזו – הייצוא מכסה 1.5.2025–10.9.2026.
  בחרו 12 חודשים או הכול."
- **Tiles:**
  - "הזמנות סגורות": people, change in %;
  - "חלק מכל ההזמנות": share, change in points;
  - "משבצות ריף שלא היו למכירה": reefShare, change in points.
  
  Changes use the KPI `delta()` style against the comparison window, or "אין נתון להשוואה".
- **Table:** קטגוריה, הזמנות, חלק, סשנים, ממוצע לסשן, ב־Bay, שינוי (people change %). It scrolls
  inside `.tbl-scroll` on phones.
- **Over time:** an SVG bar chart of `buckets`, time right to left like the trend chart, no
  comparison line.
- **When:** a weekday × hour grid in the heatmap's style. Cells show people, with steps relative to
  the busiest cell; empty cells stay blank.
- Category labels are constants, but they go through `escapeHtml` like any stored name.

### 6.4 Insight

Rule `hidden-share` in `insights.mjs`:

- **Fires when:** the window exists, hidden sessions ≥ 20 (`MIN_SESSIONS`) and share ≥ 10%.
- **Text:** "X% מההזמנות בתקופה לא עברו בלוח הציבורי, בעיקר <top label> (<top share>%)."
- **Other fields:** tone `info`, link `hidden`, impact null.

## 7. Errors

- The import stops on a bad header, a missing file, an unreadable zip or a second run, and writes
  nothing in those cases.
- Bad rows are skipped and reported.
- On the page, a missing `index.cms` means no hidden data: the section shows its empty state.

## 8. Testing

- **`scraper/test/cms.test.mjs`:**
  - `readXlsx` on a small .xlsx the test builds in memory (a stored and a deflated entry, inline and
    shared strings, an empty cell);
  - `parseExport` header check and row validation;
  - `categoryOf`, one case per category plus rule order (`שמור ל SRF KAMP` is internal);
  - pairing: the same name wins over the same level, 14:30 pairs with 15:00, the level fallback,
    closest counts, one pair per row;
  - merging: paired rows keep everything but booked; unpaired rows become hidden with negative ids,
    `level` 0 and a one-hour end;
  - every hidden row's name is one of `HIDDEN_CATEGORIES`, and no original name survives.
- **`scraper/test/import-cms.test.mjs`:**
  - a temp history dir: it writes the months and `index.cms`;
  - `--dry-run` writes nothing;
  - a second run is refused.
- **`scraper/test/history.test.mjs`:** `applyFinal` leaves hidden rows alone, `finalFrom` ignores
  them, and `nextIndex` keeps `cms`.
- **`test/site/analytics.test.mjs`:** `hidden()` with a full, partial and missing overlap; the
  comparison shift and its absence when outside coverage; share, reefShare, categories, buckets and
  grid.
- **`test/site/insights.test.mjs`:** `hidden-share` at its 10% and 20-session thresholds.
- **`test/site/render-analysis.test.mjs`:** the section's empty and partial states, and the
  coverage line.
- **Browser (controller):** the tab at 1280px and 375px, no console errors, nothing overflowing.

## 9. Rollout

1. Implement on `schedule-analysis`, reviewed task by task.
2. Dry-run on the owner's file. Expected results: about 14,564 pairs, 333 booked changes on counted
   public sessions (−418 people), 3,348 hidden rows (18,325 bookings). A large difference stops the
   rollout for investigation.
3. Run it for real, then check that no export name that the public schedule never published appears
   anywhere under `site/data`.
4. Commit the data on its own. The README documents the one-time import and that it refuses to run
   again.

## 10. Risks

- **Category heuristics** will mislabel a few rows, for example a group named after a person lands in
  groups. Acceptable at category level.
- **End times are approximate** (start + 1 hour) for hidden rows. Only the start hour is used.
- **The export's counts are trusted** over the public API's where they differ (333 sessions, 0.3% of
  people), since the park's own system produced them.
- **Hidden bookings stop at 10.9.2026.** Periods after that show the section's empty state. The
  headline numbers are unaffected by design.
