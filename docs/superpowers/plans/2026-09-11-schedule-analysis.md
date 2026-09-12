# SRF Park TLV Schedule Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a history of every SRF Park TLV session (backfilled since 2.4.2025, then snapshotted on every run) and add an "ניתוח" tab that turns it into business conclusions: occupancy, strong and weak slots, trends, fill speed, sessions at risk, and operations.

**Architecture:** The scraper gains a history step: after each scrape, `scraper/update-history.mjs` upserts the fresh schedule into monthly files `site/data/history/YYYY-MM.json` (one session per line, with a booking-pace log) and takes the park's final counts for the last 3 days; a one-time `scraper/backfill.mjs` imports the park's past. The page loads those files lazily when the analysis tab opens and computes everything in the browser with pure, tested modules (`site/lib/analytics.mjs`, `insights.mjs`, `render-analysis.mjs`); the refresh button also re-reads the history files it changed.

**Tech Stack:** Node 20+ (Node 22 on Actions), ES modules, `node:test`, no npm packages; HTML/CSS/vanilla JS with hand-drawn SVG; GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-09-11-schedule-analysis-design.md](../specs/2026-09-11-schedule-analysis-design.md) (visual reference: [the mockup](../specs/assets/2026-09-11-schedule-analysis-mockup.html)). It builds on [the schedule spec](../specs/2026-09-10-surf-schedule-design.md). Read the analysis spec and the mockup before starting.

## Global Constraints

- **No dependencies.** No `npm install`, no `node_modules`. Node built-ins and browser APIs only.
- **Node:** `engines.node >= 20`; the workflow uses Node `22`. Everything is ES modules.
- **Tests:** run with `node --test` (it finds `**/test/**/*.mjs` and `*.test.mjs`). Never pass a directory to `node --test`; to run one file: `node --test path/to/file.test.mjs`. Page-logic tests live in `test/site/`, scraper tests in `scraper/test/`, shared scraper test helpers in `scraper/test-support/`.
- **Time zone:** every "today", "now" and date calculation uses `Asia/Jerusalem` through `site/lib/time.mjs`.
- **Park API:** `GET https://www.srfparktlv.co.il/products/sessions-react/?ajax=1&from_date=DD/MM/YY` with `X-Requested-With: XMLHttpRequest` (already wrapped by `fetchWindow` in `scraper/fetch.mjs`). Past dates return final counts.
- **History file format:** exactly as the spec's section 4.1: `{ month, names, closed, sessions }`, `name` as an index into `names`, sessions sorted by date, start, area, side, id, **one session per line**, trailing newline. `index.json` is 2-space JSON with a trailing newline.
- **Kinds and counting:** `cancelled` (capacity 0) → `blocked` (disabled) → `event` (level 7) → `lesson` (Bay) → `surf`; `removed` is set only by the history update. Only `surf` and `lesson` count towards occupancy, spots sold, revenue and sell-out numbers. Occupancy caps booked at capacity; revenue counts every booked person.
- **Prices:** reef L1–L4 ₪360, reef L5–L6 ₪390, Bay adults ₪250, Bay kids ₪195, in `site/config.js` as `PRICES = { reef, reefHigh, bayAdult, bayKids }`. Every revenue figure is labelled as an estimate at list price.
- **Language:** Hebrew, right-to-left. Copy the Hebrew strings exactly as given in this plan's code.
- **Security:** park text (session names, closure reasons, blocked-event names) is always escaped with `escapeHtml` before it goes into HTML.
- **Fixtures:** `scraper/test/fixtures/window-2026-09-*.json` are real park responses; don't edit or re-capture them. Tests assert values from them (for example the disabled row 38905 and the overbooked Bay row 37616).
- **Line endings:** a Windows checkout may have CRLF line endings; keep whatever an existing file uses.
- **Shell:** commands are shown one per line and work in Git Bash and PowerShell.

## Refinements to the spec

These came out of building and testing a scratch copy of this plan; none changes behaviour the user approved.

- `site/lib/history.mjs` holds the rules the scraper and the page share: `classify`, `isKids`, `expandMonth`, plus the page's `periodRange` and `monthsNeeded`. The scraper imports it from `site/lib/`, as it already does `time.mjs`.
- `site/lib/time.mjs` gains `monthsBetween(from, to)` and `israelInstant(date, hhmm)` (Israel wall-clock → epoch ms, correct next to DST changes); the pace log's "minutes before start" uses the latter.
- The coverage line under operations shows the sessions **in the selected period** (the page loads only the months a period needs, so an all-time count would be wrong for every period except "all").
- `refresh()` resolves with `{ schedule, extras }`; each extra is the parsed file or `null` if that file couldn't be read.
- "Jump to section" links in the insight cards are buttons (`data-jump`), because the URL hash already selects the tab and the view. The at-risk list's "ועוד N סשנים" is a native `<details>`.
- The KPI footnote's prices come from `PRICES`, so editing `config.js` keeps the text true.
- The workflow's commit step also looks for untracked files under `site/data/` (a new month's history file is untracked until committed).
- When pace data is ready, the fill-speed section shows the per-level curves (level colours) next to a list of facts; the mockup's illustrative curve is not shipped.
- A heatmap cell's details (day, hour, session count, occupancy, sell-out share) are in its tooltip, so they show on hover; on a touch screen the cell's own number is what you see (spec 6.3 said "hovering or tapping").

## File map

| File | Responsibility | Task |
|---|---|---|
| `scraper/normalize.mjs` | Adds `blocked` to each session | 1 |
| `site/lib/time.mjs` | Adds `monthsBetween`, `israelInstant` | 1 |
| `site/lib/history.mjs` | Shared rules: kinds, kids groups, month expansion, period ranges | 2 |
| `scraper/history.mjs` | History store logic: rows, pace log, final counts, file format, index | 3 |
| `scraper/update-history.mjs` | CLI after each scrape; file IO shared with the backfill | 4 |
| `.github/workflows/update.yml` | Twice-hourly cron, "Update history" step, commit `site/data/` | 4 |
| `scraper/backfill.mjs` | One-time import of the park's past | 5 |
| `site/data/history/*.json` | The history (generated by the backfill, then by every run) | 5 |
| `site/lib/analytics.mjs` | Every number the tab shows | 6 |
| `site/lib/insights.mjs` | "מה בולט" rules | 7 |
| `site/lib/render-analysis.mjs` | HTML and SVG for the tab | 8 |
| `site/lib/refresh.mjs` | Refresh also reads extra repo files | 9 |
| `site/config.js`, `site/index.html`, `site/app.js`, `site/styles.css` | Tabs, period switch, lazy history loading, styles | 10 |
| `package.json`, `README.md` | Scripts and docs | 4, 5, 10 |

---

### Task 1: `blocked` flag, L7 chip colour, and two date helpers

**Files:**
- Modify: `scraper/normalize.mjs` (the session object in `normalizeRow`, around line 61)
- Modify: `scraper/test/normalize.test.mjs`
- Modify: `site/lib/time.mjs` (append)
- Modify: `test/site/time.test.mjs`
- Modify: `site/styles.css` (after the `.lv4 … .lv6` line, around line 61)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `normalizeRow(row).session.blocked: boolean` — the park's `disabled` flag. (`site/data/schedule.json` sessions gain this field on the next scrape; the schedule views ignore it.)
  - `monthsBetween(from: 'YYYY-MM-DD', to: 'YYYY-MM-DD') → string[]` of `'YYYY-MM'`, every month the range touches.
  - `israelInstant(date: 'YYYY-MM-DD', hhmm: 'HH:MM') → number` — epoch milliseconds of that Israel wall-clock time.

- [ ] **Step 1: Write the failing tests**

In `scraper/test/normalize.test.mjs`, in the test `'normalizeRow takes capacity and bookings from its own side'`, add `blocked: false` to the expected session:

```js
      area: 'reef', side: 'right', capacity: 18, booked: 5, spotsLeft: 13, available: true, blocked: false,
```

and in the test `'normalizeRow: Bay is level 0; disabled and overbooked rows have no spots'`, after `assert.equal(disabled.available, false);` add:

```js
  assert.equal(disabled.blocked, true);
```

In `test/site/time.test.mjs`, extend the import:

```js
import {
  israelToday, israelTime, israelIso, addDays, dayOfWeek, daysBetween,
  toParkDate, shortDate, minutes, formatAge, monthsBetween, israelInstant,
} from '../../site/lib/time.mjs';
```

and append:

```js
test('monthsBetween lists every month the range touches', () => {
  assert.deepEqual(monthsBetween('2025-11-20', '2026-01-03'), ['2025-11', '2025-12', '2026-01']);
  assert.deepEqual(monthsBetween('2026-09-01', '2026-09-30'), ['2026-09']);
});

test('israelInstant reads Israel wall-clock time in summer, winter and next to the DST change', () => {
  assert.equal(israelInstant('2026-09-10', '16:17'), Date.parse('2026-09-10T13:17:00Z'));
  assert.equal(israelInstant('2026-12-01', '12:00'), Date.parse('2026-12-01T10:00:00Z'));
  assert.equal(israelInstant('2026-10-24', '23:00'), Date.parse('2026-10-24T20:00:00Z')); // still +03:00
  assert.equal(israelInstant('2026-10-25', '08:00'), Date.parse('2026-10-25T06:00:00Z')); // +02:00 after 02:00
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test scraper/test/normalize.test.mjs test/site/time.test.mjs`
Expected: FAIL — the normalize tests see no `blocked` field, and `time.test.mjs` fails to load (`monthsBetween` is not exported).

- [ ] **Step 3: Implement**

In `scraper/normalize.mjs`, in the object `normalizeRow` returns, add `blocked` after `available`:

```js
      spotsLeft,
      available: spotsLeft > 0,
      blocked: isDisabled(row.disabled),
    },
```

Append to `site/lib/time.mjs`:

```js

/** Every month touched by from..to: monthsBetween("2025-11-20", "2026-01-03") → ["2025-11", "2025-12", "2026-01"]. */
export function monthsBetween(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return months;
}

/** Epoch milliseconds of an Israel wall-clock date and time, e.g. ("2026-09-10", "16:17"). */
export function israelInstant(date, hhmm) {
  const at = offset => Date.parse(`${date}T${hhmm}:00${offset}`);
  const guess = israelParts(new Date(Date.parse(`${date}T${hhmm}:00Z`))).offset;
  const exact = israelParts(new Date(at(guess))).offset; // the guess can be off by an hour next to a DST change
  return at(exact);
}
```

In `site/styles.css`, directly after the line `.lv4 { background: var(--l4); } .lv5 { background: var(--l5); } .lv6 { background: var(--l6); }` add:

```css
.lv7 { background: var(--mist); } /* internal special events (L7) */
```

(Level 7 sessions reach the schedule views with the chip class `lv7`, which had no colour, so its white "L7" text was invisible.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test scraper/test/normalize.test.mjs test/site/time.test.mjs`
Expected: PASS, 0 failures. Then `node --test` — every test passes.

- [ ] **Step 5: Commit**

```bash
git add scraper/normalize.mjs scraper/test/normalize.test.mjs site/lib/time.mjs test/site/time.test.mjs site/styles.css
git commit -m "feat: flag blocked sessions, colour L7 chips, add month and Israel-instant helpers"
```

---

### Task 2: Shared history rules and period ranges

**Files:**
- Create: `site/lib/history.mjs`
- Test: `test/site/history.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `daysBetween`, `monthsBetween` from `site/lib/time.mjs`.
- Produces (`site/lib/history.mjs`), used by the scraper (Tasks 3–5) and the page (Tasks 6, 8, 10):
  - `isKids(name) → boolean` — `/ילדים|גילאי/` in the name.
  - `classify({ area, level, capacity, blocked }) → 'cancelled' | 'blocked' | 'event' | 'lesson' | 'surf'`.
  - `expandMonth(file) → { month, closed: [{ date, text }], sessions: Row[] }` with `name` as a string (a stored file has `names[]` and `name` as an index).
  - `PERIODS = { '30d': 30, '90d': 90, '12m': 365, all: null }`, `DEFAULT_PERIOD = '90d'`.
  - `periodRange(preset, today, first) → { preset, from, to, compare: { kind: 'lastYear' | 'previous', from, to } | null }` — ends yesterday; `from` is clamped to `first` (the history's first date); comparison is −364 days if history covers it, else the previous equal range if covered, else `null`; `'all'` has no comparison; an unknown preset falls back to 90 days.
  - `monthsNeeded(range) → string[]` — `'YYYY-MM'` months covering the range and its comparison, sorted.

- [ ] **Step 1: Write the failing test** in `test/site/history.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, expandMonth, isKids, monthsNeeded, periodRange } from '../../site/lib/history.mjs';

test('classify: cancelled, blocked, event, lesson, surf (first match wins)', () => {
  assert.equal(classify({ area: 'reef', level: 4, capacity: 0, blocked: true }), 'cancelled');
  assert.equal(classify({ area: 'reef', level: 4, capacity: 18, blocked: true }), 'blocked');
  assert.equal(classify({ area: 'reef', level: 7, capacity: 16, blocked: false }), 'event');
  assert.equal(classify({ area: 'bay', level: 0, capacity: 18, blocked: false }), 'lesson');
  assert.equal(classify({ area: 'reef', level: 5, capacity: 15, blocked: false }), 'surf');
});

test('isKids reads the Bay group name', () => {
  assert.equal(isKids('שיעור גלישה למתחילים ב Bay - ילדים 7-10'), true);
  assert.equal(isKids('פסח - מפגש היכרות ב Bay (גילאי 7-16)'), true);
  assert.equal(isKids('שיעור גלישה למתחילים ב Bay - בוגרים מעל גיל 16'), false);
});

test('expandMonth turns name indexes back into names', () => {
  const file = { month: '2026-09', names: ['A', 'B'], closed: [], sessions: [{ id: 1, name: 1 }, { id: 2, name: 0 }] };
  assert.deepEqual(expandMonth(file), { month: '2026-09', closed: [], sessions: [{ id: 1, name: 'B' }, { id: 2, name: 'A' }] });
});

test('periodRange ends yesterday and compares with the same weeks last year when history has them', () => {
  assert.deepEqual(periodRange('90d', '2026-09-11', '2025-04-02'), {
    preset: '90d', from: '2026-06-13', to: '2026-09-10',
    compare: { kind: 'lastYear', from: '2025-06-14', to: '2025-09-11' },
  });
  assert.equal(periodRange('30d', '2026-09-11', '2025-04-02').from, '2026-08-12');
});

test('periodRange falls back to the previous period, then to no comparison', () => {
  const twelve = periodRange('12m', '2026-09-11', '2025-04-02'); // last year would start 2024-09-12
  assert.deepEqual([twelve.from, twelve.to, twelve.compare], ['2025-09-11', '2026-09-10', null]);
  const early = periodRange('90d', '2025-12-01', '2025-04-02');
  assert.deepEqual(early.compare, { kind: 'previous', from: '2025-06-04', to: '2025-09-01' });
  assert.deepEqual(periodRange('all', '2026-09-11', '2025-04-02'), { preset: 'all', from: '2025-04-02', to: '2026-09-10', compare: null });
  assert.equal(periodRange('90d', '2025-05-01', '2025-04-02').from, '2025-04-02'); // clamped to the first date
  assert.equal(periodRange('nonsense', '2026-09-11', '2025-04-02').preset, 'nonsense');
});

test('monthsNeeded covers the range and its comparison', () => {
  assert.deepEqual(monthsNeeded(periodRange('30d', '2026-09-11', '2025-04-02')), ['2025-08', '2025-09', '2026-08', '2026-09']);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test test/site/history.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/history.mjs`.

- [ ] **Step 3: Write `site/lib/history.mjs`**

```js
// History rules shared by the scraper and the page (analysis spec sections 3, 4.1 and 6.1).
import { addDays, daysBetween, monthsBetween } from './time.mjs';

/** Bay groups for kids. The park's age field says "all" on most kids' groups; the name is reliable. */
export const isKids = name => /ילדים|גילאי/.test(String(name));

/** A session's kind, first match wins. ("removed" is only ever set by the history update.) */
export function classify({ area, level, capacity, blocked }) {
  if (capacity === 0) return 'cancelled';
  if (blocked) return 'blocked';
  if (level === 7) return 'event';
  return area === 'bay' ? 'lesson' : 'surf';
}

/** A stored month file (names by index) → { month, closed, sessions } with names as strings. */
export function expandMonth(file) {
  return {
    month: file.month,
    closed: file.closed ?? [],
    sessions: (file.sessions ?? []).map(s => ({ ...s, name: file.names?.[s.name] ?? '' })),
  };
}

export const PERIODS = { '30d': 30, '90d': 90, '12m': 365, all: null };
export const DEFAULT_PERIOD = '90d';

/**
 * The range a period preset covers, always ending yesterday (today isn't final), and what it's
 * compared with: the same range 364 days back (weekday-aligned) if history covers it, otherwise
 * the previous range of equal length if history covers that, otherwise nothing.
 * `first` is the first date in the history.
 */
export function periodRange(preset, today, first) {
  const to = addDays(today, -1);
  const length = Object.hasOwn(PERIODS, preset) ? PERIODS[preset] : PERIODS[DEFAULT_PERIOD];
  if (length === null) return { preset, from: first ?? to, to, compare: null };
  let from = addDays(today, -length);
  if (first && from < first) from = first;
  const days = daysBetween(from, to) + 1;
  const lastYear = { kind: 'lastYear', from: addDays(from, -364), to: addDays(to, -364) };
  const previous = { kind: 'previous', from: addDays(from, -days), to: addDays(from, -1) };
  const compare = !first ? null : lastYear.from >= first ? lastYear : previous.from >= first ? previous : null;
  return { preset, from, to, compare };
}

/** Month files a range and its comparison need. */
export function monthsNeeded(range) {
  const months = new Set(monthsBetween(range.from, range.to));
  if (range.compare) for (const m of monthsBetween(range.compare.from, range.compare.to)) months.add(m);
  return [...months].sort();
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/site/history.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/history.mjs test/site/history.test.mjs
git commit -m "feat: add shared history rules and analysis period ranges"
```

---

### Task 3: History store logic

**Files:**
- Create: `scraper/history.mjs`
- Test: `scraper/test/history.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `israelInstant` (`site/lib/time.mjs`); `classify`, `expandMonth`, `isKids` (`site/lib/history.mjs`); `normalizeRow` (`scraper/normalize.mjs`, with Task 1's `blocked`).
- Produces (`scraper/history.mjs`):
  - A **row** is `{ id, date, start, end, level, area, side, kids, name, kind, capacity, booked, final: false | true | 'snapshot', pace: [[minutesBeforeStart, booked], …] }` (in memory `name` is a string). A **store** is `{ 'YYYY-MM': { month, closed: [{ date, text }], sessions: Row[] } }`.
  - `monthOf(date) → 'YYYY-MM'`, `compareRows(a, b)` (date, start, reef before Bay, right before left, id).
  - `toRow(date, session) → Row` (not final, empty pace).
  - `minutesBefore(date, start, fetchedAt) → number` (whole minutes, negative once started).
  - `upsertUpcoming(store, schedule) → store` — upserts every session of a `schedule.json` object; appends `[minutesBefore, booked]` when booked differs from the last entry (only before the start); never touches `final: true` rows; records `day.closed` days.
  - `applyFinal(store, parkWindow, { from, to }) → store` — rows of a raw park window dated from..to become the park's numbers with `final: true` (pace kept); rows held for those dates that the window doesn't list become `kind: 'removed'`, `final: true`; close days in range are recorded with whitespace collapsed.
  - `finalizeStale(store, today) → store` — `final: false` rows dated before `today − 3` become `final: 'snapshot'`.
  - `formatMonth(month) → string` (the file text), `parseMonth(text) → month`.
  - `earliestDate(store) → 'YYYY-MM-DD' | null`.
  - `nextIndex(prev, { months, updatedAt, first, snapshot }) → { updatedAt, first, months, snapshots, snapshotsSince }`.

- [ ] **Step 1: Write the failing test** in `scraper/test/history.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../normalize.mjs';
import {
  applyFinal, compareRows, finalizeStale, formatMonth, minutesBefore, nextIndex, parseMonth, toRow, upsertUpcoming,
} from '../history.mjs';
import { fixtureWindow } from '../test-support/fake-park.mjs';

const DATES = ['2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const scheduleAt = fetchedAt => normalize(DATES.map(fixtureWindow), { today: '2026-09-10', fetchedAt }).schedule;
const allRows = store => Object.values(store).flatMap(m => m.sessions);
const rowById = (store, id) => allRows(store).find(r => r.id === id);
const sessionOf = (schedule, id) => schedule.days.flatMap(d => d.sessions).find(s => s.id === id);
// A plausible history row; override fields per test.
const row = (over = {}) => ({
  id: 1, date: '2026-09-10', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 18, booked: 5, final: false, pace: [], ...over,
});

test('toRow: real rows get their kind, kids flag and numbers', () => {
  const schedule = scheduleAt('2026-09-10T16:17:00+03:00');
  const rows = schedule.days.flatMap(d => d.sessions.map(s => toRow(d.date, s)));
  const byId = id => rows.find(r => r.id === id);
  assert.equal(byId(38905).kind, 'blocked'); // 10/09 20:00 women's retreat, disabled
  assert.deepEqual([byId(37616).kind, byId(37616).capacity, byId(37616).booked], ['lesson', 2, 8]); // overbooked Bay
  assert.deepEqual([byId(37303).kind, byId(37303).final, byId(37303).pace], ['surf', false, []]);
  const kids = rows.filter(r => r.kids);
  assert.ok(kids.length > 0);
  assert.ok(kids.every(r => r.area === 'bay' && /ילדים|גילאי/.test(r.name)));
});

test('minutesBefore counts Israel time, across the DST change too', () => {
  assert.equal(minutesBefore('2026-09-10', '16:30', '2026-09-10T16:17:00+03:00'), 13);
  assert.equal(minutesBefore('2026-10-25', '08:00', '2026-10-24T20:00:00+03:00'), 780);
  assert.equal(minutesBefore('2026-09-10', '06:00', '2026-09-10T16:17:00+03:00'), -617);
});

test('upsertUpcoming adds every session with a first pace entry and records closed days', () => {
  const schedule = scheduleAt('2026-09-10T16:17:00+03:00');
  const store = upsertUpcoming({}, schedule);
  assert.deepEqual(Object.keys(store), ['2026-09']);
  assert.equal(allRows(store).length, 438);
  assert.deepEqual(store['2026-09'].closed, [{ date: '2026-09-21', text: 'יום כיפור' }]);
  const later = allRows(store).find(r => r.date === '2026-09-14');
  assert.deepEqual(later.pace, [[minutesBefore(later.date, later.start, schedule.fetchedAt), later.booked]]);
  assert.deepEqual(rowById(store, 37303).pace, []); // 10/09 06:00 had already started at 16:17
});

test('upsertUpcoming appends pace only when booked changes, and updates changed fields', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T16:17:00+03:00'));
  const id = allRows(store).find(r => r.date === '2026-09-14' && r.area === 'reef').id;
  upsertUpcoming(store, scheduleAt('2026-09-10T16:47:00+03:00'));
  assert.equal(rowById(store, id).pace.length, 1);

  const changed = scheduleAt('2026-09-10T17:17:00+03:00');
  const s = sessionOf(changed, id);
  s.booked += 2;
  s.capacity = 0;
  upsertUpcoming(store, changed);
  const r = rowById(store, id);
  assert.equal(r.pace.length, 2);
  assert.deepEqual(r.pace[1], [minutesBefore(r.date, r.start, changed.fetchedAt), s.booked]);
  assert.deepEqual([r.booked, r.capacity, r.kind], [s.booked, 0, 'cancelled']);
});

test('upsertUpcoming never overwrites a final row', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T16:17:00+03:00'));
  const r = allRows(store).find(x => x.date === '2026-09-14');
  r.final = true;
  const before = structuredClone(r);
  const changed = scheduleAt('2026-09-10T17:17:00+03:00');
  sessionOf(changed, r.id).booked += 3;
  upsertUpcoming(store, changed);
  assert.deepEqual(rowById(store, r.id), before);
});

test('applyFinal takes the park counts for its range, keeps pace, and marks unlisted rows removed', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T08:00:00+03:00'));
  const target = allRows(store).find(r => r.date === '2026-09-11');
  const pace = structuredClone(target.pace);
  assert.equal(pace.length, 1);
  store['2026-09'].sessions.push(row({ id: 999001, date: '2026-09-12' }));

  const window = structuredClone(fixtureWindow('2026-09-10'));
  const raw = window.scheduler.find(x => x.scheduler_id === target.id);
  raw[`${target.side}_count_users`] = 3;
  applyFinal(store, window, { from: '2026-09-10', to: '2026-09-12' });

  const r = rowById(store, target.id);
  assert.deepEqual([r.final, r.booked, r.pace], [true, 3, pace]);
  assert.deepEqual([rowById(store, 999001).kind, rowById(store, 999001).final], ['removed', true]);
  assert.ok(allRows(store).filter(x => x.date >= '2026-09-13').every(x => x.final === false));
});

test('applyFinal records close days with tidy text, and marks the sessions of a closed day removed', () => {
  const store = { '2026-09': { month: '2026-09', closed: [], sessions: [row({ date: '2026-09-11' })] } };
  applyFinal(store, { scheduler: [], close_days: [{ date: '2026-09-11', text: 'סגור\n לתחזוקה ' }] }, { from: '2026-09-11', to: '2026-09-13' });
  assert.deepEqual(store['2026-09'].closed, [{ date: '2026-09-11', text: 'סגור לתחזוקה' }]);
  assert.equal(store['2026-09'].sessions[0].kind, 'removed');
});

test('finalizeStale keeps the last snapshot for rows more than 3 days old', () => {
  const store = { '2026-09': { month: '2026-09', closed: [], sessions: [
    row({ id: 1, date: '2026-09-06' }), row({ id: 2, date: '2026-09-07' }), row({ id: 3, date: '2026-09-05', final: true }),
  ] } };
  finalizeStale(store, '2026-09-10');
  assert.deepEqual(store['2026-09'].sessions.map(r => r.final), ['snapshot', false, true]);
});

test('formatMonth writes one sorted session per line with names by index, and parses back', () => {
  const m = {
    month: '2026-09',
    closed: [{ date: '2026-09-21', text: 'יום כיפור' }],
    sessions: [row({ id: 3, start: '09:00', name: 'B' }), row({ id: 2, side: 'left', name: 'A' }), row({ id: 1, name: 'A', pace: [[600, 2]] })],
  };
  const text = formatMonth(m);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 5), ['{', '  "month": "2026-09",', '  "names": ["A","B"],', '  "closed": [{"date":"2026-09-21","text":"יום כיפור"}],', '  "sessions": [']);
  assert.equal(lines[5], '    {"id":1,"date":"2026-09-10","start":"08:00","end":"09:00","level":3,"area":"reef","side":"right","kids":false,"name":0,"kind":"surf","capacity":18,"booked":5,"final":false,"pace":[[600,2]]},');
  assert.match(lines[6], /^ {4}\{"id":2,.*"side":"left",.*"name":0,/);
  assert.match(lines[7], /^ {4}\{"id":3,.*"name":1,.*\}$/);
  assert.ok(text.endsWith('\n  ]\n}\n'));
  assert.deepEqual(parseMonth(text), { ...m, sessions: [...m.sessions].sort(compareRows) });
  assert.equal(formatMonth({ month: '2026-10', closed: [], sessions: [] }), '{\n  "month": "2026-10",\n  "names": [],\n  "closed": [],\n  "sessions": []\n}\n');
});

test('nextIndex counts snapshots and keeps the earliest date and every month', () => {
  const first = nextIndex(null, { months: ['2026-09'], updatedAt: '2026-09-12T06:17:00+03:00', first: '2026-09-12', snapshot: true });
  assert.deepEqual(first, { updatedAt: '2026-09-12T06:17:00+03:00', first: '2026-09-12', months: ['2026-09'], snapshots: 1, snapshotsSince: '2026-09-12' });
  const backfilled = nextIndex(first, { months: ['2025-04', '2026-09'], updatedAt: 'x', first: '2025-04-02', snapshot: false });
  assert.deepEqual([backfilled.first, backfilled.months, backfilled.snapshots, backfilled.snapshotsSince], ['2025-04-02', ['2025-04', '2026-09'], 1, '2026-09-12']);
  assert.equal(nextIndex(null, { months: [], updatedAt: 'x', first: null, snapshot: false }).snapshotsSince, null);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scraper/test/history.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/history.mjs`.

- [ ] **Step 3: Write `scraper/history.mjs`**

```js
// History files (analysis spec section 4): site/data/history/YYYY-MM.json, one per month of the
// session date, written one session per line so each run's git diff shows only what changed.
// A "store" is { "2026-09": { month, closed: [{ date, text }], sessions: [row] } } with names as strings.
import { addDays, israelInstant } from '../site/lib/time.mjs';
import { classify, expandMonth, isKids } from '../site/lib/history.mjs';
import { normalizeRow } from './normalize.mjs';

const AREA_ORDER = { reef: 0, bay: 1 };
const SIDE_ORDER = { right: 0, left: 1 };

export const monthOf = date => date.slice(0, 7);

export const compareRows = (a, b) =>
  a.date.localeCompare(b.date) ||
  a.start.localeCompare(b.start) ||
  AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
  SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
  a.id - b.id;

/** A normalized session on `date` → a history row (not final, no pace yet). */
export function toRow(date, s) {
  return {
    id: s.id,
    date,
    start: s.start,
    end: s.end,
    level: s.level,
    area: s.area,
    side: s.side,
    kids: s.area === 'bay' && isKids(s.name),
    name: s.name,
    kind: classify(s),
    capacity: s.capacity,
    booked: s.booked,
    final: false,
    pace: [],
  };
}

/** Whole minutes from `fetchedAt` (ISO timestamp) until the session starts, in Israel time. */
export const minutesBefore = (date, start, fetchedAt) =>
  Math.round((israelInstant(date, start) - Date.parse(fetchedAt)) / 60000);

const monthIn = (store, month) => (store[month] ??= { month, closed: [], sessions: [] });

function addClosed(store, date, text) {
  const m = monthIn(store, monthOf(date));
  m.closed = [...m.closed.filter(c => c.date !== date), { date, text }].sort((a, b) => a.date.localeCompare(b.date));
}

/** Records a fresh schedule: upserts every session and appends a pace entry when its booked count changed. */
export function upsertUpcoming(store, schedule) {
  for (const day of schedule.days) {
    if (day.closed) addClosed(store, day.date, day.closed);
    for (const s of day.sessions) {
      const m = monthIn(store, monthOf(day.date));
      const i = m.sessions.findIndex(r => r.id === s.id);
      const old = i >= 0 ? m.sessions[i] : null;
      if (old?.final === true) continue; // the park's final count wins over any snapshot
      const row = toRow(day.date, s);
      row.pace = old ? old.pace : [];
      const before = minutesBefore(day.date, s.start, schedule.fetchedAt);
      if (before >= 0 && row.pace.at(-1)?.[1] !== s.booked) row.pace.push([before, s.booked]);
      if (old) m.sessions[i] = row;
      else m.sessions.push(row);
    }
  }
  return store;
}

/**
 * Final counts from one past park window: its rows dated from..to take the park's numbers and
 * final: true (keeping their pace). Rows we hold for those dates that the park no longer lists
 * become kind "removed".
 */
export function applyFinal(store, window, { from, to }) {
  const listed = new Set();
  for (const raw of window.scheduler ?? []) {
    listed.add(raw.scheduler_id);
    const n = normalizeRow(raw);
    if (n.skip || n.date < from || n.date > to) continue;
    const m = monthIn(store, monthOf(n.date));
    const row = { ...toRow(n.date, n.session), final: true };
    const i = m.sessions.findIndex(r => r.id === row.id);
    if (i >= 0) {
      row.pace = m.sessions[i].pace;
      m.sessions[i] = row;
    } else {
      m.sessions.push(row);
    }
  }
  for (const c of window.close_days ?? []) {
    if (c.date >= from && c.date <= to) addClosed(store, c.date, String(c.text ?? '').replace(/\s+/g, ' ').trim() || 'סגור');
  }
  for (const m of Object.values(store)) {
    for (const r of m.sessions) {
      if (r.date >= from && r.date <= to && !listed.has(r.id)) {
        r.kind = 'removed';
        r.final = true;
      }
    }
  }
  return store;
}

/** Rows more than 3 days old that never got the park's final count keep their last snapshot as final. */
export function finalizeStale(store, today) {
  const cutoff = addDays(today, -3);
  for (const m of Object.values(store)) {
    for (const r of m.sessions) if (r.final === false && r.date < cutoff) r.final = 'snapshot';
  }
  return store;
}

/** A month → its file text: names by index, closed days, then one session per line. */
export function formatMonth(m) {
  const names = [];
  const index = new Map();
  const line = r => {
    if (!index.has(r.name)) {
      index.set(r.name, names.length);
      names.push(r.name);
    }
    const { id, date, start, end, level, area, side, kids, kind, capacity, booked, final, pace } = r;
    return `    ${JSON.stringify({ id, date, start, end, level, area, side, kids, name: index.get(r.name), kind, capacity, booked, final, pace })}`;
  };
  const lines = [...m.sessions].sort(compareRows).map(line);
  const closed = [...m.closed].sort((a, b) => a.date.localeCompare(b.date));
  const sessions = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "month": ${JSON.stringify(m.month)},\n  "names": ${JSON.stringify(names)},\n  "closed": ${JSON.stringify(closed)},\n  "sessions": ${sessions}\n}\n`;
}

/** File text → month with names as strings. */
export const parseMonth = text => expandMonth(JSON.parse(text));

/** The first session date held in a store, or null. */
export const earliestDate = store =>
  Object.values(store).flatMap(m => m.sessions.map(r => r.date)).sort()[0] ?? null;

/** index.json after an update. `snapshot` is true when this update recorded a live schedule. */
export function nextIndex(prev, { months, updatedAt, first, snapshot }) {
  return {
    updatedAt,
    first: [prev?.first, first].filter(Boolean).sort()[0] ?? null,
    months: [...new Set([...(prev?.months ?? []), ...months])].sort(),
    snapshots: (prev?.snapshots ?? 0) + (snapshot ? 1 : 0),
    snapshotsSince: prev?.snapshotsSince ?? (snapshot ? updatedAt.slice(0, 10) : null),
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scraper/test/history.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/history.mjs scraper/test/history.test.mjs
git commit -m "feat: add history store logic (pace log, final counts, month file format)"
```

---

### Task 4: History update on every run

**Files:**
- Create: `scraper/update-history.mjs`
- Test: `scraper/test/update-history.test.mjs`
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/update.yml` (replace)

**Interfaces:**
- Consumes: Task 3's `applyFinal`, `earliestDate`, `finalizeStale`, `formatMonth`, `nextIndex`, `parseMonth`, `upsertUpcoming`; `fetchWindow(fromIso, { fetchImpl, sleep, log })` (`scraper/fetch.mjs`); `DATA_FILE` (`scraper/scrape.mjs`); `addDays`, `israelToday`, `monthsBetween` (`site/lib/time.mjs`).
- Produces (`scraper/update-history.mjs`), used by Task 5:
  - `HISTORY_DIR` — absolute path of `site/data/history/`.
  - `readMonths(dir, months) → Promise<store>` (missing files start empty), `writeMonths(dir, store) → Promise<string[]>` (writes every month with sessions or closed days; returns the months written), `readIndex(dir) → Promise<index | null>`, `writeIndex(dir, index)`.
  - `updateHistory({ dir, scheduleFile, now, log, fetchImpl, sleep }) → Promise<index>` — reads `schedule.json`, loads the months from `today − 31` through `publishedThrough`, upserts, fetches the past window starting `today − 3` (a failure only logs `warning: final counts for FROM..TO skipped: …`), finalizes stale rows, writes months and an index with `snapshots + 1`.

- [ ] **Step 1: Write the failing test** in `scraper/test/update-history.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from '../normalize.mjs';
import { parseMonth } from '../history.mjs';
import { updateHistory } from '../update-history.mjs';
import { fixtureFetch, fixtureWindow, recordingSleep, scriptedFetch } from '../test-support/fake-park.mjs';

const NOW = new Date('2026-09-13T06:17:05Z'); // 09:17 in Israel: final counts cover 10–12/09
const UPCOMING = ['2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const quiet = () => {};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'srfsc-history-'));
  const scheduleFile = join(root, 'schedule.json');
  const { schedule } = normalize(UPCOMING.map(fixtureWindow), { today: '2026-09-13', fetchedAt: '2026-09-13T09:17:05+03:00' });
  await writeFile(scheduleFile, JSON.stringify(schedule));
  return { dir: join(root, 'history'), scheduleFile, schedule };
}
const readMonth = async (dir, month) => parseMonth(await readFile(join(dir, `${month}.json`), 'utf8'));

test('updateHistory records upcoming sessions and the park final counts for the last 3 days', async () => {
  const { dir, scheduleFile, schedule } = await setup();
  const fetchImpl = fixtureFetch();
  const index = await updateHistory({ dir, scheduleFile, now: NOW, fetchImpl, log: quiet });

  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /from_date=10%2F09%2F26/);
  const sept = await readMonth(dir, '2026-09');
  const past = sept.sessions.filter(r => r.date < '2026-09-13');
  assert.ok(past.length > 0);
  assert.ok(past.every(r => r.final === true));
  const upcoming = sept.sessions.filter(r => r.date >= '2026-09-13');
  assert.equal(upcoming.length, schedule.days.reduce((n, d) => n + d.sessions.length, 0));
  assert.ok(upcoming.filter(r => r.date > '2026-09-13').every(r => r.final === false && r.pace.length === 1));
  assert.deepEqual(sept.closed, [{ date: '2026-09-21', text: 'יום כיפור' }]);
  assert.deepEqual([index.snapshots, index.snapshotsSince, index.months, index.first], [1, '2026-09-13', ['2026-09'], '2026-09-10']);
  const text = await readFile(join(dir, 'index.json'), 'utf8');
  assert.ok(text.startsWith('{\n  "updatedAt": "2026-09-13T09:17:05+03:00"') && text.endsWith('}\n'));
});

test('a second update appends pace only for changed counts; a failed past window only skips final counts', async () => {
  const { dir, scheduleFile, schedule } = await setup();
  await updateHistory({ dir, scheduleFile, now: NOW, fetchImpl: fixtureFetch(), log: quiet });

  const target = schedule.days.find(d => d.date > '2026-09-13' && d.sessions.length).sessions[0];
  target.booked += 1;
  await writeFile(scheduleFile, JSON.stringify({ ...schedule, fetchedAt: '2026-09-13T09:47:05+03:00' }));
  const lines = [];
  const index = await updateHistory({
    dir, scheduleFile, now: new Date('2026-09-13T06:47:05Z'),
    fetchImpl: scriptedFetch([new Error('offline')]), sleep: recordingSleep(), log: l => lines.push(l),
  });

  const sept = await readMonth(dir, '2026-09');
  const row = sept.sessions.find(r => r.id === target.id);
  assert.deepEqual(row.pace.map(p => p[1]), [target.booked - 1, target.booked]);
  assert.ok(sept.sessions.filter(r => r.id !== target.id && r.date > '2026-09-13').every(r => r.pace.length === 1));
  assert.ok(sept.sessions.filter(r => r.date < '2026-09-13').every(r => r.final === true)); // from the first run
  assert.ok(lines.some(l => l.startsWith('warning: final counts for 2026-09-10..2026-09-12 skipped')), lines.join('\n'));
  assert.equal(index.snapshots, 2);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scraper/test/update-history.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/update-history.mjs`.

- [ ] **Step 3: Write `scraper/update-history.mjs`**

```js
// CLI: records the fresh site/data/schedule.json into the monthly history files, and takes the
// park's final counts for the last 3 days (analysis spec section 4.3). Runs after scrape.mjs.
// Usage: node scraper/update-history.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addDays, israelToday, monthsBetween } from '../site/lib/time.mjs';
import { fetchWindow } from './fetch.mjs';
import { applyFinal, earliestDate, finalizeStale, formatMonth, nextIndex, parseMonth, upsertUpcoming } from './history.mjs';
import { DATA_FILE } from './scrape.mjs';

export const HISTORY_DIR = fileURLToPath(new URL('../site/data/history/', import.meta.url));

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** The month files for `months`, keyed by month; missing files start empty. */
export async function readMonths(dir, months) {
  const store = {};
  for (const month of months) {
    const text = await readText(join(dir, `${month}.json`));
    store[month] = text ? parseMonth(text) : { month, closed: [], sessions: [] };
  }
  return store;
}

/** Writes every month that has sessions or closed days. Returns the months written. */
export async function writeMonths(dir, store) {
  await mkdir(dir, { recursive: true });
  const written = [];
  for (const m of Object.values(store)) {
    if (!m.sessions.length && !m.closed.length) continue;
    await writeFile(join(dir, `${m.month}.json`), formatMonth(m));
    written.push(m.month);
  }
  return written;
}

export async function readIndex(dir) {
  const text = await readText(join(dir, 'index.json'));
  return text ? JSON.parse(text) : null;
}

export const writeIndex = (dir, index) => writeFile(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

/** One history update. A failed past-window fetch only skips the final counts. */
export async function updateHistory({ dir = HISTORY_DIR, scheduleFile = DATA_FILE, now = new Date(), log = console.log, ...fetchOptions } = {}) {
  const schedule = JSON.parse(await readFile(scheduleFile, 'utf8'));
  const today = israelToday(now);
  const from = addDays(today, -3);
  const to = addDays(today, -1);
  const store = await readMonths(dir, monthsBetween(addDays(today, -31), schedule.publishedThrough ?? today));
  upsertUpcoming(store, schedule);
  try {
    applyFinal(store, await fetchWindow(from, { log, ...fetchOptions }), { from, to });
  } catch (err) {
    log(`warning: final counts for ${from}..${to} skipped: ${err.message}`);
  }
  finalizeStale(store, today);
  const months = await writeMonths(dir, store);
  const index = nextIndex(await readIndex(dir), { months, updatedAt: schedule.fetchedAt, first: earliestDate(store), snapshot: true });
  await writeIndex(dir, index);
  log(`history: wrote ${months.join(', ')}; ${index.snapshots} snapshots since ${index.snapshotsSince}`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateHistory().catch(err => {
    console.error(`history update failed: ${err.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scraper/test/update-history.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the scripts to `package.json`**

```json
{
  "name": "srfsc",
  "private": true,
  "type": "module",
  "description": "Glanceable schedule board for SRF Park TLV surf sessions",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test",
    "scrape": "node scraper/scrape.mjs",
    "update-history": "node scraper/update-history.mjs",
    "update": "node scraper/scrape.mjs && node scraper/update-history.mjs",
    "serve": "node scripts/serve.mjs"
  }
}
```

- [ ] **Step 6: Replace `.github/workflows/update.yml`**

Changes from the current file: the cron runs at :17 and :47; the scrape step gets `id: scrape`; a new "Update history" step runs only after a successful scrape and may fail without blocking anything; the commit step stages all of `site/data/` and also notices untracked files there.

```yaml
# Scrape the park's schedule, record history, commit site/data/, deploy site/ to GitHub Pages.
# Specs: docs/superpowers/specs/2026-09-10-surf-schedule-design.md section 5, and
# docs/superpowers/specs/2026-09-11-schedule-analysis-design.md section 5.
name: Update schedule

on:
  schedule:
    - cron: '17,47 3-20 * * *' # twice an hour, 06:17–23:47 Israel summer time; GitHub drops many scheduled runs
  workflow_dispatch: # the page's "עדכון עכשיו" button (or an external trigger, see README)
  push:
    branches: [main]

permissions:
  contents: write
  pages: write
  id-token: write

# One run at a time; a button press waits behind a running scheduled run.
concurrency:
  group: update
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # full history so `git pull --rebase` below always finds the merge base

      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - name: Test
        run: node --test

      # Set the repository variable SCRAPE_IN_ACTIONS=false to scrape from your own computer instead.
      - name: Scrape the park
        id: scrape
        if: vars.SCRAPE_IN_ACTIONS != 'false'
        run: node scraper/scrape.mjs
        # a push should still deploy code (with the existing data) when the park is unreachable
        continue-on-error: ${{ github.event_name == 'push' }}

      # History never blocks the schedule: if this step fails, the new schedule still commits and deploys.
      - name: Update history
        if: steps.scrape.outcome == 'success' && vars.SCRAPE_IN_ACTIONS != 'false'
        run: node scraper/update-history.mjs
        continue-on-error: true

      - name: Commit new data
        if: vars.SCRAPE_IN_ACTIONS != 'false'
        run: |
          # a new month's history file is untracked, so check for those as well as changed files
          if git diff --quiet -- site/data && [ -z "$(git ls-files --others --exclude-standard -- site/data)" ]; then
            echo "No changes to commit"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add site/data
          git commit -m "data: update schedule"
          git pull --rebase
          git push

      - uses: actions/configure-pages@v6

      - uses: actions/upload-pages-artifact@v5
        with:
          path: site

      - id: deploy
        uses: actions/deploy-pages@v5
```

- [ ] **Step 7: Run every test**

Run: `node --test`
Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add scraper/update-history.mjs scraper/test/update-history.test.mjs package.json .github/workflows/update.yml
git commit -m "feat: record every scrape into the history files"
```

---

### Task 5: Backfill the park's past

**Files:**
- Create: `scraper/backfill.mjs`
- Test: `scraper/test/backfill.test.mjs`
- Modify: `package.json` (add the `backfill` script)
- Create (generated): `site/data/history/2025-04.json` … `site/data/history/YYYY-MM.json`, `site/data/history/index.json`

**Interfaces:**
- Consumes: Task 3's `applyFinal`, `earliestDate`, `nextIndex`; Task 4's `HISTORY_DIR`, `readIndex`, `readMonths`, `writeIndex`, `writeMonths`; `fetchWindow`; `addDays`, `israelIso`, `israelToday`, `monthsBetween`.
- Produces (`scraper/backfill.mjs`): `FIRST_WINDOW = '2025-04-01'`, `PAUSE_MS = 1500`, `backfill({ dir, start, now, sleep, log, fetchImpl }) → Promise<index>` — every 3-day window from `start` to yesterday, as final rows with empty pace, merged into existing files (existing pace kept), then an index with `snapshots` unchanged.

- [ ] **Step 1: Write the failing test** in `scraper/test/backfill.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeRow } from '../normalize.mjs';
import { formatMonth, parseMonth, toRow } from '../history.mjs';
import { backfill, PAUSE_MS } from '../backfill.mjs';
import { fixtureFetch, fixtureWindow, isoFromUrl, recordingSleep } from '../test-support/fake-park.mjs';

const NOW = new Date('2026-09-16T09:00:00Z'); // 12:00 in Israel: yesterday is 15/09
const quiet = () => {};
const readMonth = async (dir, month) => parseMonth(await readFile(join(dir, `${month}.json`), 'utf8'));

test('backfill imports every window up to yesterday as final, pausing between requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srfsc-backfill-'));
  const fetchImpl = fixtureFetch();
  const sleep = recordingSleep();
  const index = await backfill({ dir, start: '2026-09-10', now: NOW, fetchImpl, sleep, log: quiet });

  assert.deepEqual(fetchImpl.calls.map(c => isoFromUrl(c.url)), ['2026-09-10', '2026-09-13']);
  assert.deepEqual(sleep.waits, [PAUSE_MS, PAUSE_MS]);
  const sept = await readMonth(dir, '2026-09');
  assert.ok(sept.sessions.length > 0);
  assert.ok(sept.sessions.every(r => r.final === true && r.pace.length === 0 && r.date >= '2026-09-10' && r.date <= '2026-09-15'));
  assert.deepEqual([index.first, index.snapshots, index.snapshotsSince, index.months], ['2026-09-10', 0, null, ['2026-09']]);
});

test('backfill keeps pace already recorded for a session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srfsc-backfill-'));
  const raw = fixtureWindow('2026-09-10').scheduler.find(r => r.date === '2026-09-11');
  const { date, session } = normalizeRow(raw);
  const seeded = { ...toRow(date, session), pace: [[600, 3]] };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '2026-09.json'), formatMonth({ month: '2026-09', closed: [], sessions: [seeded] }));

  await backfill({ dir, start: '2026-09-10', now: NOW, fetchImpl: fixtureFetch(), sleep: recordingSleep(), log: quiet });
  const row = (await readMonth(dir, '2026-09')).sessions.find(r => r.id === seeded.id);
  assert.deepEqual([row.final, row.pace], [true, [[600, 3]]]);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scraper/test/backfill.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/backfill.mjs`.

- [ ] **Step 3: Write `scraper/backfill.mjs`**

```js
// CLI: one-time import of every past session the park still serves into site/data/history/
// (analysis spec section 4.4). Safe to re-run: it merges and keeps existing pace entries.
// Usage: node scraper/backfill.mjs   (about 180 windows, 1.5 s apart: 5 minutes)
import { pathToFileURL } from 'node:url';
import { addDays, israelIso, israelToday, monthsBetween } from '../site/lib/time.mjs';
import { fetchWindow } from './fetch.mjs';
import { applyFinal, earliestDate, nextIndex } from './history.mjs';
import { HISTORY_DIR, readIndex, readMonths, writeIndex, writeMonths } from './update-history.mjs';

export const FIRST_WINDOW = '2025-04-01'; // the park's first sessions are on 2.4.2025
export const PAUSE_MS = 1500;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function backfill({ dir = HISTORY_DIR, start = FIRST_WINDOW, now = new Date(), sleep = wait, log = console.log, ...fetchOptions } = {}) {
  const yesterday = addDays(israelToday(now), -1);
  const store = await readMonths(dir, monthsBetween(start, yesterday));
  let windows = 0;
  for (let from = start; from <= yesterday; from = addDays(from, 3)) {
    const to = addDays(from, 2) < yesterday ? addDays(from, 2) : yesterday;
    applyFinal(store, await fetchWindow(from, { sleep, log, ...fetchOptions }), { from, to });
    windows += 1;
    if (windows % 20 === 0) log(`backfill: through ${to}`);
    await sleep(PAUSE_MS);
  }
  const months = await writeMonths(dir, store);
  const index = nextIndex(await readIndex(dir), { months, updatedAt: israelIso(now), first: earliestDate(store), snapshot: false });
  await writeIndex(dir, index);
  const sessions = Object.values(store).reduce((n, m) => n + m.sessions.length, 0);
  log(`backfill: ${windows} windows, ${sessions} sessions in ${months.length} months`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfill().catch(err => {
    console.error(`backfill failed: ${err.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scraper/test/backfill.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the script** — in `package.json` `scripts`, after `"update"`, add:

```json
    "backfill": "node scraper/backfill.mjs",
```

- [ ] **Step 6: Commit the code**

```bash
git add scraper/backfill.mjs scraper/test/backfill.test.mjs package.json
git commit -m "feat: add one-time backfill of the park's past sessions"
```

- [ ] **Step 7: Run the real backfill** (about 180 requests to the live park, 1.5 s apart: about 5 minutes)

Run: `npm run backfill`
Expected: progress lines every 20 windows, then `backfill: N windows, M sessions in K months`, and `site/data/history/` holding one file per month from `2025-04.json` to the current month plus `index.json` (`"first": "2025-04-02"`, `"snapshots": 0`).

- [ ] **Step 8: Check the numbers against the spec** (section 4.4: 14,283 counted sessions, 70% occupancy for 2.4.2025–10.9.2026)

```bash
node --input-type=module -e "import { readdirSync, readFileSync } from 'node:fs'; import { parseMonth } from './scraper/history.mjs'; const dir = 'site/data/history/'; const rows = readdirSync(dir).filter(f => f !== 'index.json').flatMap(f => parseMonth(readFileSync(dir + f, 'utf8')).sessions); const c = rows.filter(r => (r.kind === 'surf' || r.kind === 'lesson') && r.date <= '2026-09-10'); const cap = c.reduce((n, r) => n + r.capacity, 0); const sold = c.reduce((n, r) => n + Math.min(r.booked, r.capacity), 0); console.log(c.length, (sold / cap * 100).toFixed(1) + '%');"
```

Expected: `14283 69.8%`. If either number is off by more than 1%, stop and report it (the park may have changed past data) instead of committing.

- [ ] **Step 9: Commit the data**

```bash
git add site/data/history
git commit -m "data: backfill history since 2.4.2025"
```

---

### Task 6: Analysis numbers

**Files:**
- Create: `site/lib/analytics.mjs`
- Test: `test/site/analytics.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `dayOfWeek`, `daysBetween`, `israelInstant`, `monthsBetween` (`site/lib/time.mjs`); `classify`, `isKids`, `periodRange` (tests) (`site/lib/history.mjs`).
- Produces (`site/lib/analytics.mjs`), used by Tasks 7, 8, 10:
  - Constants: `LEVEL_KEYS = ['bay-adult', 'bay-kids', 'L1', …, 'L6']`, `HEAT_MIN_SESSIONS = 4`, `SLOT_MIN_DATES = 4`, `WEEKLY_MAX_DAYS = 92`, `PACE = { minSessions: 30, minLeadMinutes: 10080, leadDays: [14, 10, 7, 5, 3, 2, 1, 0], minGroup: 5, minSoldOut: 3 }`, `AT_RISK = { hours: 48, below: 0.4 }`.
  - Helpers: `levelKey(row)`, `isCounted(row)`, `isWeekend(date)` (Friday, Saturday), `priceOf(row, prices)`, `matchesLevels(row, levels: Set<number>)` (0 = both Bay groups; empty set = all).
  - `aggregate(rows, prices) → { sessions, capacity, spotsSold, people, revenue, emptyValue, occupancy: number | null, soldOutShare: number | null }`.
  - `selectRows(rows, { from, to }, levels)`, `kpis(cur, cmp, { range, closed, prices }) → { cur: totals + { daysOpen, closedDays }, cmp: same | null }`, `weekSplit(rows, prices) → { weekend, weekday }`.
  - `heatmap(rows, prices) → [{ hour: 'HH', cells: [totals | null × 7 (Sunday first)] }]`.
  - `levelTable(cur, cmp | null, prices) → [{ key, …totals, capacityShare, bookingShare, revenueShare, cmp: totals | null }]`.
  - `slotRanking(rows, prices, size = 10) → { count, top, bottom }` (slot = `{ weekday, start, level, dates, …totals }`).
  - `trend(cur, cmp, range, closed, prices) → { unit: 'week' | 'month', buckets: [{ from, to, occupancy, revenue, cmpOccupancy, cmpRevenue, closedDays }] }`.
  - `bookedAt(pace, leadMinutes) → number | null`, `curveAt(curve, days) → number | null`.
  - `pace(rows) → { ready, tracked, deep }` or, when ready, also `{ curves: { [levelKey]: number[8] }, weekday, weekend, sellOutLeadDays: { [levelKey]: days }, last24Share, released }`.
  - `upcoming(schedule, { now: Date, prices, levels, paceModel }) → { days: [{ date, occupancy, capacity, spotsSold, usual }], atRisk: [{ date, start, level, name, booked, capacity, hours, emptyValue }] }`.
  - `operations(rows, closed, range, levels) → { closed, blocked, blockedNames: [{ name, count }], cancelled, removed, events, overbooked, overbookedPeople }`.
  - `analyse({ rows, closed, range, levels, prices, schedule, now, index }) → { range, prices, kpis, split, heat, levels, slots, trend, pace, upcoming, ops, coverage: { first, sessions, snapshots, snapshotsSince } }`.

- [ ] **Step 1: Write the failing test** in `test/site/analytics.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate, analyse, bookedAt, curveAt, heatmap, levelKey, levelTable, operations, pace, priceOf,
  selectRows, slotRanking, trend, upcoming, weekSplit,
} from '../../site/lib/analytics.mjs';
import { periodRange } from '../../site/lib/history.mjs';
import { addDays } from '../../site/lib/time.mjs';

const PRICES = { reef: 360, reefHigh: 390, bayAdult: 250, bayKids: 195 };
const ALL = new Set();
// A plausible history row on Sunday 6.9.2026; override fields per test.
const row = (over = {}) => ({
  id: 1, date: '2026-09-06', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 10, booked: 5, final: true, pace: [], ...over,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('prices and level keys by area, level and age group', () => {
  assert.equal(priceOf(row(), PRICES), 360);
  assert.equal(priceOf(row({ level: 5 }), PRICES), 390);
  assert.equal(priceOf(row({ area: 'bay', level: 0 }), PRICES), 250);
  assert.equal(priceOf(row({ area: 'bay', level: 0, kids: true }), PRICES), 195);
  assert.deepEqual([levelKey(row()), levelKey(row({ area: 'bay', kids: true })), levelKey(row({ area: 'bay' }))], ['L3', 'bay-kids', 'bay-adult']);
});

test('aggregate caps overbooking for occupancy but counts every person for revenue', () => {
  const a = aggregate([row({ booked: 12 }), row({ booked: 5 }), row({ booked: 10 })], PRICES);
  assert.deepEqual(
    [a.sessions, a.capacity, a.spotsSold, a.people, a.revenue, a.emptyValue],
    [3, 30, 25, 27, 27 * 360, 5 * 360],
  );
  close(a.occupancy, 25 / 30);
  close(a.soldOutShare, 2 / 3);
  assert.deepEqual([aggregate([], PRICES).occupancy, aggregate([], PRICES).soldOutShare], [null, null]);
});

test('selectRows keeps counted sessions in the range that pass the level filter', () => {
  const rows = [
    row({ id: 1 }), row({ id: 2, kind: 'blocked' }), row({ id: 3, kind: 'lesson', area: 'bay', level: 0 }),
    row({ id: 4, date: '2026-09-20' }), row({ id: 5, kind: 'cancelled' }), row({ id: 6, kind: 'removed' }),
  ];
  const range = { from: '2026-09-01', to: '2026-09-10' };
  assert.deepEqual(selectRows(rows, range, ALL).map(r => r.id), [1, 3]);
  assert.deepEqual(selectRows(rows, range, new Set([0])).map(r => r.id), [3]);
});

test('heatmap needs 4 sessions in a cell', () => {
  const sundays = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map(date => row({ date }));
  const mondays = ['2026-08-17', '2026-08-24', '2026-08-31'].map(date => row({ date }));
  const [h] = heatmap([...sundays, ...mondays], PRICES);
  assert.equal(h.hour, '08');
  assert.equal(h.cells[0].sessions, 4);
  assert.equal(h.cells[1], null);
});

test('weekSplit puts Friday and Saturday in the weekend', () => {
  const s = weekSplit([row({ date: '2026-09-11' }), row({ date: '2026-09-12' }), row({ date: '2026-09-10' })], PRICES);
  assert.deepEqual([s.weekend.sessions, s.weekday.sessions], [2, 1]);
});

test('levelTable: shares of the whole, in level order, with the comparison when it ran', () => {
  const cur = [row({ level: 4, booked: 10 }), row({ level: 4, booked: 10 }), row({ area: 'bay', level: 0, kind: 'lesson', booked: 5 })];
  const cmp = [row({ level: 4, booked: 5 })];
  const t = levelTable(cur, cmp, PRICES);
  assert.deepEqual(t.map(l => l.key), ['bay-adult', 'L4']);
  const [bay, l4] = t;
  close(l4.capacityShare, 2 / 3);
  close(l4.bookingShare, 20 / 25);
  assert.equal(l4.cmp.sessions, 1);
  assert.equal(bay.cmp, null);
  assert.equal(levelTable(cur, null, PRICES)[1].cmp, null);
});

test('slotRanking needs 4 dates per slot and never lists a slot twice', () => {
  const dates = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'];
  const rows = [
    ...dates.map(date => row({ date, start: '08:00', booked: 9 })),
    ...dates.map(date => row({ date, start: '10:00', booked: 2 })),
    ...dates.slice(0, 3).map(date => row({ date, start: '12:00', booked: 10 })),
  ];
  const { count, top, bottom } = slotRanking(rows, PRICES, 1);
  assert.equal(count, 2);
  assert.deepEqual(top.map(s => [s.weekday, s.start, s.level, s.dates]), [[0, '08:00', 'L3', 4]]);
  assert.deepEqual(bottom.map(s => s.start), ['10:00']);
  assert.deepEqual(slotRanking(rows, PRICES).bottom, []); // 2 slots, 10 a side: all in "top"
});

test('trend: weekly up to 92 days, compared with the matching weeks; closed days counted', () => {
  const range = periodRange('30d', '2026-09-11', '2025-04-02'); // 12.8–10.9.2026 against 13.8–11.9.2025
  const cur = [row({ date: '2026-08-12', booked: 10 })];
  const cmp = [row({ date: '2025-08-13', booked: 5 })];
  const t = trend(cur, cmp, range, [{ date: '2026-08-14', text: 'סגור' }], PRICES);
  assert.equal(t.unit, 'week');
  assert.deepEqual(t.buckets.map(b => [b.from, b.to]), [
    ['2026-08-12', '2026-08-18'], ['2026-08-19', '2026-08-25'], ['2026-08-26', '2026-09-01'], ['2026-09-02', '2026-09-08'], ['2026-09-09', '2026-09-10'],
  ]);
  assert.deepEqual([t.buckets[0].occupancy, t.buckets[0].cmpOccupancy, t.buckets[0].closedDays], [1, 0.5, 1]);
  assert.deepEqual([t.buckets[1].occupancy, t.buckets[1].cmpOccupancy, t.buckets[1].cmpRevenue], [null, null, null]);
});

test('trend: monthly above 92 days, first and last months clipped to the range', () => {
  const t = trend([], [], { from: '2025-09-11', to: '2026-09-10', compare: null }, [], PRICES);
  assert.equal(t.unit, 'month');
  assert.equal(t.buckets.length, 13);
  assert.deepEqual([t.buckets[0].from, t.buckets[0].to, t.buckets[4].to], ['2025-09-11', '2025-09-30', '2026-01-31']);
  assert.deepEqual([t.buckets.at(-1).from, t.buckets.at(-1).to], ['2026-09-01', '2026-09-10']);
});

test('bookedAt reads the pace log as of a lead time; curveAt interpolates between lead points', () => {
  const log = [[20000, 1], [10000, 3], [1500, 6], [30, 8]];
  assert.equal(bookedAt(log, 7 * 1440), 1);
  assert.equal(bookedAt(log, 1440), 6);
  assert.equal(bookedAt(log, 0), 8);
  assert.equal(bookedAt(log, 30000), null);
  const curve = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]; // at 14, 10, 7, 5, 3, 2, 1, 0 days
  close(curveAt(curve, 4), 0.45);
  assert.deepEqual([curveAt(curve, 20), curveAt(curve, 0), curveAt(null, 3)], [0.1, 0.8, null]);
});

test('pace waits for 30 sessions seen a week ahead', () => {
  const rows = Array.from({ length: 29 }, (_, i) => row({ id: i, pace: [[8 * 1440, 1]] }));
  assert.deepEqual(pace([...rows, row({ id: 99, pace: [[600, 2]] }), row({ id: 100 })]), { ready: false, tracked: 30, deep: 29 });
});

test('pace: fill curves, sell-out lead, last-24h share and cancellations', () => {
  const log = [[14 * 1440, 2], [3 * 1440, 6], [600, 10]];
  const rows = Array.from({ length: 30 }, (_, i) => row({ id: i, level: 4, booked: 10, date: addDays('2026-08-02', i), pace: log }));
  const released = row({ id: 50, level: 2, booked: 4, pace: [[9 * 1440, 5], [2 * 1440, 3], [100, 6]] });
  const p = pace([...rows, released]);
  assert.equal(p.ready, true);
  assert.deepEqual(p.curves.L4.map(v => Math.round(v * 1000) / 1000), [0.2, 0.2, 0.2, 0.2, 0.6, 0.6, 0.6, 1]);
  assert.equal(p.curves.L2, undefined); // fewer than 5 sessions
  close(p.sellOutLeadDays.L4, 600 / 1440);
  close(p.last24Share, (30 * 4 + 1) / (30 * 10 + 4)); // L2: 3 booked a day ahead, 4 at the end
  assert.equal(p.released, 2 + 2); // 5 → 3 in the log, then 6 → 4 at the end
  assert.ok(p.weekday.length === 8 && p.weekend.length === 8);
});

test('upcoming: booked share per day, and sessions at risk in the next 48 hours', () => {
  const s = (over = {}) => ({ id: 1, start: '18:00', end: '19:00', name: 'L4', level: 4, area: 'reef', side: 'right', capacity: 18, booked: 2, spotsLeft: 16, available: true, blocked: false, ...over });
  const schedule = {
    days: [
      { date: '2026-09-11', sessions: [s({ id: 1, start: '08:00', end: '09:00', booked: 0 }), s({ id: 2 }), s({ id: 3, side: 'left', booked: 17 })] },
      { date: '2026-09-12', sessions: [
        s({ id: 4, start: '10:00', end: '11:30', area: 'bay', level: 0, name: 'שיעור ב Bay - בוגרים', capacity: 24, booked: 1 }),
        s({ id: 5, start: '11:00', end: '12:00', blocked: true, booked: 0 }),
      ] },
      { date: '2026-09-14', sessions: [s({ id: 6, start: '10:00', end: '11:00', level: 2, capacity: 20, booked: 0 })] },
    ],
  };
  const u = upcoming(schedule, { now: new Date('2026-09-11T13:00:00Z'), prices: PRICES, levels: ALL }); // 16:00 in Israel
  assert.deepEqual(u.days.map(d => [d.date, d.spotsSold, d.capacity, d.usual]), [
    ['2026-09-11', 19, 36, null], ['2026-09-12', 1, 24, null], ['2026-09-14', 0, 20, null],
  ]);
  assert.deepEqual(u.atRisk, [
    { date: '2026-09-11', start: '18:00', level: 'L4', name: 'L4', booked: 2, capacity: 18, hours: 2, emptyValue: 16 * 360 },
    { date: '2026-09-12', start: '10:00', level: 'bay-adult', name: 'שיעור ב Bay - בוגרים', booked: 1, capacity: 24, hours: 18, emptyValue: 23 * 250 },
  ]);
  assert.deepEqual(upcoming(schedule, { now: new Date('2026-09-11T13:00:00Z'), prices: PRICES, levels: new Set([2]) }).atRisk, []);
});

test('operations: closures, blocked events, cancellations, removals and overbooking in the period', () => {
  const rows = [
    row({ id: 1, kind: 'blocked', name: 'אירוע סגור' }), row({ id: 2, kind: 'blocked', name: 'אירוע סגור' }), row({ id: 3, kind: 'blocked', name: 'Private' }),
    row({ id: 4, kind: 'cancelled', capacity: 0 }), row({ id: 5, kind: 'removed' }), row({ id: 6, booked: 13 }),
    row({ id: 7, kind: 'blocked', date: '2026-10-01' }),
  ];
  const closed = [{ date: '2026-09-07', text: 'תחזוקה' }, { date: '2026-10-02', text: 'חג' }];
  const o = operations(rows, closed, { from: '2026-09-01', to: '2026-09-30' }, ALL);
  assert.deepEqual(o, {
    closed: [{ date: '2026-09-07', text: 'תחזוקה' }],
    blocked: 3, blockedNames: [{ name: 'אירוע סגור', count: 2 }, { name: 'Private', count: 1 }],
    cancelled: 1, removed: 1, events: 0, overbooked: 1, overbookedPeople: 3,
  });
});

test('analyse builds every section and counts the period for the coverage line', () => {
  const rows = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map((date, i) => row({ id: i, date }));
  const model = analyse({
    rows, closed: [], range: periodRange('30d', '2026-09-11', '2025-04-02'), levels: ALL, prices: PRICES,
    schedule: { days: [] }, now: new Date('2026-09-11T13:00:00Z'), index: { first: '2025-04-02', snapshots: 12, snapshotsSince: '2026-09-12' },
  });
  assert.deepEqual(Object.keys(model), ['range', 'prices', 'kpis', 'split', 'heat', 'levels', 'slots', 'trend', 'pace', 'upcoming', 'ops', 'coverage']);
  assert.deepEqual([model.kpis.cur.sessions, model.kpis.cur.daysOpen, model.kpis.cmp.sessions], [4, 4, 0]);
  assert.deepEqual(model.coverage, { first: '2025-04-02', sessions: 4, snapshots: 12, snapshotsSince: '2026-09-12' });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test test/site/analytics.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/analytics.mjs`.

- [ ] **Step 3: Write `site/lib/analytics.mjs`**

```js
// The analysis tab's numbers (analysis spec sections 3 and 6). Pure functions over history rows
// { id, date, start, end, level, area, side, kids, name, kind, capacity, booked, final, pace }.
import { addDays, dayOfWeek, daysBetween, israelInstant, monthsBetween } from './time.mjs';
import { classify, isKids } from './history.mjs';

export const LEVEL_KEYS = ['bay-adult', 'bay-kids', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
export const HEAT_MIN_SESSIONS = 4;
export const SLOT_MIN_DATES = 4;
export const WEEKLY_MAX_DAYS = 92;
export const PACE = { minSessions: 30, minLeadMinutes: 7 * 1440, leadDays: [14, 10, 7, 5, 3, 2, 1, 0], minGroup: 5, minSoldOut: 3 };
export const AT_RISK = { hours: 48, below: 0.4 };

export const levelKey = r => (r.area === 'bay' ? (r.kids ? 'bay-kids' : 'bay-adult') : `L${r.level}`);
export const isCounted = r => r.kind === 'surf' || r.kind === 'lesson';
export const isWeekend = date => dayOfWeek(date) >= 5; // Friday, Saturday
export const priceOf = (r, prices) =>
  r.area === 'bay' ? (r.kids ? prices.bayKids : prices.bayAdult) : r.level >= 5 ? prices.reefHigh : prices.reef;
/** The level filter: an empty set means every level; 0 selects both Bay groups. */
export const matchesLevels = (r, levels) => levels.size === 0 || levels.has(r.area === 'bay' ? 0 : r.level);
const inRange = (r, from, to) => r.date >= from && r.date <= to;
const share = (part, whole) => (whole ? part / whole : 0);
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const median = values => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
};

/** Totals over sessions. Occupancy caps overbooking at capacity; revenue counts every person. */
export function aggregate(rows, prices) {
  let capacity = 0, spotsSold = 0, people = 0, soldOut = 0, revenue = 0, emptyValue = 0;
  for (const r of rows) {
    const price = priceOf(r, prices);
    capacity += r.capacity;
    spotsSold += Math.min(r.booked, r.capacity);
    people += r.booked;
    if (r.booked >= r.capacity) soldOut += 1;
    revenue += r.booked * price;
    emptyValue += Math.max(0, r.capacity - r.booked) * price;
  }
  return {
    sessions: rows.length, capacity, spotsSold, people, revenue, emptyValue,
    occupancy: capacity ? spotsSold / capacity : null,
    soldOutShare: rows.length ? soldOut / rows.length : null,
  };
}

/** Counted sessions in a date range that pass the level filter. */
export const selectRows = (rows, { from, to }, levels) =>
  rows.filter(r => isCounted(r) && inRange(r, from, to) && matchesLevels(r, levels));

export function kpis(cur, cmp, { range, closed, prices }) {
  const block = (rows, from, to) => ({
    ...aggregate(rows, prices),
    daysOpen: new Set(rows.map(r => r.date)).size,
    closedDays: closed.filter(c => inRange(c, from, to)).length,
  });
  return {
    cur: block(cur, range.from, range.to),
    cmp: range.compare ? block(cmp, range.compare.from, range.compare.to) : null,
  };
}

/** Friday–Saturday against Sunday–Thursday. */
export const weekSplit = (rows, prices) => ({
  weekend: aggregate(rows.filter(r => isWeekend(r.date)), prices),
  weekday: aggregate(rows.filter(r => !isWeekend(r.date)), prices),
});

/** Start hour × weekday (0 = Sunday). A cell with fewer than 4 sessions is null. */
export function heatmap(rows, prices) {
  const groups = groupBy(rows, r => `${r.start.slice(0, 2)}|${dayOfWeek(r.date)}`);
  const hours = [...new Set(rows.map(r => r.start.slice(0, 2)))].sort();
  return hours.map(hour => ({
    hour,
    cells: [0, 1, 2, 3, 4, 5, 6].map(d => {
      const g = groups.get(`${hour}|${d}`) ?? [];
      return g.length >= HEAT_MIN_SESSIONS ? aggregate(g, prices) : null;
    }),
  }));
}

/** One row per level key that ran, with its share of capacity, bookings and revenue. */
export function levelTable(cur, cmp, prices) {
  const total = aggregate(cur, prices);
  return LEVEL_KEYS.flatMap(key => {
    const a = aggregate(cur.filter(r => levelKey(r) === key), prices);
    if (!a.sessions) return [];
    const b = cmp ? aggregate(cmp.filter(r => levelKey(r) === key), prices) : null;
    return [{
      key, ...a,
      capacityShare: share(a.capacity, total.capacity),
      bookingShare: share(a.spotsSold, total.spotsSold),
      revenueShare: share(a.revenue, total.revenue),
      cmp: b?.sessions ? b : null,
    }];
  });
}

/** Recurring slots (weekday + start + level key) that ran on at least 4 dates: strongest and weakest. */
export function slotRanking(rows, prices, size = 10) {
  const slots = [...groupBy(rows, r => `${dayOfWeek(r.date)}|${r.start}|${levelKey(r)}`)]
    .map(([k, g]) => {
      const [weekday, start, level] = k.split('|');
      return { weekday: Number(weekday), start, level, dates: new Set(g.map(r => r.date)).size, ...aggregate(g, prices) };
    })
    .filter(s => s.dates >= SLOT_MIN_DATES)
    .sort((a, b) => b.occupancy - a.occupancy || b.soldOutShare - a.soldOutShare || a.weekday - b.weekday || a.start.localeCompare(b.start));
  return {
    count: slots.length,
    top: slots.slice(0, size),
    bottom: slots.slice(Math.max(size, slots.length - size)).reverse(),
  };
}

const monthEnd = month => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

/** Weekly buckets up to 92 days, monthly above; each with the comparison range's matching bucket. */
export function trend(cur, cmp, range, closed, prices) {
  const weekly = daysBetween(range.from, range.to) + 1 <= WEEKLY_MAX_DAYS;
  const buckets = [];
  if (weekly) {
    for (let from = range.from; from <= range.to; from = addDays(from, 7)) {
      const end = addDays(from, 6);
      buckets.push({ from, to: end < range.to ? end : range.to });
    }
  } else {
    for (const m of monthsBetween(range.from, range.to)) {
      const from = `${m}-01` > range.from ? `${m}-01` : range.from;
      const end = monthEnd(m);
      buckets.push({ from, to: end < range.to ? end : range.to });
    }
  }
  const offset = range.compare ? daysBetween(range.compare.from, range.from) : 0;
  return {
    unit: weekly ? 'week' : 'month',
    buckets: buckets.map(({ from, to }) => {
      const a = aggregate(cur.filter(r => inRange(r, from, to)), prices);
      const c = range.compare ? aggregate(cmp.filter(r => inRange(r, addDays(from, -offset), addDays(to, -offset))), prices) : null;
      return {
        from, to,
        occupancy: a.occupancy, revenue: a.revenue,
        cmpOccupancy: c?.occupancy ?? null, cmpRevenue: c?.sessions ? c.revenue : null,
        closedDays: closed.filter(x => inRange(x, from, to)).length,
      };
    }),
  };
}

/** Booked as of `leadMinutes` before start: the last pace entry recorded at least that early, or null. */
export function bookedAt(pace, leadMinutes) {
  let booked = null;
  for (const [minutesBefore, count] of pace) {
    if (minutesBefore < leadMinutes) break;
    booked = count;
  }
  return booked;
}

/** A fill curve's value `days` before start, interpolated between the curve's lead points. */
export function curveAt(curve, days) {
  const leads = PACE.leadDays;
  if (!curve) return null;
  if (days >= leads[0]) return curve[0];
  for (let i = 0; i < leads.length - 1; i++) {
    const [hi, lo] = [leads[i], leads[i + 1]];
    if (days <= hi && days >= lo) {
      const [a, b] = [curve[i], curve[i + 1]];
      if (a === null || b === null) return a ?? b;
      return b + ((a - b) * (days - lo)) / (hi - lo);
    }
  }
  return curve.at(-1);
}

/** Fill speed from our snapshots (spec 6.7). Ready once 30 sessions were seen at least 7 days ahead. */
export function pace(rows) {
  const tracked = rows.filter(r => r.pace?.length);
  const deep = tracked.filter(r => r.pace[0][0] >= PACE.minLeadMinutes);
  const result = { ready: deep.length >= PACE.minSessions, tracked: tracked.length, deep: deep.length };
  if (!result.ready) return result;

  const curve = group => PACE.leadDays.map(d => {
    const values = group
      .map(r => {
        const b = bookedAt(r.pace, d * 1440);
        return b === null ? null : Math.min(b, r.capacity) / r.capacity;
      })
      .filter(v => v !== null);
    return values.length ? mean(values) : null;
  });
  const curves = {};
  const sellOutLeadDays = {};
  for (const [key, group] of groupBy(tracked, levelKey)) {
    if (group.length >= PACE.minGroup) curves[key] = curve(group);
    const leads = group.map(r => r.pace.find(([, b]) => b >= r.capacity)?.[0]).filter(m => m !== undefined);
    if (leads.length >= PACE.minSoldOut) sellOutLeadDays[key] = median(leads) / 1440;
  }
  const at24 = tracked.map(r => [r, bookedAt(r.pace, 1440)]).filter(([, b]) => b !== null);
  const lateSum = at24.reduce((n, [r, b]) => n + Math.max(0, r.booked - b), 0);
  const released = tracked.reduce((n, r) => {
    let drops = 0;
    for (let i = 1; i < r.pace.length; i++) drops += Math.max(0, r.pace[i - 1][1] - r.pace[i][1]);
    return n + drops + Math.max(0, r.pace.at(-1)[1] - r.booked);
  }, 0);
  return {
    ...result,
    curves,
    weekday: curve(tracked.filter(r => !isWeekend(r.date))),
    weekend: curve(tracked.filter(r => isWeekend(r.date))),
    sellOutLeadDays,
    last24Share: share(lateSum, at24.reduce((n, [r]) => n + r.booked, 0)),
    released,
  };
}

/** The published schedule ahead (spec 6.8): booked share per day, and sessions at risk. */
export function upcoming(schedule, { now, prices, levels, paceModel = null }) {
  const nowMs = now.getTime();
  const rows = schedule.days
    .flatMap(d => d.sessions.map(s => ({ ...s, date: d.date, kids: s.area === 'bay' && isKids(s.name), kind: classify(s) })))
    .filter(r => isCounted(r) && matchesLevels(r, levels) && israelInstant(r.date, r.end) > nowMs);
  const today = schedule.days[0]?.date;
  const days = [...groupBy(rows, r => r.date)].sort(([a], [b]) => a.localeCompare(b)).map(([date, g]) => {
    const a = aggregate(g, prices);
    const curve = paceModel?.ready ? (isWeekend(date) ? paceModel.weekend : paceModel.weekday) : null;
    const usual = curve && today ? curveAt(curve, daysBetween(today, date)) : null;
    return { date, occupancy: a.occupancy, capacity: a.capacity, spotsSold: a.spotsSold, usual };
  });
  const startsIn = r => (israelInstant(r.date, r.start) - nowMs) / 3600000;
  const risky = rows.filter(r => startsIn(r) > 0 && startsIn(r) <= AT_RISK.hours && Math.min(r.booked, r.capacity) / r.capacity < AT_RISK.below);
  const atRisk = [...groupBy(risky, r => `${r.date}|${r.start}|${levelKey(r)}`)]
    .map(([k, g]) => {
      const [date, start, level] = k.split('|');
      return {
        date, start, level, name: g[0].name,
        booked: g.reduce((n, r) => n + r.booked, 0),
        capacity: g.reduce((n, r) => n + r.capacity, 0),
        hours: Math.round(startsIn(g[0])),
        emptyValue: aggregate(g, prices).emptyValue,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { days, atRisk };
}

/** Capacity that wasn't for sale, and schedule changes, in a range (all kinds). */
export function operations(rows, closed, range, levels) {
  const inPeriod = rows.filter(r => inRange(r, range.from, range.to) && matchesLevels(r, levels));
  const ofKind = kind => inPeriod.filter(r => r.kind === kind);
  const counted = inPeriod.filter(isCounted);
  const names = [...groupBy(ofKind('blocked'), r => r.name)]
    .map(([name, g]) => ({ name, count: g.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    closed: closed.filter(c => inRange(c, range.from, range.to)),
    blocked: ofKind('blocked').length,
    blockedNames: names.slice(0, 3),
    cancelled: ofKind('cancelled').length,
    removed: ofKind('removed').length,
    events: ofKind('event').length,
    overbooked: counted.filter(r => r.booked > r.capacity).length,
    overbookedPeople: counted.reduce((n, r) => n + Math.max(0, r.booked - r.capacity), 0),
  };
}

/** Everything the analysis tab shows, for one period and level filter. */
export function analyse({ rows, closed, range, levels, prices, schedule, now, index = null }) {
  const cur = selectRows(rows, range, levels);
  const cmp = range.compare ? selectRows(rows, range.compare, levels) : [];
  const paceModel = pace(cur);
  return {
    range,
    prices,
    kpis: kpis(cur, cmp, { range, closed, prices }),
    split: weekSplit(cur, prices),
    heat: heatmap(cur, prices),
    levels: levelTable(cur, range.compare ? cmp : null, prices),
    slots: slotRanking(cur, prices),
    trend: trend(cur, cmp, range, closed, prices),
    pace: paceModel,
    upcoming: upcoming(schedule, { now, prices, levels, paceModel }),
    ops: operations(rows, closed, range, levels),
    coverage: { first: index?.first ?? null, sessions: cur.length, snapshots: index?.snapshots ?? 0, snapshotsSince: index?.snapshotsSince ?? null },
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/site/analytics.test.mjs`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/analytics.mjs test/site/analytics.test.mjs
git commit -m "feat: compute the analysis numbers from history"
```

---

### Task 7: "מה בולט" insights

**Files:**
- Create: `site/lib/insights.mjs`
- Test: `test/site/insights.test.mjs`

**Interfaces:**
- Consumes: an `analyse()` model (Task 6) — it reads `range.compare`, `kpis.cur/cmp`, `levels`, `split`, `heat`, `upcoming.atRisk`, `pace`; `HE_DAYS_SHORT` (`site/lib/time.mjs`).
- Produces (`site/lib/insights.mjs`), used by Tasks 8 and 10:
  - `MAX_INSIGHTS = 6`, `levelLabel(key) → 'Bay מבוגרים' | 'Bay ילדים' | 'L4' …`.
  - `insights(model, max = 6) → [{ rule, tone: 'bad' | 'good' | 'info', impact: number | null, text, link }]`, sorted by impact (₪) with `null` impacts last. Rules and thresholds exactly as the spec's table in section 6.9; `link` is one of `trend`, `levels`, `heat`, `upcoming`, `pace`.

- [ ] **Step 1: Write the failing test** in `test/site/insights.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insights } from '../../site/lib/insights.mjs';

// Plain totals in the shape aggregate() returns.
const totals = (over = {}) => ({
  sessions: 0, capacity: 0, spotsSold: 0, people: 0, revenue: 0, emptyValue: 0, occupancy: null, soldOutShare: null, ...over,
});
/** A model where nothing fires; override parts per test. avgPrice = revenue / people = ₪360. */
const model = (over = {}) => ({
  range: { compare: { kind: 'lastYear' } },
  kpis: { cur: totals({ sessions: 500, capacity: 1000, spotsSold: 600, people: 100, revenue: 36000, occupancy: 0.6 }), cmp: null },
  levels: [],
  split: { weekend: totals(), weekday: totals() },
  heat: [],
  upcoming: { atRisk: [] },
  pace: { ready: false },
  ...over,
});
const level = (key, over = {}) => ({ key, ...totals({ sessions: 100, occupancy: 0.7, soldOutShare: 0.2, revenue: 100000 }), cmp: null, ...over });
const rules = list => list.map(i => i.rule);

test('nothing fires on an unremarkable period', () => {
  assert.deepEqual(insights(model()), []);
});

test('trend fires at 3 points and explains it when supply and demand moved apart', () => {
  const [i] = insights(model({
    kpis: {
      cur: totals({ sessions: 3199, capacity: 51925, spotsSold: 35518, people: 35518, revenue: 12559995, occupancy: 0.684 }),
      cmp: totals({ sessions: 2885, capacity: 46160, spotsSold: 35274, people: 35274, revenue: 12654485, occupancy: 0.764 }),
    },
  }));
  assert.deepEqual([i.rule, i.tone, i.link], ['trend', 'bad', 'trend']);
  assert.equal(i.text, 'התפוסה ירדה ב־8 נקודות מאשתקד, מ־76% ל־68%. ההיצע גדל ב־12% וההזמנות כמעט לא השתנו.');

  const small = cmp => insights(model({ kpis: { cur: model().kpis.cur, cmp } }));
  assert.deepEqual(small(totals({ sessions: 500, capacity: 1000, spotsSold: 620, occupancy: 0.62 })), []); // 2 points
  assert.deepEqual(small(totals({ sessions: 99, capacity: 1000, spotsSold: 800, occupancy: 0.8 })), []); // too few sessions
  const prev = insights(model({ range: { compare: { kind: 'previous' } }, kpis: { cur: model().kpis.cur, cmp: totals({ sessions: 500, capacity: 1000, spotsSold: 500, occupancy: 0.5 }) } }));
  assert.equal(prev[0].text, 'התפוסה עלתה ב־10 נקודות מהתקופה הקודמת, מ־50% ל־60%. ההיצע כמעט לא השתנה וההזמנות גדלו ב־20%.');
});

test('level movers: the two biggest drops of 10+ points in one insight, gains in another', () => {
  const list = insights(model({
    levels: [
      level('L2', { occupancy: 0.59, cmp: totals({ sessions: 100, occupancy: 0.66, revenue: 90000 }) }),
      level('L3', { occupancy: 0.6, cmp: totals({ sessions: 100, occupancy: 0.8, revenue: 150000 }) }),
      level('L4', { occupancy: 0.71, cmp: totals({ sessions: 100, occupancy: 0.88, revenue: 120000 }) }),
      level('bay-adult', { occupancy: 0.61, cmp: totals({ sessions: 100, occupancy: 0.49, revenue: 80000 }) }),
      level('L6', { occupancy: 0.2, sessions: 19, cmp: totals({ sessions: 100, occupancy: 0.9 }) }),
    ],
  }));
  const drop = list.find(i => i.rule === 'level-drop');
  assert.equal(drop.text, 'הירידות הגדולות מאשתקד: L3 מ־80% ל־60%, L4 מ־88% ל־71%.');
  assert.equal(drop.impact, 50000 + 20000);
  assert.equal(list.find(i => i.rule === 'level-gain').text, 'עלייה מאשתקד: Bay מבוגרים מ־49% ל־61%.');
});

test('weekend gap of 10+ points is priced at the weekday capacity', () => {
  const [i] = insights(model({
    split: { weekend: totals({ sessions: 10, occupancy: 0.82 }), weekday: totals({ sessions: 10, capacity: 1000, occupancy: 0.63 }) },
  }));
  assert.equal(i.text, 'שישי־שבת מלאים ב־82%, ימי חול ב־63%. אם ימי החול היו מתמלאים כמו סוף השבוע, זה ₪68,400 נוספים.');
  const narrow = model({ split: { weekend: totals({ sessions: 10, occupancy: 0.72 }), weekday: totals({ sessions: 10, capacity: 1000, occupancy: 0.63 }) } });
  assert.deepEqual(insights(narrow), []);
});

test('undersupply from a 35% sell-out share; weak level below 50%; both need 20 sessions', () => {
  const list = insights(model({
    levels: [
      level('bay-kids', { soldOutShare: 0.35 }),
      level('L5', { soldOutShare: 0.34 }),
      level('L1', { occupancy: 0.49, emptyValue: 40000 }),
      level('L2', { occupancy: 0.5 }),
      level('L3', { occupancy: 0.3, sessions: 19 }),
    ],
  }));
  assert.deepEqual(rules(list), ['weak-level', 'undersupply']);
  assert.equal(list[0].text, 'L1 מתמלא רק ב־49%: ₪40,000 במקומות ריקים בתקופה.');
  assert.equal(list[1].text, 'Bay ילדים נמכר עד המקום האחרון ב־35% מהסשנים: הביקוש גבוה מההיצע, כדאי לשקול עוד סשנים.');
});

test('weak hours: the three Sunday–Thursday cells under 50% with the most empty value', () => {
  const cell = (occupancy, emptyValue, sessions = 12) => totals({ sessions, occupancy, emptyValue });
  const heat = [
    { hour: '09', cells: [cell(0.4, 900), cell(0.34, 1200), null, cell(0.4, 1000), cell(0.45, 100), cell(0.1, 9999), null] },
    { hour: '15', cells: [cell(0.3, 5000, 9), cell(0.6, 5000), null, null, null, null, null] },
  ];
  const [i] = insights(model({ heat }));
  assert.equal(i.text, 'השעות החלשות: ב׳ 09:00 (34%), ד׳ 09:00 (40%), א׳ 09:00 (40%). יחד ₪3,100 במקומות ריקים.');
});

test('at-risk sessions, singular and plural', () => {
  const risk = n => insights(model({ upcoming: { atRisk: Array.from({ length: n }, () => ({ emptyValue: 1000 })) } }))[0].text;
  assert.equal(risk(1), 'סשן אחד ב־48 השעות הקרובות מלא בפחות מ־40%: ₪1,000 פתוחים למכירה.');
  assert.equal(risk(17), '17 סשנים ב־48 השעות הקרובות מלאים בפחות מ־40%: ₪17,000 פתוחים למכירה.');
});

test('fill-speed rules need a ready pace model and come after the priced insights', () => {
  const ready = { ready: true, sellOutLeadDays: { L5: 4.2, L2: 1 }, last24Share: 0.45 };
  const list = insights(model({ pace: ready, upcoming: { atRisk: [{ emptyValue: 10 }] } }));
  assert.deepEqual(rules(list), ['at-risk', 'early-sellout', 'late-demand']);
  assert.equal(list[1].text, 'L5 נמכר עד הסוף בדרך כלל 4 ימים מראש.');
  assert.equal(list[2].text, '45% מההזמנות מגיעות ב־24 השעות האחרונות.');
  assert.deepEqual(insights(model({ pace: { ...ready, ready: false } })), []);
});

test('at most six insights, the largest impact first', () => {
  const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'bay-adult'].map((key, i) => level(key, { occupancy: 0.4, emptyValue: (i + 1) * 1000 }));
  const list = insights(model({ levels }));
  assert.equal(list.length, 6);
  assert.deepEqual(list.map(i => i.impact), [7000, 6000, 5000, 4000, 3000, 2000]);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test test/site/insights.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/insights.mjs`.

- [ ] **Step 3: Write `site/lib/insights.mjs`**

```js
// "מה בולט": fixed rules over an analyse() model (analysis spec section 6.9). Each rule fires only
// under its condition; fired insights are sorted by impact in ₪, rules without a ₪ value last.
import { HE_DAYS_SHORT } from './time.mjs';

export const MAX_INSIGHTS = 6;
const MIN_SESSIONS = 20;

const points = x => Math.round(x * 100);
const shekels = n => `₪${Math.round(n).toLocaleString('en-US')}`;
export const levelLabel = key => (key === 'bay-adult' ? 'Bay מבוגרים' : key === 'bay-kids' ? 'Bay ילדים' : key);
const against = compare => (compare?.kind === 'lastYear' ? 'מאשתקד' : 'מהתקופה הקודמת');
const change = (a, b) => (b ? a / b - 1 : 0);

export function insights(model, max = MAX_INSIGHTS) {
  const { kpis, levels, split, heat, upcoming, pace, range } = model;
  const { cur, cmp } = kpis;
  const avgPrice = cur.people ? cur.revenue / cur.people : 0;
  const out = [];

  if (cmp && cmp.sessions >= 100 && cur.occupancy !== null && cmp.occupancy !== null) {
    const d = points(cur.occupancy) - points(cmp.occupancy);
    if (Math.abs(d) >= 3) {
      const dCap = points(change(cur.capacity, cmp.capacity));
      const dBook = points(change(cur.spotsSold, cmp.spotsSold));
      const bookings = Math.abs(dBook) <= 2 ? 'כמעט לא השתנו' : dBook > 0 ? `גדלו ב־${dBook}%` : `ירדו ב־${-dBook}%`;
      const supply = Math.abs(dCap) <= 2 ? 'כמעט לא השתנה' : dCap > 0 ? `גדל ב־${dCap}%` : `קטן ב־${-dCap}%`;
      const why = Math.abs(dCap - dBook) >= 5 ? ` ההיצע ${supply} וההזמנות ${bookings}.` : '';
      out.push({
        rule: 'trend', tone: d < 0 ? 'bad' : 'good', link: 'trend',
        impact: Math.abs(cur.occupancy - cmp.occupancy) * cur.capacity * avgPrice,
        text: `התפוסה ${d < 0 ? 'ירדה' : 'עלתה'} ב־${Math.abs(d)} נקודות ${against(range.compare)}, מ־${points(cmp.occupancy)}% ל־${points(cur.occupancy)}%.${why}`,
      });
    }
  }

  const movers = levels
    .filter(l => l.cmp && l.sessions >= MIN_SESSIONS && l.cmp.sessions >= MIN_SESSIONS)
    .map(l => ({ ...l, d: points(l.occupancy) - points(l.cmp.occupancy) }));
  const moved = (list, tone, title) => {
    if (!list.length) return;
    out.push({
      rule: tone === 'bad' ? 'level-drop' : 'level-gain', tone, link: 'levels',
      impact: list.reduce((n, l) => n + Math.abs(l.revenue - l.cmp.revenue), 0),
      text: `${title} ${against(range.compare)}: ${list.map(l => `${levelLabel(l.key)} מ־${points(l.cmp.occupancy)}% ל־${points(l.occupancy)}%`).join(', ')}.`,
    });
  };
  const drops = movers.filter(l => l.d <= -10).sort((a, b) => a.d - b.d).slice(0, 2);
  const gains = movers.filter(l => l.d >= 10).sort((a, b) => b.d - a.d).slice(0, 2);
  moved(drops, 'bad', drops.length > 1 ? 'הירידות הגדולות' : 'הירידה הגדולה');
  moved(gains, 'good', 'עלייה');

  const { weekend, weekday } = split;
  if (weekend.sessions && weekday.sessions && points(weekend.occupancy) - points(weekday.occupancy) >= 10) {
    const extra = (weekend.occupancy - weekday.occupancy) * weekday.capacity * avgPrice;
    out.push({
      rule: 'weekend', tone: 'info', link: 'heat', impact: extra,
      text: `שישי־שבת מלאים ב־${points(weekend.occupancy)}%, ימי חול ב־${points(weekday.occupancy)}%. אם ימי החול היו מתמלאים כמו סוף השבוע, זה ${shekels(extra)} נוספים.`,
    });
  }

  for (const l of levels) {
    if (l.sessions >= MIN_SESSIONS && l.soldOutShare >= 0.35) {
      out.push({
        rule: 'undersupply', tone: 'good', link: 'levels', impact: l.revenue * l.soldOutShare,
        text: `${levelLabel(l.key)} נמכר עד המקום האחרון ב־${points(l.soldOutShare)}% מהסשנים: הביקוש גבוה מההיצע, כדאי לשקול עוד סשנים.`,
      });
    }
    if (l.sessions >= MIN_SESSIONS && l.occupancy < 0.5) {
      out.push({
        rule: 'weak-level', tone: 'bad', link: 'levels', impact: l.emptyValue,
        text: `${levelLabel(l.key)} מתמלא רק ב־${points(l.occupancy)}%: ${shekels(l.emptyValue)} במקומות ריקים בתקופה.`,
      });
    }
  }

  const weak = heat
    .flatMap(row => row.cells.slice(0, 5).map((c, d) => (c && c.sessions >= 10 && c.occupancy < 0.5 ? { ...c, d, hour: row.hour } : null)))
    .filter(Boolean)
    .sort((a, b) => b.emptyValue - a.emptyValue)
    .slice(0, 3);
  if (weak.length) {
    const total = weak.reduce((n, c) => n + c.emptyValue, 0);
    out.push({
      rule: 'weak-hours', tone: 'bad', link: 'heat', impact: total,
      text: `השעות החלשות: ${weak.map(c => `${HE_DAYS_SHORT[c.d]} ${c.hour}:00 (${points(c.occupancy)}%)`).join(', ')}. יחד ${shekels(total)} במקומות ריקים.`,
    });
  }

  const risk = upcoming.atRisk;
  if (risk.length) {
    const open = risk.reduce((n, s) => n + s.emptyValue, 0);
    out.push({
      rule: 'at-risk', tone: 'bad', link: 'upcoming', impact: open,
      text: risk.length === 1
        ? `סשן אחד ב־48 השעות הקרובות מלא בפחות מ־40%: ${shekels(open)} פתוחים למכירה.`
        : `${risk.length} סשנים ב־48 השעות הקרובות מלאים בפחות מ־40%: ${shekels(open)} פתוחים למכירה.`,
    });
  }

  if (pace.ready) {
    for (const [key, days] of Object.entries(pace.sellOutLeadDays)) {
      if (days >= 3) {
        out.push({ rule: 'early-sellout', tone: 'good', link: 'pace', impact: null, text: `${levelLabel(key)} נמכר עד הסוף בדרך כלל ${Math.round(days)} ימים מראש.` });
      }
    }
    if (pace.last24Share >= 0.4) {
      out.push({ rule: 'late-demand', tone: 'info', link: 'pace', impact: null, text: `${points(pace.last24Share)}% מההזמנות מגיעות ב־24 השעות האחרונות.` });
    }
  }

  return out.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1)).slice(0, max);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/site/insights.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/insights.mjs test/site/insights.test.mjs
git commit -m "feat: add the insight rules"
```

---

### Task 8: Analysis tab HTML

**Files:**
- Create: `site/lib/render-analysis.mjs`
- Test: `test/site/render-analysis.test.mjs`

**Interfaces:**
- Consumes: an `analyse()` model and an `insights()` list; `HE_DAYS`, `HE_DAYS_SHORT`, `addDays`, `dayOfWeek`, `shortDate` (`time.mjs`); `PERIODS` (`history.mjs`); `PACE` (`analytics.mjs`); `escapeHtml` (`render.mjs`).
- Produces (`site/lib/render-analysis.mjs`), used by Task 10:
  - `pct(x) → '68%' | '–'`, `money(n) → '<span class="ltr num">₪12.6M</span>'` (M / K / full).
  - `renderPeriods(current) → string` — four `<button data-period="…" aria-pressed="…">` buttons.
  - `compareNote(range) → string` — the line under the filters.
  - `renderAnalysis(model, insightList, { heatMetric: 'occupancy' | 'soldOutShare' | 'revenue', trendMetric: 'occupancy' | 'revenue' }) → string` — nine `<section class="sec" id="a-…">` blocks: `kpis, insights, heat, levels, slots, trend, pace, upcoming, ops`. Interactive elements: `data-heat-metric`, `data-trend-metric`, `data-jump`.

- [ ] **Step 1: Write the failing test** in `test/site/render-analysis.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../site/lib/analytics.mjs';
import { periodRange } from '../../site/lib/history.mjs';
import { insights } from '../../site/lib/insights.mjs';
import { compareNote, money, renderAnalysis, renderPeriods } from '../../site/lib/render-analysis.mjs';
import { addDays } from '../../site/lib/time.mjs';

const PRICES = { reef: 360, reefHigh: 390, bayAdult: 250, bayKids: 195 };
const UI = { heatMetric: 'occupancy', trendMetric: 'occupancy' };
const count = (html, needle) => html.split(needle).length - 1;
const row = (over = {}) => ({
  id: 1, date: '2026-09-06', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 10, booked: 3, final: true, pace: [], ...over,
});

/** 12 weeks of a weak Sunday 08:00 L3 and a full Friday 17:00 L5, plus a blocked private event. */
function history() {
  const rows = [];
  for (let w = 0; w < 12; w++) {
    const sunday = addDays('2026-06-14', w * 7);
    rows.push(row({ id: rows.length + 1, date: sunday }));
    rows.push(row({ id: rows.length + 1, date: addDays(sunday, 5), start: '17:00', end: '18:00', level: 5, capacity: 15, booked: 15 }));
  }
  rows.push(row({ id: 99, kind: 'blocked', name: '<b>אירוע</b>' }));
  return rows;
}

/** 10 nearly empty sessions in the next 48 hours, each its own at-risk slot. */
function schedule() {
  const s = (date, hour, id) => ({
    id, start: `${hour}:00`, end: `${hour}:59`, name: 'L4 <x>', level: 4, area: 'reef', side: 'right',
    capacity: 18, booked: 1, spotsLeft: 17, available: true, blocked: false,
  });
  return {
    days: [
      { date: '2026-09-11', sessions: ['17', '18', '19', '20', '21'].map((h, i) => s('2026-09-11', h, 900 + i)) },
      { date: '2026-09-12', sessions: ['08', '09', '10', '11', '12'].map((h, i) => s('2026-09-12', h, 910 + i)) },
    ],
  };
}

const model = () => analyse({
  rows: history(), closed: [{ date: '2026-07-01', text: 'תחזוקה' }], range: periodRange('90d', '2026-09-11', '2025-04-02'),
  levels: new Set(), prices: PRICES, schedule: schedule(), now: new Date('2026-09-11T13:00:00Z'),
  index: { first: '2025-04-02', snapshots: 3, snapshotsSince: '2026-09-10' },
});

test('money: millions, thousands, and small amounts', () => {
  assert.equal(money(12559995), '<span class="ltr num">₪12.6M</span>');
  assert.equal(money(317710), '<span class="ltr num">₪318K</span>');
  assert.equal(money(8500), '<span class="ltr num">₪8,500</span>');
});

test('period buttons and the comparison line', () => {
  const buttons = renderPeriods('90d');
  assert.equal(count(buttons, 'data-period="'), 4);
  assert.ok(buttons.includes('<button data-period="90d" aria-pressed="true">90 יום</button>'));
  const note = compareNote(periodRange('90d', '2026-09-11', '2025-04-02'));
  assert.ok(note.includes('<span class="ltr num">13.6.2026–10.9.2026</span>'));
  assert.ok(note.includes('אותם שבועות אשתקד') && note.includes('14.6.2025–11.9.2025'));
  assert.ok(compareNote(periodRange('all', '2026-09-11', '2025-04-02')).includes('אין להיסטוריה תקופה קודמת'));
});

test('renderAnalysis: nine sections in order, the numbers, and escaped park text', () => {
  const m = model();
  const html = renderAnalysis(m, insights(m), UI);
  const ids = [...html.matchAll(/<section class="sec" id="a-([a-z]+)"/g)].map(x => x[1]);
  assert.deepEqual(ids, ['kpis', 'insights', 'heat', 'levels', 'slots', 'trend', 'pace', 'upcoming', 'ops']);
  assert.ok(html.includes('<span class="v num">72%</span>')); // (12×3 + 12×15) of (12×10 + 12×15)
  assert.ok(html.includes('אין נתון להשוואה')); // no sessions a year earlier
  assert.ok(html.includes('class="c s5 num"')); // Friday 17:00 is full
  assert.ok(html.includes('מלא ב־100%'));
  assert.ok(html.includes('שישי־שבת מלאים ב־100%') && html.includes('data-jump="heat"'));
  assert.ok(html.includes('&lt;b&gt;אירוע&lt;/b&gt; ×1') && !html.includes('<b>אירוע'));
  assert.ok(html.includes('L4 &lt;x&gt;') && !html.includes('L4 <x>'));
  assert.ok(html.includes('1.7 תחזוקה'));
  assert.ok(html.includes('(ריף L1–L4 360 ₪, L5–L6 390 ₪, Bay מבוגרים 250 ₪, Bay ילדים 195 ₪)'));
});

test('renderAnalysis: collecting card before pace is ready, and the at-risk overflow in a details box', () => {
  const html = renderAnalysis(model(), [], UI);
  assert.ok(html.includes('אוספים נתונים') && html.includes('3 צילומי מצב') && html.includes('בערך ב־24.9'));
  assert.equal(count(html, '<div class="rrow">'), 10);
  assert.ok(html.includes('<details class="more"><summary>ועוד 3 סשנים</summary>'));
  assert.ok(html.includes('אין מסקנות בולטות'));
});

test('renderAnalysis: the heat and trend switches change what is drawn', () => {
  const html = renderAnalysis(model(), [], { heatMetric: 'revenue', trendMetric: 'revenue' });
  assert.ok(html.includes('data-heat-metric="revenue" aria-pressed="true"'));
  assert.ok(html.includes('data-trend-metric="revenue" aria-pressed="true"'));
  assert.match(html, /class="c s\d num" title="[^"]*">\d+K<\/div>/);
  assert.ok(html.includes('aria-label="הכנסה לפי שבוע"'));
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test test/site/render-analysis.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/render-analysis.mjs`.

- [ ] **Step 3: Write `site/lib/render-analysis.mjs`**

```js
// HTML for the analysis tab (analysis spec section 7). Pure functions returning strings.
// Park text (session names, closure reasons) is escaped before it reaches the HTML.
import { HE_DAYS, HE_DAYS_SHORT, addDays, dayOfWeek, shortDate } from './time.mjs';
import { PERIODS } from './history.mjs';
import { PACE } from './analytics.mjs';
import { levelLabel } from './insights.mjs';
import { escapeHtml } from './render.mjs';

const PERIOD_LABELS = { '30d': '30 יום', '90d': '90 יום', '12m': '12 חודשים', all: 'הכול' };
const HEAT_STEPS = { occupancy: [0.4, 0.55, 0.7, 0.85, 0.95], soldOutShare: [0.1, 0.25, 0.4, 0.6, 0.8], revenue: [0.2, 0.4, 0.6, 0.8, 0.95] };
const AT_RISK_SHOWN = 7;
const LINKS = { trend: 'למגמה', levels: 'לטבלת הרמות', heat: 'למפת העומס', upcoming: 'לימים הקרובים', pace: 'לקצב ההזמנות' };

export const pct = x => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const int = n => Math.round(n).toLocaleString('en-US');
/** ₪12.6M, ₪318K or ₪8,500, in a left-to-right isolate. */
export const money = n =>
  `<span class="ltr num">${n >= 1e6 ? `₪${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `₪${Math.round(n / 1e3)}K` : `₪${int(n)}`}</span>`;
const fullDate = iso => `${shortDate(iso)}.${iso.slice(0, 4)}`;
const dates = (from, to) => `<span class="ltr num">${fullDate(from)}–${fullDate(to)}</span>`;
const levelChip = key => (key.startsWith('bay') ? '<span class="chip lv0">Bay</span>' : `<span class="chip lv${key.slice(1)}">${key}</span>`);
const levelNote = key => (key === 'bay-adult' ? 'מבוגרים' : key === 'bay-kids' ? 'ילדים' : '');
const levelCell = key => `<span class="lvcell">${levelChip(key)}<small>${levelNote(key)}</small></span>`;
const empty = text => `<p class="empty">${text}</p>`;
const section = (id, title, sub, body, tools = '') =>
  `<section class="sec" id="a-${id}"><div class="sec-head"><div><h2>${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>${tools}</div>${body}</section>`;
const seg = (attr, options, current) =>
  `<div class="seg sm">${options.map(([value, label]) => `<button data-${attr}="${value}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`;

/** The period switch buttons. */
export const renderPeriods = current =>
  Object.keys(PERIODS).map(p => `<button data-period="${p}" aria-pressed="${p === current}">${PERIOD_LABELS[p]}</button>`).join('');

/** The line under the filters naming the period and what it's compared with. */
export function compareNote(range) {
  const shown = `מציג <b>${dates(range.from, range.to)}</b> (עד אתמול)`;
  if (!range.compare) return `${shown}. אין להיסטוריה תקופה קודמת להשוואה.`;
  const what = range.compare.kind === 'lastYear' ? 'אותם שבועות אשתקד' : 'התקופה הקודמת';
  return `${shown} בהשוואה ל־<b>${what}</b>, ${dates(range.compare.from, range.compare.to)}`;
}

// ---------- 1. KPIs ----------

function delta(cur, cmp, { ratio, lowerIsBetter = false, format, label }) {
  if (cmp === null || cmp === undefined || cur === null) return `<div class="d"><span class="ly">אין נתון להשוואה</span></div>`;
  const diff = ratio ? Math.round(cur * 100) - Math.round(cmp * 100) : cmp ? Math.round((cur / cmp - 1) * 100) : 0;
  const bad = diff !== 0 && (lowerIsBetter ? diff > 0 : diff < 0);
  const arrow = diff === 0 ? '=' : diff > 0 ? '▲' : '▼';
  return `<div class="d${bad ? ' bad' : ''}"><span class="ar">${arrow} ${Math.abs(diff)}${ratio ? ' נק׳' : '%'}</span> <span class="ly">· ${label} ${format(cmp)}</span></div>`;
}

function kpiSection(model) {
  const { cur, cmp } = model.kpis;
  const p = model.prices;
  const label = model.range.compare?.kind === 'lastYear' ? 'אשתקד' : 'בתקופה הקודמת';
  const d = (key, opts) => delta(cur[key], cmp ? cmp[key] : null, { label, ...opts });
  const tiles = [
    ['lead', 'תפוסה', `<span class="v num">${pct(cur.occupancy)}</span>`, d('occupancy', { ratio: true, format: pct })],
    ['', 'מקומות שנמכרו', `<span class="v num">${int(cur.spotsSold)}</span>`, d('spotsSold', { format: int })],
    ['', 'הכנסה משוערת', `<span class="v">${money(cur.revenue)}</span>`, d('revenue', { format: money })],
    ['', 'סשנים שנמכרו עד הסוף', `<span class="v num">${pct(cur.soldOutShare)}</span>`, d('soldOutShare', { ratio: true, format: pct })],
    ['', 'שווי מקומות ריקים', `<span class="v">${money(cur.emptyValue)}</span>`, d('emptyValue', { lowerIsBetter: true, format: money })],
    ['', 'ימי פעילות', `<span class="v num">${cur.daysOpen}</span>`,
      `<div class="d"><span class="ly">${cur.closedDays ? `${cur.closedDays} ימים סגורים` : 'בלי ימים סגורים'} · ${int(cur.capacity)} מקומות</span></div>`],
  ];
  const body = `<div class="kpis">${tiles.map(([cls, k, v, dd]) => `<div class="card kpi${cls ? ` ${cls}` : ''}"><span class="k">${k}</span>${v}${dd}</div>`).join('')}</div>`
    + `<p class="foot">הכנסה ושווי מקומות ריקים הם הערכה לפי מחירון (ריף L1–L4 ${p.reef} ₪, L5–L6 ${p.reefHigh} ₪, Bay מבוגרים ${p.bayAdult} ₪, Bay ילדים ${p.bayKids} ₪), בלי כרטיסיות, מנויים והנחות. התפוסה והמקומות לא כוללים אירועים פרטיים וסשנים שבוטלו.</p>`;
  return `<section class="sec" id="a-kpis">${body}</section>`;
}

// ---------- 2. insights ----------

function insightSection(list) {
  const body = list.length
    ? `<ol class="ins">${list.map((i, n) => `<li class="card ${i.tone}"><span class="n num">${n + 1}</span><span class="t">${escapeHtml(i.text)}</span><span class="m">${i.impact === null ? '' : `<span>השפעה: ${money(i.impact)}</span>`}<button data-jump="${i.link}">${LINKS[i.link]} ←</button></span></li>`).join('')}</ol>`
    : empty('אין מסקנות בולטות בתקופה הזו.');
  return section('insights', 'מה בולט', 'מסקנות אוטומטיות מהתקופה שנבחרה, מהחשובה ביותר. כל אחת מבוססת על לפחות 20 סשנים.', body);
}

// ---------- 3. heatmap ----------

function heatSection(model, metric) {
  const heat = model.heat;
  const tools = seg('heat-metric', [['occupancy', 'תפוסה'], ['soldOutShare', 'נמכרו עד הסוף'], ['revenue', 'הכנסה']], metric);
  const sub = 'כל משבצת: כל הסשנים שהתחילו באותו יום ושעה בתקופה. משבצת ריקה: פחות מ־4 סשנים.';
  if (!heat.length) return section('heat', 'מתי עמוס', sub, empty('אין מספיק נתונים בתקופה.'), tools);
  const max = Math.max(...heat.flatMap(r => r.cells.filter(Boolean).map(c => c.revenue)), 1);
  const value = c => (metric === 'revenue' ? c.revenue / max : c[metric]);
  const step = c => HEAT_STEPS[metric].filter(t => value(c) >= t).length;
  const label = c => (metric === 'revenue' ? `${Math.round(c.revenue / 1000)}K` : pct(c[metric]));
  const head = `<div></div>${HE_DAYS.map((_, i) => `<div class="hd"><b>${HE_DAYS_SHORT[i]}</b>${i >= 5 ? 'סופ״ש' : ''}</div>`).join('')}`;
  const rows = heat.map(r => `<div class="hr num">${r.hour}:00</div>${r.cells.map((c, d) => (c
    ? `<div class="c s${step(c)} num" title="${HE_DAYS[d]} ${r.hour}:00 · ${c.sessions} סשנים · תפוסה ${pct(c.occupancy)} · נמכרו עד הסוף ${pct(c.soldOutShare)}">${label(c)}</div>`
    : '<div class="c x" title="פחות מ־4 סשנים"></div>')).join('')}`).join('');
  const scale = `<div class="scale"><span>נמוך</span>${[0, 1, 2, 3, 4, 5].map(s => `<i class="c s${s}"></i>`).join('')}<span>גבוה</span></div>`;
  return section('heat', 'מתי עמוס', sub, `<div class="card heat-wrap"><div class="heat">${head}${rows}</div>${scale}</div>`, tools);
}

// ---------- 4. levels ----------

function levelSection(model) {
  const sub = 'לפי רמה. הקו הכתום על פס התפוסה הוא התפוסה בתקופת ההשוואה.';
  if (!model.levels.length) return section('levels', 'מה נמכר', sub, empty('אין סשנים בתקופה.'));
  const rows = model.levels.map(l => {
    const d = l.cmp ? Math.round(l.occupancy * 100) - Math.round(l.cmp.occupancy * 100) : null;
    const tick = l.cmp ? `<u style="inset-inline-start:${Math.round(l.cmp.occupancy * 100)}%" title="השוואה ${pct(l.cmp.occupancy)}"></u>` : '';
    return `<tr><td>${levelCell(l.key)}</td><td class="num">${int(l.sessions)}</td>`
      + `<td><div class="occ"><div class="bar"><i style="width:${Math.round(l.occupancy * 100)}%"></i>${tick}</div><span class="num">${pct(l.occupancy)}</span></div></td>`
      + `<td class="dlt num${d !== null && d <= -10 ? ' bad' : ''}">${d === null ? '–' : `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} נק׳`}</td>`
      + `<td class="num">${pct(l.soldOutShare)}</td><td>${money(l.revenue)} <small class="num">(${pct(l.revenueShare)})</small></td>`
      + `<td><div class="sd" title="חלק מהמקומות ${pct(l.capacityShare)} · חלק מההזמנות ${pct(l.bookingShare)}"><div class="cap" style="width:${Math.min(100, Math.round(l.capacityShare * 300))}%"></div><div class="bk" style="width:${Math.min(100, Math.round(l.bookingShare * 300))}%"></div></div></td></tr>`;
  }).join('');
  const table = `<div class="card tbl-scroll"><table class="tbl"><thead><tr><th>רמה</th><th>סשנים</th><th>תפוסה</th><th>שינוי</th><th>נמכרו עד הסוף</th><th>הכנסה משוערת</th><th>היצע מול ביקוש</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return section('levels', 'מה נמכר', sub, `${table}<p class="foot">״היצע מול ביקוש״: הפס האפור הוא החלק של הרמה מכל המקומות בפארק, והכהה הוא החלק שלה מכל ההזמנות. כהה ארוך מאפור: הרמה מבוקשת יותר ממה שמוקצה לה.</p>`);
}

// ---------- 5. slots ----------

function slotRows(list) {
  return list.map((s, i) => `<div class="slot"><span class="rk num">${i + 1}</span><span class="wh">${HE_DAYS[s.weekday]} <span class="ltr num">${s.start}</span></span>${levelCell(s.level)}`
    + `<div class="occ"><div class="bar"><i style="width:${Math.round(s.occupancy * 100)}%"></i></div><span class="num">${pct(s.occupancy)}</span></div>`
    + `<span class="v">${s.soldOutShare >= 0.5 ? `מלא ב־${pct(s.soldOutShare)}` : `${money(s.emptyValue)} ריק`}</span></div>`).join('');
}

function slotSection(model) {
  const { count, top, bottom } = model.slots;
  const sub = 'סשנים קבועים (יום, שעה ורמה) שרצו לפחות 4 פעמים בתקופה.';
  if (!count) return section('slots', 'הסשנים הכי חזקים והכי חלשים', sub, empty('אין סשנים קבועים שרצו לפחות 4 פעמים בתקופה.'));
  const weakest = bottom.length ? `<div class="card"><h3>הכי חלשים<small>מועמדים לשינוי רמה, שעה או מבצע</small></h3>${slotRows(bottom)}</div>` : '';
  return section('slots', 'הסשנים הכי חזקים והכי חלשים', sub,
    `<div class="slots"><div class="card"><h3>הכי מבוקשים<small>מועמדים להוספת סשן</small></h3>${slotRows(top)}</div>${weakest}</div>`);
}

// ---------- 6. trend ----------

function trendChart(buckets, unit, metric) {
  const W = 700, H = 210, L = 44, R = 8, T = 12, B = 34;
  const cur = b => (metric === 'revenue' ? b.revenue : b.occupancy);
  const cmp = b => (metric === 'revenue' ? b.cmpRevenue : b.cmpOccupancy);
  const top = metric === 'revenue' ? Math.max(1, ...buckets.map(b => Math.max(cur(b) ?? 0, cmp(b) ?? 0))) : 1;
  const bw = (W - L - R) / buckets.length;
  const y = v => T + (1 - v / top) * (H - T - B);
  const x = i => W - R - (i + 1) * bw; // time runs right to left, like the week view
  const tickLabel = v => (metric === 'revenue' ? (v >= 1e6 ? `₪${(v / 1e6).toFixed(1)}M` : `₪${Math.round(v / 1e3)}K`) : `${Math.round(v * 100)}%`);
  const every = Math.ceil(buckets.length / 7);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'revenue' ? 'הכנסה' : 'תפוסה'} לפי ${unit === 'week' ? 'שבוע' : 'חודש'}">`;
  for (const g of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g * top)}" y2="${y(g * top)}" class="grid"/><text x="${L - 6}" y="${y(g * top) + 4}" text-anchor="end">${tickLabel(g * top)}</text>`;
  buckets.forEach((b, i) => {
    const v = cur(b);
    if (v !== null) s += `<rect x="${x(i) + 3}" y="${y(v)}" width="${Math.max(1, bw - 6)}" height="${y(0) - y(v)}" rx="3" class="bar-cur"><title>${fullDate(b.from)}: ${metric === 'revenue' ? tickLabel(v) : pct(v)}</title></rect>`;
    if (b.closedDays) s += `<line x1="${x(i) + 3}" x2="${x(i) + bw - 3}" y1="${H - B + 5}" y2="${H - B + 5}" class="closed-mark"/>`;
    if (i % every === 0) s += `<text x="${x(i) + bw / 2}" y="${H - 12}" text-anchor="middle">${unit === 'week' ? shortDate(b.from) : `${Number(b.from.slice(5, 7))}.${b.from.slice(2, 4)}`}</text>`;
  });
  const line = buckets.map((b, i) => (cmp(b) === null ? null : `${x(i) + bw / 2},${y(cmp(b))}`)).filter(Boolean);
  if (line.length > 1) s += `<polyline points="${line.join(' ')}" class="line-cmp"/>`;
  buckets.forEach((b, i) => { if (cmp(b) !== null) s += `<circle cx="${x(i) + bw / 2}" cy="${y(cmp(b))}" r="3" class="dot-cmp"/>`; });
  return `${s}</svg>`;
}

function trendSection(model, metric) {
  const { unit, buckets } = model.trend;
  const tools = seg('trend-metric', [['occupancy', 'תפוסה'], ['revenue', 'הכנסה']], metric);
  const sub = `${unit === 'week' ? 'לפי שבוע' : 'לפי חודש'}. הזמן זורם מימין לשמאל, כמו בלוח.`;
  if (buckets.every(b => b.occupancy === null)) return section('trend', 'מגמה', sub, empty('אין מספיק נתונים בתקופה.'), tools);
  const legend = `<div class="lg"><span><i class="sw-cur"></i>התקופה</span>${model.range.compare ? `<span><i class="sw-cmp"></i>${model.range.compare.kind === 'lastYear' ? 'אותו זמן אשתקד' : 'התקופה הקודמת'}</span>` : ''}<span><i class="sw-closed"></i>היו ימים סגורים</span></div>`;
  return section('trend', 'מגמה', sub, `<div class="card trend">${trendChart(buckets, unit, metric)}${legend}</div>`, tools);
}

// ---------- 7. pace ----------

function paceChart(p) {
  const W = 460, H = 200, L = 34, R = 34, T = 14, B = 30;
  const leads = PACE.leadDays;
  const xs = i => L + (i / (leads.length - 1)) * (W - L - R);
  const y = v => T + (1 - v) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="עקומות מילוי לפי רמה">`;
  for (const g of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end">${g * 100}%</text>`;
  leads.forEach((d, i) => { s += `<text x="${xs(i)}" y="${H - 10}" text-anchor="middle">${d === 0 ? 'ביום' : d}</text>`; });
  for (const [key, curve] of Object.entries(p.curves)) {
    const color = key.startsWith('bay') ? 'var(--l0)' : `var(--l${key.slice(1)})`;
    const points = curve.map((v, i) => (v === null ? null : `${xs(i)},${y(v)}`)).filter(Boolean);
    if (points.length > 1) s += `<polyline points="${points.join(' ')}" style="fill:none;stroke:${color};stroke-width:2.5"${key === 'bay-kids' ? ' stroke-dasharray="5 4"' : ''}/>`;
    const last = curve.at(-1);
    if (last !== null) s += `<text x="${W - R + 4}" y="${y(last) + 4}" style="fill:${color}">${key.startsWith('bay') ? 'Bay' : key}</text>`;
  }
  return `${s}</svg>`;
}

function paceSection(model) {
  const p = model.pace;
  const { snapshots, snapshotsSince } = model.coverage;
  const sub = 'מבוסס על צילומי מצב של הלוח שנאספים מכאן והלאה. הפארק לא שומר מתי הוזמן כל מקום.';
  if (!p.ready) {
    const when = snapshotsSince ? `, בערך ב־${shortDate(addDays(snapshotsSince, 14))}` : '';
    const body = `<div class="card collect"><span class="k">אוספים נתונים</span><span class="big num">${snapshots} צילומי מצב</span>`
      + `<div class="meter"><i style="width:${Math.min(100, Math.round((p.deep / PACE.minSessions) * 100))}%"></i></div>`
      + `<span>${snapshotsSince ? `מאז ${shortDate(snapshotsSince)}. ` : ''}הגרפים יופיעו כשיהיו לפחות ${PACE.minSessions} סשנים שנצפו לפחות 7 ימים לפני תחילתם (כרגע ${p.deep})${when}.</span>`
      + '<ul><li>עקומת מילוי ממוצעת לכל רמה</li><li>כמה ימים מראש סשן נמכר עד הסוף</li><li>איזה חלק מההזמנות מגיע ב־24 השעות האחרונות</li><li>כמה מקומות מתפנים בביטולים</li></ul></div>';
    return section('pace', 'כמה מהר מתמלא', sub, body);
  }
  const leads = Object.entries(p.sellOutLeadDays).map(([k, d]) => `<li>${levelCell(k)} נמכר עד הסוף בדרך כלל <b class="num">${d < 1 ? `${Math.round(d * 24)} שעות` : `${d.toFixed(1)} ימים`}</b> מראש</li>`).join('');
  const facts = `<div class="card collect"><span class="k">עובדות</span><ul class="facts"><li><b class="num">${pct(p.last24Share)}</b> מההזמנות מגיעות ב־24 השעות האחרונות</li><li><b class="num">${int(p.released)}</b> מקומות התפנו בביטולים</li>${leads}</ul><span class="foot">מבוסס על ${int(p.tracked)} סשנים שנצפו בתקופה.</span></div>`;
  const chart = `<div class="card example">${paceChart(p)}<p class="foot">ציר אופקי: ימים לפני תחילת הסשן. ציר אנכי: כמה מהסשן כבר הוזמן.</p></div>`;
  return section('pace', 'כמה מהר מתמלא', sub, `<div class="pace">${facts}${chart}</div>`);
}

// ---------- 8. upcoming ----------

function riskRow(r) {
  return `<div class="rrow"><span class="when"><b>${HE_DAYS_SHORT[dayOfWeek(r.date)]} <span class="ltr num">${r.start}</span></b><span>בעוד ${r.hours} שעות</span></span>${levelChip(r.level)}`
    + `<span class="nm">${escapeHtml(r.name)}</span><span class="fill num">${r.booked}/${r.capacity}<small>${money(r.emptyValue)} פתוח</small></span></div>`;
}

function upcomingSection(model) {
  const { days, atRisk } = model.upcoming;
  const sub = 'מהלוח שפורסם עכשיו. כשיהיו מספיק צילומי מצב, כל יום יושווה לקצב הרגיל באותו מרחק זמן.';
  if (!days.length) return section('upcoming', 'הימים הקרובים', sub, empty('אין סשנים מפורסמים קדימה.'));
  const bars = days.map(d => {
    const usual = d.usual === null ? '' : `<u style="bottom:${Math.round(d.usual * 100)}%" title="בדרך כלל ${pct(d.usual)}"></u>`;
    const vs = d.usual === null ? '' : `<small class="${d.occupancy < d.usual ? 'behind' : ''}">${Math.round((d.occupancy - d.usual) * 100) > 0 ? '+' : ''}${Math.round((d.occupancy - d.usual) * 100)}</small>`;
    return `<div class="b"><em class="num">${pct(d.occupancy)}</em>${vs}<span class="col"><i style="height:${Math.max(2, Math.round(d.occupancy * 100))}%"></i>${usual}</span></div>`;
  }).join('');
  const labels = days.map(d => `<span><b>${HE_DAYS_SHORT[dayOfWeek(d.date)]}</b>${shortDate(d.date)}</span>`).join('');
  const dayCard = `<div class="card days"><div class="bars">${bars}</div><div class="lbl">${labels}</div><p class="foot">כמה מכל יום כבר הוזמן. רוב ההזמנות מגיעות ביומיים האחרונים, לכן ימים רחוקים נראים ריקים.${days.some(d => d.usual !== null) ? ' הקו: כמה בדרך כלל כבר הוזמן באותו מרחק זמן.' : ''}</p></div>`;
  const more = atRisk.length > AT_RISK_SHOWN
    ? `<details class="more"><summary>ועוד ${atRisk.length - AT_RISK_SHOWN} סשנים</summary>${atRisk.slice(AT_RISK_SHOWN).map(riskRow).join('')}</details>`
    : '';
  const riskCard = `<div class="card risk"><h3>סשנים בסיכון<small>פחות מ־40% מלא, מתחילים ב־48 השעות הקרובות</small></h3>${atRisk.length ? atRisk.slice(0, AT_RISK_SHOWN).map(riskRow).join('') + more : empty('אין כרגע סשנים בסיכון.')}</div>`;
  return section('upcoming', 'הימים הקרובים', sub, `<div class="up">${dayCard}${riskCard}</div>`);
}

// ---------- 9. operations ----------

function opsSection(model) {
  const o = model.ops;
  const c = model.coverage;
  const card = (value, title, text) => `<div class="card op"><span class="v num">${value}</span><span class="k">${title}</span><p>${text}</p></div>`;
  const cards = [
    card(o.closed.length, 'ימים סגורים', o.closed.length ? o.closed.map(x => `${shortDate(x.date)} ${escapeHtml(x.text)}`).join(' · ') : 'אין בתקופה.'),
    card(o.blocked, 'סשנים חסומים לאירועים', o.blockedNames.length ? o.blockedNames.map(n => `${escapeHtml(n.name)} ×${n.count}`).join(' · ') : 'אין בתקופה.'),
    card(o.cancelled + o.removed, 'סשנים שבוטלו', `${o.cancelled} עם קיבולת 0 בלוח, ${o.removed} שהוסרו מהלוח לפני שהתקיימו.`),
    card(o.overbooked, 'צדדים עם הזמנת יתר', `${o.overbookedPeople} גולשים מעבר לקיבולת, בדרך כלל אחרי שהקיבולת הוקטנה.`),
  ].join('');
  const coverage = `היסטוריה ${c.first ? `מ־${fullDate(c.first)}` : 'עוד לא נטענה'} · ${int(c.sessions)} סשנים בתקופה · ${c.snapshotsSince ? `${c.snapshots} צילומי מצב מאז ${shortDate(c.snapshotsSince)}` : 'צילומי המצב יתחילו בעדכון הבא'} · מתעדכן בכל ריענון`;
  return section('ops', 'תפעול', 'קיבולת שלא הייתה למכירה, ושינויים בלוח.', `<div class="ops">${cards}</div><p class="coverage">${coverage}</p>`);
}

/** The whole tab. ui: { heatMetric: 'occupancy' | 'soldOutShare' | 'revenue', trendMetric: 'occupancy' | 'revenue' } */
export function renderAnalysis(model, insightList, ui) {
  return kpiSection(model) + insightSection(insightList) + heatSection(model, ui.heatMetric) + levelSection(model)
    + slotSection(model) + trendSection(model, ui.trendMetric) + paceSection(model) + upcomingSection(model) + opsSection(model);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/site/render-analysis.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/render-analysis.mjs test/site/render-analysis.test.mjs
git commit -m "feat: render the analysis tab"
```

---

### Task 9: Refresh also reads the history files

**Files:**
- Modify: `site/lib/refresh.mjs` (replace)
- Modify: `test/site/refresh.test.mjs` (replace)

**Interfaces:**
- Consumes: nothing new.
- Produces: `refresh({ …existing options, extraPaths: string[] = [] }) → Promise<{ schedule, extras: { [path]: parsed JSON | null } }>`. **Breaking:** it used to resolve with the schedule itself; `site/app.js` is updated in Task 10. Each extra is read like the schedule (contents API, `Accept: application/vnd.github.raw+json`, `?ref=<branch>`, `cache: 'no-store'`); a failed extra becomes `null` and doesn't fail the refresh.

- [ ] **Step 1: Write the failing test** — replace `test/site/refresh.test.mjs` with (changes: `fakeGitHub` takes a `contents` map by path; the first test expects `{ schedule, extras: {} }`; a new last test covers extras):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refresh, RefreshError, API } from '../../site/lib/refresh.mjs';

const config = { owner: 'AssafHaft', repo: 'srfsc', workflow: 'update.yml', branch: 'main', dataPath: 'site/data/schedule.json' };
const REPO = `${API}/repos/AssafHaft/srfsc`;
const SCHEDULE = { fetchedAt: '2026-09-10T16:30:00+03:00', publishedThrough: '2026-09-24', days: [] };

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake clock: sleep() moves time forward instantly. */
function clock(start = Date.parse('2026-09-10T13:30:00Z')) {
  let t = start;
  return { now: () => t, sleep: async ms => { t += ms; } };
}

/**
 * Fake GitHub API. `runs` is the sequence of run states returned by GET /actions/runs/:id
 * (the last one repeats). `dispatch` is the dispatch response.
 */
function fakeGitHub({ dispatch = json({ workflow_run_id: 42, run_url: 'x', html_url: 'https://github.com/run/42' }), runs, lists = [], content = json(SCHEDULE), contents = {} }) {
  const calls = [];
  let runPoll = 0;
  let listPoll = 0;
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/dispatches')) return dispatch;
    if (url.includes('/runs?')) return json(lists[Math.min(listPoll++, lists.length - 1)]);
    if (url.startsWith(`${REPO}/actions/runs/`)) return json(runs[Math.min(runPoll++, runs.length - 1)]);
    if (url.startsWith(`${REPO}/contents/`)) {
      const path = url.slice(`${REPO}/contents/`.length).split('?')[0];
      return contents[path] ?? content;
    }
    throw new Error(`unexpected ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const run = (status, conclusion = null) => ({ id: 42, status, conclusion, html_url: 'https://github.com/run/42' });

test('follows the returned run id, reports progress, then reads the file from the API', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('queued'), run('in_progress'), run('completed', 'success')] });
  const phases = [];
  const result = await refresh({ token: 'tok', config, fetchImpl, ...clock(), onStatus: s => phases.push(s.phase) });

  assert.deepEqual(result, { schedule: SCHEDULE, extras: {} });
  assert.deepEqual(phases, ['starting', 'queued', 'running']);
  const [dispatch] = fetchImpl.calls;
  assert.equal(dispatch.url, `${REPO}/actions/workflows/update.yml/dispatches`);
  assert.equal(dispatch.init.method, 'POST');
  assert.equal(dispatch.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main', return_run_details: true });
  const read = fetchImpl.calls.at(-1);
  assert.equal(read.url, `${REPO}/contents/site/data/schedule.json?ref=main`);
  assert.equal(read.init.headers.Accept, 'application/vnd.github.raw+json');
  assert.ok(fetchImpl.calls.every(c => c.init.cache === 'no-store'));
});

test('with a 204 dispatch, finds the new run in the run list', async () => {
  const c = clock();
  const created = new Date(c.now() + 2000).toISOString();
  const fetchImpl = fakeGitHub({
    dispatch: json(null, 204),
    lists: [{ workflow_runs: [] }, { workflow_runs: [{ id: 41, created_at: '2026-09-10T10:00:00Z' }, { id: 42, created_at: created }] }],
    runs: [run('completed', 'success')],
  });
  await refresh({ token: 'tok', config, fetchImpl, ...c });
  assert.ok(fetchImpl.calls.some(x => x.url === `${REPO}/actions/runs/42`));
});

test('gives up looking for the run after 30 seconds', async () => {
  const fetchImpl = fakeGitHub({ dispatch: json(null, 204), lists: [{ workflow_runs: [] }], runs: [] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => e.kind === 'failed');
});

test('a failed run links to its log', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('in_progress'), run('completed', 'failure')] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => {
    assert.ok(e instanceof RefreshError);
    assert.equal(e.kind, 'failed');
    assert.equal(e.url, 'https://github.com/run/42');
    return true;
  });
});

test('a cancelled run (superseded by a newer one) is reported as such', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('in_progress'), run('completed', 'cancelled')] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => {
    assert.ok(e instanceof RefreshError);
    assert.equal(e.kind, 'failed');
    assert.equal(e.message, 'העדכון בוטל כי התחיל עדכון אחר');
    assert.equal(e.url, 'https://github.com/run/42');
    return true;
  });
});

test('stops waiting after 10 minutes', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('in_progress')] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => e.kind === 'timeout' && e.url === 'https://github.com/run/42');
});

test('token and network problems have their own kinds', async () => {
  const c = clock();
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 401), runs: [] }), ...c }), e => e.kind === 'unauthorized');
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 404), runs: [] }), ...c }), e => e.kind === 'forbidden');
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 403), runs: [] }), ...c }), e => e.kind === 'forbidden');
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: offline, ...c }), e => e.kind === 'network');
});

test('reads the extra paths too; one that fails comes back as null without failing the refresh', async () => {
  const INDEX = { snapshots: 3 };
  const fetchImpl = fakeGitHub({
    runs: [run('completed', 'success')],
    contents: { 'site/data/history/index.json': json(INDEX), 'site/data/history/2026-09.json': json({}, 500) },
  });
  const result = await refresh({ token: 'tok', config, fetchImpl, ...clock(), extraPaths: ['site/data/history/index.json', 'site/data/history/2026-09.json'] });
  assert.deepEqual(result, { schedule: SCHEDULE, extras: { 'site/data/history/index.json': INDEX, 'site/data/history/2026-09.json': null } });
  const reads = fetchImpl.calls.filter(c => c.url.includes('/contents/'));
  assert.ok(reads.every(c => c.init.headers.Accept === 'application/vnd.github.raw+json' && c.url.endsWith('?ref=main')));
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test test/site/refresh.test.mjs`
Expected: FAIL — the first test gets the bare schedule, and the new test gets no `extras`.

- [ ] **Step 3: Replace `site/lib/refresh.mjs`** (changes: the doc comment, the `extraPaths` option, and the final read):

```js
// The refresh button's flow (spec section 8): start the update workflow through the GitHub API,
// follow its run, then read the new schedule.json straight from the API (GitHub Pages' CDN
// caches for 10 minutes and ignores ?t= query strings, so reading from Pages would be stale).

export const API = 'https://api.github.com';

/** kind: 'unauthorized' | 'forbidden' | 'network' | 'failed' | 'timeout'. `url` links to the run when known. */
export class RefreshError extends Error {
  constructor(kind, message, url = null) {
    super(message);
    this.name = 'RefreshError';
    this.kind = kind;
    this.url = url;
  }
}

const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs one refresh. Resolves with { schedule, extras }: the fresh schedule, and each of `extraPaths`
 * (repo paths such as the history files) parsed, or null if that one file couldn't be read.
 * onStatus({ phase: 'starting' | 'queued' | 'running', elapsedMs, url }) reports progress.
 */
export async function refresh({
  token,
  config,
  fetchImpl = (...args) => fetch(...args),
  sleep = wait,
  now = () => Date.now(),
  onStatus = () => {},
  pollMs = 5000,
  lookupMs = 30000,
  timeoutMs = 600000,
  extraPaths = [],
}) {
  const repo = `${API}/repos/${config.owner}/${config.repo}`;
  const call = async (url, init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        cache: 'no-store', // GitHub API responses carry Cache-Control: max-age=60; we need the latest state every call
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...init.headers,
        },
      });
    } catch {
      throw new RefreshError('network', 'אין חיבור ל־GitHub');
    }
    if (res.status === 401) throw new RefreshError('unauthorized', 'הטוקן פג תוקף או לא תקין');
    if (res.status === 403 || res.status === 404) throw new RefreshError('forbidden', 'לטוקן אין גישה');
    if (!res.ok) throw new RefreshError('network', `GitHub ענה ${res.status}`);
    return res;
  };

  const startedAt = now();
  onStatus({ phase: 'starting', elapsedMs: 0, url: null });

  const dispatched = await call(`${repo}/actions/workflows/${config.workflow}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: config.branch, return_run_details: true }),
  });
  // With return_run_details: true, GitHub answers 200 with the run id; without it, 204 with no body.
  let runId = dispatched.status === 200 ? (await dispatched.json().catch(() => null))?.workflow_run_id ?? null : null;

  while (!runId) {
    if (now() - startedAt > lookupMs) throw new RefreshError('failed', 'העדכון לא נמצא ב־GitHub');
    await sleep(3000);
    const list = await (await call(`${repo}/actions/workflows/${config.workflow}/runs?event=workflow_dispatch&per_page=5`)).json();
    const mine = (list.workflow_runs ?? [])
      .filter(r => Date.parse(r.created_at) >= startedAt - 60000) // allow for clock differences
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    runId = mine[0]?.id ?? null;
  }

  for (;;) {
    const run = await (await call(`${repo}/actions/runs/${runId}`)).json();
    if (run.status === 'completed') {
      if (run.conclusion === 'cancelled') throw new RefreshError('failed', 'העדכון בוטל כי התחיל עדכון אחר', run.html_url);
      if (run.conclusion !== 'success') throw new RefreshError('failed', 'העדכון נכשל', run.html_url);
      break;
    }
    const elapsedMs = now() - startedAt;
    if (elapsedMs > timeoutMs) throw new RefreshError('timeout', 'העדכון עדיין רץ', run.html_url);
    onStatus({ phase: QUEUED.has(run.status) ? 'queued' : 'running', elapsedMs, url: run.html_url });
    await sleep(pollMs);
  }

  const read = async path =>
    (await call(`${repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json' } })).json();
  const schedule = await read(config.dataPath);
  const extras = {};
  await Promise.all(extraPaths.map(async path => {
    try {
      extras[path] = await read(path);
    } catch {
      extras[path] = null; // the schedule refreshed; the page keeps its older copy of this file
    }
  }));
  return { schedule, extras };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/site/refresh.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/refresh.mjs test/site/refresh.test.mjs
git commit -m "feat: let refresh read extra repo files"
```

(The page still calls the old shape until Task 10; don't deploy between the two tasks.)

---

### Task 10: The analysis tab on the page

**Files:**
- Modify: `site/config.js` (replace)
- Modify: `site/index.html` (replace)
- Modify: `site/app.js` (replace)
- Modify: `site/styles.css` (append)
- Modify: `README.md` (replace)

**Interfaces:**
- Consumes: everything above — `periodRange`, `monthsNeeded`, `expandMonth`, `PERIODS`, `DEFAULT_PERIOD` (Task 2); `analyse` (6); `insights` (7); `renderAnalysis`, `renderPeriods`, `compareNote` (8); `refresh` with `extraPaths` (9); `monthsBetween` (1).
- Produces: the finished page. State in `app.js`: `tab` (`'schedule'` | `'analysis'`, `#analysis` in the URL), `period` (saved as `srfsc.period`), `heatMetric`, `trendMetric`, and a history cache `{ index, months: Map, status: 'idle' | 'loading' | 'ready' | 'error' }`.

- [ ] **Step 1: Replace `site/config.js`** (adds `historyPath` and `PRICES`)

```js
// Where the refresh button starts the update workflow and reads the fresh data from.
export const CONFIG = {
  owner: 'AssafHaft',
  repo: 'srfsc',
  workflow: 'update.yml',
  branch: 'main',
  dataPath: 'site/data/schedule.json',
  historyPath: 'site/data/history',
};

// List prices for one session, used for every revenue estimate (analysis spec section 3).
// From the park's single-session prices on 11.9.2026; edit here and all history is re-priced.
export const PRICES = {
  reef: 360, // reef L1–L4
  reefHigh: 390, // reef L5–L6
  bayAdult: 250,
  bayKids: 195,
};
```

- [ ] **Step 2: Replace `site/index.html`** (adds the tabs under the header, the period switch, the comparison line and the history error notice)

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>לוח סשנים – SRF Park TLV</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8C%8A%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Hebrew:wght@400;500;600&family=Secular+One&display=swap">
<link rel="stylesheet" href="styles.css">
<script type="module" src="app.js"></script>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <h1>לוח סשנים</h1>
      <p>ריף ימין, ריף שמאל ו־Bay ב־SRF Park TLV</p>
    </div>
    <div class="fresh">
      <div class="fresh-text"><strong id="fresh-main">טוען…</strong><span id="fresh-sub"></span></div>
      <button class="btn-refresh" id="refresh" data-action="refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4"/></svg><span>עדכון עכשיו</span></button>
    </div>
  </header>

  <nav class="tabs" role="tablist" aria-label="לשוניות">
    <button role="tab" data-tab="schedule" aria-selected="true">לוח</button>
    <button role="tab" data-tab="analysis" aria-selected="false">ניתוח</button>
  </nav>

  <p class="notice" id="refresh-msg" role="status" hidden></p>
  <p class="notice" id="stale" hidden>הלוח לא התעדכן כבר כמה שעות, אז ייתכן שהמספרים לא עדכניים. אפשר ללחוץ על ״עדכון עכשיו״.</p>
  <p class="notice" id="load-error" hidden>לא הצלחנו לטעון את הלוח. <button data-action="reload">נסו שוב</button></p>
  <p class="notice" id="history-error" hidden>לא הצלחנו לטעון את ההיסטוריה. <button data-action="reload-history">נסו שוב</button></p>

  <div class="controls">
    <div class="seg" role="group" aria-label="תצוגה" id="view-seg">
      <button data-view="day" aria-pressed="false">יום</button>
      <button data-view="week" aria-pressed="false">שבוע</button>
      <button data-view="month" aria-pressed="false">חודש</button>
    </div>
    <div class="seg" role="group" aria-label="תקופה" id="period-seg" hidden></div>
    <div class="levels" id="levels"></div>
  </div>
  <p class="compare-note" id="compare-note" hidden></p>

  <main id="view"><p class="empty">טוען את הלוח…</p></main>
</div>

<dialog id="token-panel" aria-labelledby="token-title">
  <h2 id="token-title">חיבור ל־GitHub</h2>
  <p>כדי שהכפתור יפעיל עדכון צריך טוקן של GitHub, פעם אחת. הוא נשמר רק בדפדפן הזה.</p>
  <ol>
    <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">פתחו את יצירת הטוקן ב־GitHub</a></li>
    <li>ב־Repository access בחרו <b dir="ltr">Only select repositories</b> ואז <b dir="ltr">srfsc</b></li>
    <li>ב־Permissions: <b dir="ltr">Actions: Read and write</b> ו־<b dir="ltr">Contents: Read-only</b></li>
    <li>צרו את הטוקן והדביקו אותו כאן</li>
  </ol>
  <p class="token-error" id="token-error" hidden></p>
  <label for="token-input">טוקן</label>
  <input id="token-input" type="password" autocomplete="off" spellcheck="false" dir="ltr" placeholder="github_pat_…">
  <div class="dialog-actions">
    <button class="btn-primary" data-action="save-token">שמירה ועדכון</button>
    <button data-action="close-token">ביטול</button>
  </div>
</dialog>
</body>
</html>
```

- [ ] **Step 3: Replace `site/app.js`**

What changes from the current file: the `tab` state and `#analysis` hash; `loadHistory()` fetches `data/history/index.json` then only the missing months the period needs; `renderAnalysisTab()`; the refresh passes `extraPaths` (the index and the months holding the last 3 days) and takes the history files it gets back, noting "הלוח עודכן, הניתוח לא" if one failed; clicks for `data-tab`, `data-period`, `data-heat-metric`, `data-trend-metric`, `data-jump` and `reload-history`; the minute tick leaves the analysis tab still.

```js
// Page glue: loads the data, keeps UI state, renders the schedule and analysis tabs, runs the refresh button.
import { CONFIG, PRICES } from './config.js';
import { HE_DAYS, addDays, dayOfWeek, formatAge, israelTime, israelToday, monthsBetween, shortDate } from './lib/time.mjs';
import { isStale } from './lib/stale.mjs';
import { RefreshError, refresh } from './lib/refresh.mjs';
import { renderDay, renderLevelChips, renderMonth, renderWeek } from './lib/render.mjs';
import { DEFAULT_PERIOD, PERIODS, expandMonth, monthsNeeded, periodRange } from './lib/history.mjs';
import { analyse } from './lib/analytics.mjs';
import { insights } from './lib/insights.mjs';
import { compareNote, renderAnalysis, renderPeriods } from './lib/render-analysis.mjs';

const TOKEN_KEY = 'srfsc.githubToken';
const LEVELS_KEY = 'srfsc.levels';
const PERIOD_KEY = 'srfsc.period';
const VIEWS = ['day', 'week', 'month'];
const ANALYSIS = 'analysis';
const HISTORY_URL = 'data/history/';
const $ = selector => document.querySelector(selector);

// localStorage can throw (private mode, blocked storage); the page must still work.
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* ignore */ }
  },
};

function initialView() {
  const fromHash = location.hash.slice(1);
  if (VIEWS.includes(fromHash)) return fromHash;
  return window.matchMedia('(max-width: 719px)').matches ? 'day' : 'week';
}

function savedLevels() {
  try {
    return new Set(JSON.parse(store.get(LEVELS_KEY) ?? '[]').map(Number));
  } catch {
    return new Set();
  }
}

function savedPeriod() {
  const period = store.get(PERIOD_KEY);
  return period && Object.hasOwn(PERIODS, period) ? period : DEFAULT_PERIOD;
}

const state = {
  schedule: null,
  tab: location.hash === `#${ANALYSIS}` ? ANALYSIS : 'schedule',
  view: initialView(),
  day: null,
  levels: savedLevels(),
  showPast: false,
  refreshing: false,
  period: savedPeriod(),
  heatMetric: 'occupancy',
  trendMetric: 'occupancy',
  history: { index: null, months: new Map(), status: 'idle' }, // status: idle | loading | ready | error
};

function context() {
  const now = new Date();
  return { today: israelToday(now), now: israelTime(now), levels: state.levels, showPast: state.showPast };
}

function renderFreshness() {
  const { fetchedAt, publishedThrough } = state.schedule;
  $('#fresh-main').textContent = `עודכן ${formatAge(fetchedAt)}`;
  $('#fresh-sub').textContent = publishedThrough
    ? `הלוח פורסם עד יום ${HE_DAYS[dayOfWeek(publishedThrough)]}, ${shortDate(publishedThrough)}`
    : 'הפארק עוד לא פרסם סשנים';
  $('#stale').hidden = !isStale(fetchedAt);
}

// ---------- analysis tab ----------

const currentRange = () => periodRange(state.period, israelToday(), state.history.index?.first ?? null);

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Month files the current period needs that the history has and we haven't loaded. */
function missingMonths() {
  const { index, months } = state.history;
  if (!index) return null;
  return monthsNeeded(currentRange()).filter(m => index.months.includes(m) && !months.has(m));
}

async function loadHistory() {
  const h = state.history;
  h.status = 'loading';
  try {
    h.index ??= await fetchJson(`${HISTORY_URL}index.json`);
    const missing = missingMonths();
    const files = await Promise.all(missing.map(m => fetchJson(`${HISTORY_URL}${m}.json`)));
    files.forEach((file, i) => h.months.set(missing[i], expandMonth(file)));
    h.status = 'ready';
  } catch {
    h.status = 'error';
  }
  render();
}

function renderAnalysisTab() {
  const h = state.history;
  $('#history-error').hidden = h.status !== 'error';
  if (h.status === 'error') {
    $('#view').innerHTML = '';
    return;
  }
  const missing = missingMonths();
  if (missing === null || missing.length) {
    $('#view').innerHTML = '<p class="empty">טוען היסטוריה…</p>';
    if (h.status !== 'loading') loadHistory();
    return;
  }
  const range = currentRange();
  const months = [...h.months.values()];
  const model = analyse({
    rows: months.flatMap(m => m.sessions),
    closed: months.flatMap(m => m.closed),
    range,
    levels: state.levels,
    prices: PRICES,
    schedule: state.schedule,
    now: new Date(),
    index: h.index,
  });
  $('#compare-note').innerHTML = compareNote(range);
  $('#view').innerHTML = renderAnalysis(model, insights(model), { heatMetric: state.heatMetric, trendMetric: state.trendMetric });
}

/** History files the refresh button re-reads: the index and the months holding the last 3 days' final counts. */
function historyPaths() {
  const today = israelToday();
  const months = monthsBetween(addDays(today, -3), addDays(today, -1));
  return [`${CONFIG.historyPath}/index.json`, ...months.map(m => `${CONFIG.historyPath}/${m}.json`)];
}

/** Takes the history files a refresh brought back. Returns false if any of them failed. */
function takeHistory(extras) {
  const h = state.history;
  let ok = true;
  for (const [path, file] of Object.entries(extras)) {
    if (file === null) ok = false;
    else if (path.endsWith('/index.json')) h.index = file;
    else h.months.set(file.month, expandMonth(file));
  }
  return ok;
}

// ---------- rendering ----------

function render() {
  if (!state.schedule) return;
  const ctx = context();
  if (!state.day || state.day < ctx.today) state.day = ctx.today;
  const analysis = state.tab === ANALYSIS;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#view-seg').hidden = analysis;
  $('#period-seg').hidden = !analysis;
  $('#compare-note').hidden = !analysis;
  $('#period-seg').innerHTML = renderPeriods(state.period);
  $('#levels').innerHTML = renderLevelChips(state.levels);
  if (analysis) {
    renderAnalysisTab();
  } else {
    $('#history-error').hidden = true;
    $('#view').innerHTML = state.view === 'week' ? renderWeek(state.schedule, ctx)
      : state.view === 'month' ? renderMonth(state.schedule, ctx)
        : renderDay(state.schedule, state.day, ctx);
  }
  renderFreshness();
}

async function load() {
  try {
    const res = await fetch('data/schedule.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.schedule = await res.json();
    $('#load-error').hidden = true;
    render();
  } catch {
    $('#load-error').hidden = false;
    $('#view').innerHTML = '';
  }
}

function setView(view) {
  state.view = view;
  state.tab = 'schedule';
  history.replaceState(null, '', `#${view}`);
}

function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab === ANALYSIS ? ANALYSIS : state.view}`);
}

// ---------- refresh button ----------

const clockText = ms => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function setButton(label, busy) {
  const button = $('#refresh');
  button.classList.toggle('is-busy', busy);
  button.querySelector('span').textContent = label;
}

function showMessage(text, url = null) {
  const box = $('#refresh-msg');
  box.replaceChildren(text);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'לפרטים ב־GitHub';
    box.append(' ', link);
  }
  box.hidden = !text;
}

const HINTS = {
  forbidden: 'בדקו שהטוקן מוגבל למאגר srfsc עם ההרשאות Actions: Read and write ו־Contents: Read-only.',
  network: 'נסו שוב בעוד רגע.',
  timeout: 'אפשר ללחוץ שוב על ״עדכון עכשיו״ בעוד כמה דקות.',
};

async function startRefresh() {
  if (state.refreshing) return;
  const token = store.get(TOKEN_KEY);
  if (!token) {
    openTokenPanel();
    return;
  }
  state.refreshing = true;
  showMessage('');
  setButton('מתחיל…', true);
  try {
    const { schedule, extras } = await refresh({
      token,
      config: CONFIG,
      extraPaths: historyPaths(),
      onStatus: ({ phase, elapsedMs }) =>
        setButton(phase === 'queued' ? 'ממתין בתור' : phase === 'running' ? `מעדכן… ${clockText(elapsedMs)}` : 'מתחיל…', true),
    });
    state.schedule = schedule;
    if (!takeHistory(extras)) showMessage('הלוח עודכן, הניתוח לא. נסו שוב בעוד כמה דקות.');
    $('#load-error').hidden = true;
    render();
  } catch (err) {
    if (err instanceof RefreshError && err.kind === 'unauthorized') {
      store.set(TOKEN_KEY, null);
      openTokenPanel('הטוקן פג תוקף או לא תקין. צרו טוקן חדש והדביקו אותו כאן.');
    } else if (err instanceof RefreshError) {
      showMessage(`${err.message}. ${HINTS[err.kind] ?? ''}`.trim(), err.url);
    } else {
      showMessage('העדכון נכשל מסיבה לא צפויה. נסו שוב.');
    }
  } finally {
    state.refreshing = false;
    setButton('עדכון עכשיו', false);
  }
}

function openTokenPanel(error = '') {
  $('#token-error').textContent = error;
  $('#token-error').hidden = !error;
  $('#token-input').value = '';
  $('#token-panel').showModal();
}

function saveToken() {
  const token = $('#token-input').value.trim();
  if (!token) {
    $('#token-error').textContent = 'הדביקו את הטוקן לפני השמירה.';
    $('#token-error').hidden = false;
    return;
  }
  store.set(TOKEN_KEY, token);
  $('#token-panel').close();
  startRefresh();
}

// ---------- events ----------

document.addEventListener('click', event => {
  const el = event.target.closest('[data-tab],[data-view],[data-day],[data-level],[data-step],[data-toggle-past],[data-period],[data-heat-metric],[data-trend-metric],[data-jump],[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'refresh') return startRefresh();
  if (d.action === 'reload') return load();
  if (d.action === 'save-token') return saveToken();
  if (d.action === 'close-token') return $('#token-panel').close();
  if (d.jump) return document.getElementById(`a-${d.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!state.schedule) return;
  if (d.action === 'reload-history') {
    state.history.status = 'idle';
  } else if (d.tab) {
    setTab(d.tab);
  } else if (d.view) {
    setView(d.view);
  } else if (d.day) {
    state.day = d.day;
    state.showPast = false;
    setView('day');
  } else if (d.level !== undefined) {
    const level = Number(d.level);
    if (state.levels.has(level)) state.levels.delete(level);
    else state.levels.add(level);
    store.set(LEVELS_KEY, JSON.stringify([...state.levels]));
  } else if (d.step) {
    const next = addDays(state.day, Number(d.step));
    const last = state.schedule.publishedThrough ?? context().today;
    if (next < context().today || next > last) return;
    state.day = next;
    state.showPast = false;
  } else if ('togglePast' in d) {
    state.showPast = !state.showPast;
  } else if (d.period) {
    state.period = d.period;
    store.set(PERIOD_KEY, d.period);
  } else if (d.heatMetric) {
    state.heatMetric = d.heatMetric;
  } else if (d.trendMetric) {
    state.trendMetric = d.trendMetric;
  }
  render();
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  if (hash === ANALYSIS && state.tab !== ANALYSIS) {
    state.tab = ANALYSIS;
    render();
  } else if (VIEWS.includes(hash) && (hash !== state.view || state.tab !== 'schedule')) {
    state.view = hash;
    state.tab = 'schedule';
    render();
  }
});

function tick() {
  if (!state.schedule) return;
  if (state.tab === ANALYSIS) return renderFreshness(); // the analysis doesn't change by the minute; keep the page still
  const scrollLeft = document.querySelector('.week-scroll')?.scrollLeft;
  render();
  const scroller = document.querySelector('.week-scroll');
  if (scrollLeft !== undefined && scroller) scroller.scrollLeft = scrollLeft;
}

setInterval(tick, 60000); // keeps "now", finished sessions and "updated N minutes ago" current
load();
```

- [ ] **Step 4: Append the analysis styles to `site/styles.css`**

```css
/* ---------- analysis tab (analysis spec section 7) ---------- */
:root {
  --rescue-ink: #B23A0C; /* text for changes in the bad direction; Rescue itself is too light for text */
  --h0: #EEF3F2; --h1: #D3E3E3; --h2: #A8C6CA; --h3: #6F9AA4; --h4: #3B6B79; --h5: #0F2B35;
}
.tabs { display: flex; gap: 28px; border-bottom: 1px solid var(--line); margin: -6px 0 18px; }
.tabs button { position: relative; padding: 6px 2px 10px; font-family: var(--display); font-size: 20px; color: var(--mist); }
.tabs button[aria-selected="true"] { color: var(--deep); }
.tabs button[aria-selected="true"]::after { content: ""; position: absolute; inset-inline: 0; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--deep); }
.seg button { white-space: nowrap; }
.seg.sm button { padding: 3px 12px; font-size: 13px; }
.compare-note { margin: -4px 0 8px; font-size: 13px; color: var(--mist); }
.compare-note b { color: var(--deep); font-weight: 500; }
.sec { margin-top: 30px; scroll-margin-top: 16px; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin-bottom: 12px; }
.sec h2 { font-family: var(--display); font-weight: 400; font-size: 24px; line-height: 1.15; margin: 0; }
.sec-sub { margin: 2px 0 0; font-size: 13px; color: var(--mist); }
.card { background: var(--deck); border: 1px solid var(--line); border-radius: 14px; }
.foot { margin: 10px 2px 0; font-size: 12px; color: var(--mist); }
.lvcell { display: inline-flex; align-items: center; gap: 6px; }
.lvcell small { color: var(--mist); font-size: 12.5px; }

/* KPIs */
.kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.kpi { padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 2px; }
.kpi .k { font-size: 13px; color: var(--mist); }
.kpi .v { font-family: var(--display); font-size: 32px; line-height: 1.1; }
.kpi .d { font-size: 12.5px; line-height: 1.4; }
.kpi .d .ar { font-weight: 600; }
.kpi .d.bad .ar { color: var(--rescue-ink); }
.kpi .d .ly { color: var(--mist); }
.kpi.lead { background: var(--deep); border-color: var(--deep); color: var(--foam); }
.kpi.lead .k, .kpi.lead .d .ly { color: var(--mist-2); }
.kpi.lead .d.bad .ar { color: #FF9A70; }

/* insights */
.ins { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ins li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 4px 12px; padding: 14px 16px; border-inline-start: 4px solid var(--line); }
.ins li.bad { border-inline-start-color: var(--rescue); }
.ins li.good { border-inline-start-color: var(--deep); }
.ins .n { font-family: var(--display); font-size: 22px; line-height: 1.1; color: var(--mist-2); }
.ins .t { font-size: 15px; font-weight: 500; line-height: 1.45; }
.ins .m { grid-column: 2; display: flex; gap: 14px; font-size: 12.5px; color: var(--mist); }
.ins .m button { font-weight: 500; color: var(--deep); text-decoration: underline; text-underline-offset: 3px; }

/* heatmap */
.heat-wrap { padding: 14px 14px 12px; overflow-x: auto; }
.heat { display: grid; grid-template-columns: 44px repeat(7, minmax(44px, 1fr)); gap: 3px; min-width: 360px; }
.heat .hd { font-size: 12.5px; color: var(--mist); text-align: center; padding-bottom: 2px; }
.heat .hd b { display: block; font-weight: 500; color: var(--deep); }
.heat .hr { font-size: 12px; color: var(--mist); display: flex; align-items: center; }
.heat .c { height: 30px; border-radius: 5px; display: grid; place-items: center; font-size: 12px; font-weight: 500; }
.heat .c.x { background: transparent; border: 1px dashed var(--line); }
.c.s0 { background: var(--h0); } .c.s1 { background: var(--h1); } .c.s2 { background: var(--h2); }
.c.s3 { background: var(--h3); color: #fff; } .c.s4 { background: var(--h4); color: #fff; } .c.s5 { background: var(--h5); color: #fff; }
.scale { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; color: var(--mist); }
.scale .c { width: 26px; height: 12px; border-radius: 3px; display: inline-block; }

/* level table */
.tbl-scroll { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.tbl th { font-weight: 400; font-size: 12.5px; color: var(--mist); text-align: start; padding: 10px 12px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.tbl td { padding: 9px 12px; border-top: 1px solid var(--line); vertical-align: middle; white-space: nowrap; }
.tbl tr:first-child td { border-top: 0; }
.tbl small { color: var(--mist); }
.occ { display: flex; align-items: center; gap: 8px; min-width: 150px; }
.occ .bar { flex: 1; height: 8px; border-radius: 4px; background: #E4ECEB; overflow: hidden; position: relative; }
.occ .bar i { position: absolute; inset-block: 0; inset-inline-start: 0; background: var(--deep); border-radius: 4px; }
.occ .bar u { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--rescue); }
.occ span { min-width: 34px; font-weight: 600; }
.dlt { font-size: 12.5px; }
.dlt.bad { color: var(--rescue-ink); font-weight: 600; }
.sd { display: grid; gap: 3px; min-width: 120px; }
.sd div { height: 6px; border-radius: 3px; }
.sd .cap { background: var(--mist-2); }
.sd .bk { background: var(--deep); }

/* strongest and weakest slots */
.slots { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.slots h3, .risk h3 { margin: 0; padding: 12px 16px 8px; font-size: 15px; font-weight: 600; border-bottom: 1px solid var(--line); }
.slots h3 small, .risk h3 small { font-weight: 400; color: var(--mist); font-size: 12.5px; margin-inline-start: 6px; }
.slot { display: grid; grid-template-columns: 22px 104px 76px minmax(0, 1fr) 64px; gap: 8px; align-items: center; padding: 7px 16px; border-top: 1px solid var(--line); font-size: 14px; }
.slot:first-of-type { border-top: 0; }
.slot .rk { color: var(--mist-2); font-size: 12.5px; }
.slot .wh { font-weight: 500; }
.slot .v { text-align: end; font-size: 12.5px; color: var(--mist); }
.slot .occ { min-width: 0; }

/* charts */
.trend, .example { padding: 14px 14px 8px; }
.trend svg, .example svg { width: 100%; height: auto; display: block; }
svg text { direction: ltr; unicode-bidi: plaintext; font-size: 11px; fill: var(--mist); } /* charts are laid out in code; RTL would flip text anchors */
svg .grid { stroke: var(--line); }
svg .bar-cur { fill: var(--deep); }
svg .line-cmp { fill: none; stroke: var(--rescue); stroke-width: 2; }
svg .dot-cmp { fill: var(--rescue); }
svg .closed-mark { stroke: var(--mist-2); stroke-width: 3; stroke-dasharray: 4 3; }
.lg { display: flex; gap: 18px; font-size: 12.5px; color: var(--mist); margin: 4px 4px 0; flex-wrap: wrap; }
.lg span { display: inline-flex; align-items: center; gap: 6px; }
.lg i { display: inline-block; }
.sw-cur { width: 14px; height: 10px; border-radius: 2px; background: var(--deep); }
.sw-cmp { width: 14px; height: 2px; background: var(--rescue); }
.sw-closed { width: 14px; border-top: 3px dashed var(--mist-2); }

/* fill speed */
.pace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 8px; }
.collect { padding: 18px; display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }
.collect .k { font-size: 13px; color: var(--mist); }
.collect .big { font-family: var(--display); font-size: 28px; line-height: 1.1; }
.collect ul { margin: 0; padding-inline-start: 18px; color: var(--mist); }
.collect .facts { color: var(--deep); display: grid; gap: 6px; }
.meter { height: 8px; border-radius: 4px; background: #E4ECEB; overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--deep); }

/* coming up */
.up { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 8px; }
.days { padding: 14px 14px 10px; }
.days .bars { display: flex; align-items: stretch; gap: 6px; height: 132px; }
.days .b { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.days .b em { font-style: normal; font-size: 11.5px; font-weight: 600; }
.days .b small { font-size: 10.5px; color: var(--mist); }
.days .b small.behind { color: var(--rescue-ink); font-weight: 600; }
.days .col { position: relative; flex: 1; width: 100%; display: flex; align-items: flex-end; }
.days .col i { display: block; width: 100%; background: var(--deep); border-radius: 4px 4px 0 0; }
.days .col u { position: absolute; inset-inline: -2px; height: 2px; background: var(--rescue); }
.days .lbl { display: flex; gap: 6px; margin-top: 4px; }
.days .lbl span { flex: 1; min-width: 0; text-align: center; font-size: 11px; color: var(--mist); line-height: 1.25; }
.days .lbl span b { display: block; color: var(--deep); font-weight: 500; }
.rrow { display: grid; grid-template-columns: 92px 44px minmax(0, 1fr) 88px; gap: 10px; align-items: center; padding: 7px 16px; border-top: 1px solid var(--line); font-size: 14px; }
.risk h3 + .rrow { border-top: 0; }
.rrow .when b { display: block; font-weight: 600; }
.rrow .when span { font-size: 12px; color: var(--mist); }
.rrow .nm { font-size: 13px; color: var(--mist); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rrow .fill { text-align: end; font-weight: 600; }
.rrow .fill small { display: block; font-weight: 400; font-size: 12px; color: var(--mist); }
.more summary { cursor: pointer; padding: 8px 16px 12px; font-size: 13px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
.more[open] summary { border-bottom: 1px solid var(--line); }
.risk .empty, .sec > .empty { border: 0; background: transparent; padding: 18px; }

/* operations */
.ops { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.op { padding: 14px; }
.op .v { display: block; font-family: var(--display); font-size: 26px; line-height: 1.1; }
.op .k { display: block; font-size: 13px; font-weight: 500; }
.op p { margin: 4px 0 0; font-size: 12.5px; color: var(--mist); line-height: 1.45; }
.coverage { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--mist); }

@media (max-width: 720px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi .v { font-size: 28px; }
  .ins, .slots, .pace, .up { grid-template-columns: 1fr; }
  .ops { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .heat { grid-template-columns: 34px repeat(7, minmax(0, 1fr)); gap: 2px; min-width: 0; }
  .heat .c { font-size: 10.5px; height: 26px; }
  .slot { grid-template-columns: 18px 88px 70px minmax(0, 1fr) 56px; gap: 6px; padding: 7px 12px; }
  .rrow { grid-template-columns: 78px 40px minmax(0, 1fr) 70px; gap: 8px; padding: 7px 12px; }
  .days .lbl span { font-size: 10px; }
  .days .b em { font-size: 10px; }
}
.up, .pace { align-items: start; }
```

- [ ] **Step 5: Replace `README.md`**

````markdown
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
````

- [ ] **Step 6: Run every test**

Run: `node --test`
Expected: PASS, 0 failures.

- [ ] **Step 7: Check the page in a browser**

Run: `npm run serve` and open `http://localhost:8000/#analysis` (Task 5's backfilled history is what it shows).
Check, at 1280 px wide:
- The console has no errors; "ניתוח" is the selected tab; the period switch replaces the view switch; the comparison line names the period and last year's weeks.
- Nine sections appear in order (KPIs, מה בולט, מתי עמוס, מה נמכר, הכי חזקים והכי חלשים, מגמה, כמה מהר מתמלא, הימים הקרובים, תפעול); no KPI tile, slot row or at-risk row is clipped.
- "12 חודשים" switches the trend to months with no comparison; "90 יום" goes back to weeks; the heat and trend switches redraw; a level chip narrows every section; an insight's "←" button scrolls to its section.
- "לוח" returns to the schedule (`#week`), "ניתוח" comes back with the same settings.

Then at 375 px wide: the page never scrolls sideways (`document.documentElement.scrollWidth` equals the viewport width), the heatmap fits, and the level table scrolls inside its card.

- [ ] **Step 8: Commit**

```bash
git add site/config.js site/index.html site/app.js site/styles.css README.md
git commit -m "feat: add the analysis tab"
```

---

## After merging

- The first scheduled run after the merge starts the snapshots (`index.json` `snapshots: 1`). The fill-speed section says "אוספים נתונים" until 30 sessions have been seen at least 7 days ahead, about two weeks.
- Optional: set up the external trigger in the README for reliable half-hourly snapshots.
