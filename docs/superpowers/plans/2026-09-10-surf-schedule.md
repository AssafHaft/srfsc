# SRF Park TLV Surf Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Pages site that shows SRF Park TLV's published surf schedule (about two weeks ahead) at a glance, in Hebrew, with an hourly GitHub Actions scrape and an on-page refresh button.

**Architecture:** A zero-dependency Node scraper (`scraper/`) reads the park's JSON API in 3-day windows, normalizes it into `site/data/schedule.json`, and a single workflow commits that file and deploys `site/` to Pages. The page (`site/`) is static HTML plus plain JavaScript modules: pure logic in `site/lib/*.mjs` (tested with `node --test`) and a thin DOM layer in `site/app.js`. The refresh button starts the workflow through the GitHub REST API with a fine-grained token kept in `localStorage`, follows the run, then reads the new data straight from the API.

**Tech Stack:** Node 20+ (Node 22 on Actions), ES modules, `node:test`, no npm packages; HTML/CSS/vanilla JS; GitHub Actions (`actions/checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`).

**Spec:** [docs/superpowers/specs/2026-09-10-surf-schedule-design.md](../specs/2026-09-10-surf-schedule-design.md) (visual reference: [the mockup](../specs/assets/2026-09-10-surf-schedule-mockup.html)). Read both before starting.

## Global Constraints

- **No dependencies.** No `npm install`, no `node_modules`. Everything uses Node built-ins and browser APIs.
- **Node:** `engines.node >= 20`; the workflow uses Node `22`. All code is ES modules (`"type": "module"`).
- **Tests:** run with `node --test` (it finds `**/test/**/*.mjs` and `*.test.mjs` itself). Never pass a directory to `node --test`; Node treats it as a file. To run one file: `node --test path/to/file.test.mjs`.
- **Time zone:** every "today", "now" and date calculation uses `Asia/Jerusalem`, whatever the machine's zone.
- **Park API:** `GET https://www.srfparktlv.co.il/products/sessions-react/?ajax=1&from_date=DD/MM/YY` with header `X-Requested-With: XMLHttpRequest`. Without `ajax=1` and that header, the park redirects to an abuse page.
- **Scraper rules:** 3-day windows; stop after 2 consecutive windows with no sessions and no close days; never more than 12 windows; retries wait 2 s, 4 s, 8 s.
- **Data file:** `site/data/schedule.json`, 2-space JSON with a trailing newline, keys in the order of the spec's section 3.
- **Language:** Hebrew, right-to-left (`<html lang="he" dir="rtl">`). Copy the Hebrew strings exactly as given in this plan.
- **Security:** park text is always escaped before it goes into HTML. The GitHub token lives only in `localStorage` under `srfsc.githubToken` and is only ever sent to `api.github.com`.
- **Week view scale:** one hour = 56 px. `HOUR_PX` in `site/lib/render.mjs` and `--hpx` in `site/styles.css` must stay equal.
- **Fixtures:** `scraper/test/fixtures/window-2026-09-*.json` are real park responses captured on 2026-09-10 and are already committed. Don't re-capture or edit them; tests assert exact values from them.
- **Shell:** commands are shown one per line and work in Git Bash and PowerShell.

## Refinements to the spec

These came out of building and testing a scratch copy of this plan; they don't change behaviour the user approved.

- The Israel-time helpers live in `site/lib/time.mjs` and the scraper imports them from there (the spec listed a separate `scraper/dates.mjs`). One copy serves both.
- Page-logic tests live in `test/site/`, so nothing test-only gets deployed with `site/`. Shared scraper test helpers live in `scraper/test-support/`, outside `scraper/test/`, so `node --test` doesn't run them as tests.
- `site/lib/schedule.mjs` gains `dayRows()`: the day view shows one row per session a surfer would book (a right/left pair of the same session is one row), so "הצגת 10 סשנים שכבר הסתיימו" counts rows, not sides.
- `scripts/serve.mjs` is a 30-line static server for local preview (ES modules don't load from `file://`).
- The workflow skips its scrape and commit steps when the repository variable `SCRAPE_IN_ACTIONS` is `false`. That's the switch the spec's "run the scraper on your own computer" fallback needs, so pushed data still deploys.
- After a successful refresh the header shows the real age of the new data ("עודכן לפני 2 דקות", since the scrape finishes before the deploy does) rather than a fixed "עודכן עכשיו".
- The workflow checks out with `fetch-depth: 0`, so its `git pull --rebase` always finds the merge base.

## File map

| File | Responsibility | Task |
|---|---|---|
| `package.json` | ES modules, `test` / `scrape` / `serve` scripts | 1 |
| `site/lib/time.mjs` | Israel-time and date helpers, Hebrew names, "updated N minutes ago" | 1 |
| `scraper/test-support/fake-park.mjs` | Test doubles: fixture-backed `fetch`, scripted `fetch`, recording `sleep` | 2 |
| `scraper/normalize.mjs` | Raw park rows → schedule model (side, spots, validation, days) | 2 |
| `scraper/fetch.mjs` | One window with retries; walking the horizon | 3 |
| `scraper/scrape.mjs` | CLI: fetch, normalize, refuse-to-empty guard, write the file | 4 |
| `site/data/schedule.json` | The data the page shows (written by the scraper) | 4 |
| `site/lib/schedule.mjs` | View logic: blocks, overlap layout, ranges, past/now, summaries, names | 5 |
| `site/lib/stale.mjs` | Stale-data rule | 5 |
| `site/lib/refresh.mjs` | Refresh-button flow against the GitHub API | 6 |
| `site/lib/render.mjs` | HTML for week, month and day views | 7 |
| `site/index.html`, `site/styles.css`, `site/config.js`, `site/app.js` | The page: shell, styles, repo settings, DOM glue | 8 |
| `scripts/serve.mjs` | Local preview server | 8 |
| `.github/workflows/update.yml` | Hourly/manual scrape, commit, deploy | 9 |
| `README.md` | What it is, how to work on it, one-time setup, fallback | 9 |

---

### Task 1: Project setup and Israel-time helpers

**Files:**
- Create: `package.json`
- Create: `site/lib/time.mjs`
- Test: `test/site/time.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (`site/lib/time.mjs`), used by every later task:
  - `TZ = 'Asia/Jerusalem'`; `HE_DAYS` (Sunday first), `HE_DAYS_SHORT`, `HE_MONTHS`
  - `israelParts(now?: Date) → { date: 'YYYY-MM-DD', time: 'HH:MM', seconds: 'SS', offset: '+03:00' }`
  - `israelToday(now?) → 'YYYY-MM-DD'`, `israelTime(now?) → 'HH:MM'`, `israelIso(now?) → 'YYYY-MM-DDTHH:MM:SS+03:00'`
  - `addDays(iso, n) → iso`, `dayOfWeek(iso) → 0..6` (0 = Sunday), `daysBetween(a, b) → number`
  - `toParkDate(iso) → 'DD/MM/YY'`, `shortDate(iso) → '10.9'`, `minutes('HH:MM') → number`
  - `formatAge(fromIso, now?) → 'עכשיו' | 'לפני 12 דקות' | …`

- [ ] **Step 1: Create `package.json`**

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
    "serve": "node scripts/serve.mjs"
  }
}
```

- [ ] **Step 2: Write the failing test** in `test/site/time.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  israelToday, israelTime, israelIso, addDays, dayOfWeek, daysBetween,
  toParkDate, shortDate, minutes, formatAge,
} from '../../site/lib/time.mjs';

test('israelToday follows Israel midnight, not UTC midnight', () => {
  assert.equal(israelToday(new Date('2026-09-10T20:59:00Z')), '2026-09-10'); // 23:59 IDT
  assert.equal(israelToday(new Date('2026-09-10T21:00:00Z')), '2026-09-11'); // 00:00 IDT
});

test('israelTime uses a 24-hour clock', () => {
  assert.equal(israelTime(new Date('2026-09-10T21:05:00Z')), '00:05');
  assert.equal(israelTime(new Date('2026-09-10T13:20:00Z')), '16:20');
});

test('israelIso carries the right offset in summer and winter', () => {
  assert.equal(israelIso(new Date('2026-09-10T13:17:05Z')), '2026-09-10T16:17:05+03:00');
  assert.equal(israelIso(new Date('2026-12-01T10:00:00Z')), '2026-12-01T12:00:00+02:00');
});

test('addDays crosses month boundaries and goes backwards', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-09-10', -4), '2026-09-06');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // across the DST change
});

test('dayOfWeek and daysBetween', () => {
  assert.equal(dayOfWeek('2026-09-10'), 4); // Thursday
  assert.equal(dayOfWeek('2026-09-06'), 0); // Sunday
  assert.equal(daysBetween('2026-09-06', '2026-09-24'), 18);
});

test('date and time formats', () => {
  assert.equal(toParkDate('2026-09-10'), '10/09/26');
  assert.equal(shortDate('2026-09-10'), '10.9');
  assert.equal(shortDate('2026-10-01'), '1.10');
  assert.equal(minutes('17:30'), 1050);
});

test('formatAge in Hebrew', () => {
  const now = new Date('2026-09-10T13:30:00Z');
  assert.equal(formatAge('2026-09-10T16:29:40+03:00', now), 'עכשיו');
  assert.equal(formatAge('2026-09-10T16:29:00+03:00', now), 'לפני דקה');
  assert.equal(formatAge('2026-09-10T16:18:00+03:00', now), 'לפני 12 דקות');
  assert.equal(formatAge('2026-09-10T15:30:00+03:00', now), 'לפני שעה');
  assert.equal(formatAge('2026-09-10T14:30:00+03:00', now), 'לפני שעתיים');
  assert.equal(formatAge('2026-09-10T11:30:00+03:00', now), 'לפני 5 שעות');
  assert.equal(formatAge('2026-09-08T16:30:00+03:00', now), 'לפני יומיים');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/site/time.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/time.mjs`.

- [ ] **Step 4: Implement** `site/lib/time.mjs`

```js
// Israel-time and date helpers. Shared by the page (site/) and the scraper (scraper/).
// Dates are ISO strings ("2026-09-10"), times are "HH:MM", all in Asia/Jerusalem.

export const TZ = 'Asia/Jerusalem';

export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const HE_DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** Wall-clock parts in Israel for an instant: { date, time, seconds, offset }. */
export function israelParts(now = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, seconds: p.second, offset };
}

/** Today's date in Israel, e.g. "2026-09-10". */
export const israelToday = (now = new Date()) => israelParts(now).date;

/** Current Israel wall-clock time, e.g. "16:20". */
export const israelTime = (now = new Date()) => israelParts(now).time;

/** ISO timestamp with the Israel offset, e.g. "2026-09-10T16:17:05+03:00". */
export function israelIso(now = new Date()) {
  const p = israelParts(now);
  return `${p.date}T${p.time}:${p.seconds}${p.offset}`;
}

/** Calendar arithmetic on ISO dates (noon UTC avoids any DST edge). */
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Whole days from a to b (b later → positive). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** The park API's date format: "10/09/26". */
export const toParkDate = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

/** Short display date: "10.9", "1.10". */
export const shortDate = iso => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

/** "17:30" → 1050. */
export const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** How long ago, in Hebrew: "עכשיו", "לפני 12 דקות", "לפני שעתיים", "לפני 3 ימים". */
export function formatAge(fromIso, now = new Date()) {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
  if (mins < 1) return 'עכשיו';
  if (mins === 1) return 'לפני דקה';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'לפני שעה';
  if (hours === 2) return 'לפני שעתיים';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'לפני יום';
  if (days === 2) return 'לפני יומיים';
  return `לפני ${days} ימים`;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/site/time.test.mjs`
Expected: `tests 7`, `pass 7`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json site/lib/time.mjs test/site/time.test.mjs
git commit -m "feat: add project setup and Israel-time helpers"
```

---

### Task 2: Normalizing the park's data

Turns raw API windows into the data file model. The rules mirror the park's own `computeBox()` so numbers match its site (spec section 2). Facts the tests rely on, all from the committed fixtures: 438 rows from 10–24/09; Bay rows also have right/left sides (12/09 15:30: kids 7–10 right, kids 11–16 left); 7 rows are `disabled: true` (e.g. id 38905, the women's retreat on 10/09 20:00); id 37616 (11/09 10:30 Bay left) has 8 booked of 2.

**Files:**
- Create: `scraper/test-support/fake-park.mjs`
- Create: `scraper/normalize.mjs`
- Test: `scraper/test/normalize.test.mjs`
- Already committed: `scraper/test/fixtures/window-2026-09-{10,13,16,19,22,25,28}.json`

**Interfaces:**
- Consumes: `addDays` from `site/lib/time.mjs`.
- Produces (`scraper/normalize.mjs`):
  - `sideOf(row) → 'right' | 'left' | null`
  - `normalizeRow(row) → { date, session } | { skip: string }`
  - `normalize(windows, { today, fetchedAt }) → { schedule: { fetchedAt, publishedThrough, days }, warnings: string[] }`
  - Session shape: `{ id, start: 'HH:MM', end, name, level (0 = Bay), area: 'reef'|'bay', side: 'right'|'left', capacity, booked, spotsLeft, available }`
  - Day shape: `{ date, open, close, closed: string|null, sessions }`; days run from `today` through `publishedThrough`, empty and closed days included.
- Produces (`scraper/test-support/fake-park.mjs`), used by Tasks 3, 4 and 7: `EMPTY_WINDOW`, `response(body, { status })`, `isoFromUrl(url)`, `fixtureWindow(iso)`, `fixtureFetch()` (records `.calls`), `scriptedFetch(replies)` (records `.calls`), `recordingSleep()` (records `.waits`).

- [ ] **Step 1: Create the test helpers** in `scraper/test-support/fake-park.mjs`

```js
// Test helpers: a fetch() stand-in that serves the park windows saved in scraper/test/fixtures/.
// Lives outside scraper/test/ so `node --test` doesn't run it as a test file.
import { existsSync, readFileSync } from 'node:fs';

const FIXTURES = new URL('../test/fixtures/', import.meta.url);
export const EMPTY_WINDOW = { success: true, scheduler: [], close_days: [], dateArray: [] };

/** Minimal Response stand-in. `body` may be an object (sent as JSON) or a raw string. */
export const response = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** "…from_date=10%2F09%2F26" → "2026-09-10". */
export function isoFromUrl(url) {
  const [d, m, y] = new URL(url).searchParams.get('from_date').split('/');
  return `20${y}-${m}-${d}`;
}

/** The saved window starting at `iso` (e.g. "2026-09-10"), parsed. */
export const fixtureWindow = iso => JSON.parse(readFileSync(new URL(`window-${iso}.json`, FIXTURES), 'utf8'));

/** fetch() serving saved windows; dates without a fixture get an empty window. Records calls. */
export function fixtureFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const file = new URL(`window-${isoFromUrl(url)}.json`, FIXTURES);
    return response(existsSync(file) ? readFileSync(file, 'utf8') : EMPTY_WINDOW);
  };
  impl.calls = calls;
  return impl;
}

/** fetch() that answers each call with the next item of `replies` (a response or an Error to throw). */
export function scriptedFetch(replies) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

/** sleep() stand-in that records the requested waits instead of waiting. */
export function recordingSleep() {
  const waits = [];
  const impl = async ms => { waits.push(ms); };
  impl.waits = waits;
  return impl;
}
```

- [ ] **Step 2: Write the failing test** in `scraper/test/normalize.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sideOf, normalizeRow, normalize } from '../normalize.mjs';
import { fixtureWindow } from '../test-support/fake-park.mjs';

// A plausible raw reef row; override fields per test.
const row = (over = {}) => ({
  scheduler_id: 1,
  name: 'L3 - Intermediate (M3)',
  date: '2026-09-10',
  startTime: '08:00:00',
  endTime: '09:00:00',
  wave_level: 3,
  area: 'reef',
  area_number: 'right',
  right_max_users: 18,
  right_count_users: 5,
  left_max_users: 18,
  left_count_users: 9,
  disabled: 0,
  ...over,
});

const FIXTURE_DATES = ['2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const fixtureSchedule = () =>
  normalize(FIXTURE_DATES.map(fixtureWindow), { today: '2026-09-10', fetchedAt: '2026-09-10T16:17:00+03:00' });

test('sideOf reads right/left, and Bay pool numbers (1–3 right, 4–6 left, right wins)', () => {
  assert.equal(sideOf(row({ area_number: 'right' })), 'right');
  assert.equal(sideOf(row({ area_number: 'left' })), 'left');
  assert.equal(sideOf(row({ area: 'bay', area_number: '5' })), 'left');
  assert.equal(sideOf(row({ area: 'bay', area_number: '1,2' })), 'right');
  assert.equal(sideOf(row({ area: 'bay', area_number: '4,2' })), 'right');
  assert.equal(sideOf(row({ area: 'reef', area_number: '3' })), null);
  assert.equal(sideOf(row({ area_number: '' })), null);
});

test('normalizeRow takes capacity and bookings from its own side', () => {
  assert.deepEqual(normalizeRow(row()), {
    date: '2026-09-10',
    session: {
      id: 1, start: '08:00', end: '09:00', name: 'L3 - Intermediate (M3)', level: 3,
      area: 'reef', side: 'right', capacity: 18, booked: 5, spotsLeft: 13, available: true,
    },
  });
  assert.equal(normalizeRow(row({ area_number: 'left' })).session.spotsLeft, 9);
});

test('normalizeRow: Bay is level 0; disabled and overbooked rows have no spots', () => {
  assert.equal(normalizeRow(row({ area: 'bay', wave_level: 4 })).session.level, 0);
  const disabled = normalizeRow(row({ disabled: true })).session;
  assert.equal(disabled.spotsLeft, 0);
  assert.equal(disabled.available, false);
  assert.equal(normalizeRow(row({ right_max_users: 2, right_count_users: 8 })).session.spotsLeft, 0);
});

test('normalizeRow skips rows it cannot trust', () => {
  assert.match(normalizeRow(row({ area_number: 'middle' })).skip, /unknown side/);
  assert.match(normalizeRow(row({ endTime: '08:00:00' })).skip, /bad times/);
  assert.match(normalizeRow(row({ date: '10/09/2026' })).skip, /bad date/);
  assert.match(normalizeRow(row({ right_count_users: -1 })).skip, /bad capacity/);
  assert.match(normalizeRow(row({ wave_level: null })).skip, /bad wave level/);
});

test('normalize: real fixtures cover 10–24/09 with closed and empty days', () => {
  const { schedule, warnings } = fixtureSchedule();
  assert.deepEqual(warnings, []);
  assert.equal(schedule.fetchedAt, '2026-09-10T16:17:00+03:00');
  assert.equal(schedule.publishedThrough, '2026-09-24');
  assert.equal(schedule.days.length, 15);
  assert.equal(schedule.days.reduce((n, d) => n + d.sessions.length, 0), 438);

  const day = date => schedule.days.find(d => d.date === date);
  assert.deepEqual(day('2026-09-20'), { date: '2026-09-20', open: null, close: null, closed: null, sessions: [] });
  assert.equal(day('2026-09-21').closed, 'יום כיפור');
  assert.equal(day('2026-09-10').open, '06:00');
  assert.equal(day('2026-09-10').close, '22:00');
  assert.equal(day('2026-09-11').close, '14:00');
});

test('normalize: real rows get the right numbers', () => {
  const { schedule } = fixtureSchedule();
  const sessions = schedule.days.flatMap(d => d.sessions);
  const byId = id => sessions.find(s => s.id === id);
  assert.deepEqual([byId(37303).side, byId(37303).spotsLeft], ['right', 8]); // 10/09 06:00 L6, 15 − 7
  assert.deepEqual([byId(37302).side, byId(37302).spotsLeft], ['left', 6]); // same slot, 15 − 9
  assert.equal(byId(38905).available, false); // 10/09 20:00 women's retreat, disabled
  assert.equal(byId(37616).spotsLeft, 0); // 11/09 10:30 Bay, 8 booked of 2
  assert.deepEqual([byId(37662).area, byId(37662).side, byId(37662).level], ['bay', 'right', 0]);
});

test('normalize sorts each day by start, then reef before Bay, then right before left', () => {
  const { schedule } = fixtureSchedule();
  const key = s => `${s.start}|${s.area === 'reef' ? 0 : 1}|${s.side === 'right' ? 0 : 1}`;
  for (const d of schedule.days) {
    const keys = d.sessions.map(key);
    assert.deepEqual(keys, [...keys].sort(), `day ${d.date} is out of order`);
  }
});

test('normalize drops duplicates and past rows; a close day alone extends the horizon', () => {
  const windows = [
    { scheduler: [row({ scheduler_id: 7 }), row({ scheduler_id: 7 }), row({ scheduler_id: 8, date: '2026-09-09' })], close_days: [] },
    { scheduler: [], close_days: [{ date: '2026-09-12', text: 'חג' }] },
  ];
  const { schedule } = normalize(windows, { today: '2026-09-10', fetchedAt: 'x' });
  assert.equal(schedule.publishedThrough, '2026-09-12');
  assert.deepEqual(schedule.days.map(d => [d.date, d.sessions.length, d.closed]), [
    ['2026-09-10', 1, null],
    ['2026-09-11', 0, null],
    ['2026-09-12', 0, 'חג'],
  ]);
});

test('normalize with nothing published gives no days', () => {
  const { schedule } = normalize([{ scheduler: [], close_days: [] }], { today: '2026-09-10', fetchedAt: 'x' });
  assert.deepEqual(schedule, { fetchedAt: 'x', publishedThrough: null, days: [] });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test scraper/test/normalize.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/normalize.mjs`.

- [ ] **Step 4: Implement** `scraper/normalize.mjs`

```js
// Raw park API windows → the schedule model in site/data/schedule.json (spec sections 2–3).
// Side and spots rules mirror the park's own computeBox() so our numbers match its site.
import { addDays } from '../site/lib/time.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{2}):(\d{2})(?::\d{2})?$/;
const AREA_ORDER = { reef: 0, bay: 1 };
const SIDE_ORDER = { right: 0, left: 1 };

/** "right" | "left" | null. Bay rows may name pools 1–6; 1–3 are right, 4–6 left (right wins). */
export function sideOf(row) {
  const raw = String(row.area_number ?? '').trim();
  let side = raw === 'left' ? 'left' : raw === 'right' ? 'right' : null;
  if (row.area === 'bay') {
    const pools = raw.split(',').map(p => p.trim());
    if (pools.some(p => ['4', '5', '6'].includes(p))) side = 'left';
    if (pools.some(p => ['1', '2', '3'].includes(p))) side = 'right';
  }
  return side;
}

const isDisabled = v => v === true || v === 1 || v === '1' || v === 'true';
const count = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const hhmm = t => {
  const m = TIME.exec(String(t));
  return m ? `${m[1]}:${m[2]}` : null;
};

/** One raw scheduler row → { date, session } or { skip: reason }. */
export function normalizeRow(row) {
  const side = sideOf(row);
  if (!side) return { skip: `unknown side "${row.area_number}"` };
  if (!DATE.test(String(row.date))) return { skip: `bad date "${row.date}"` };
  const start = hhmm(row.startTime);
  const end = hhmm(row.endTime);
  if (!start || !end || end <= start) return { skip: `bad times "${row.startTime}"-"${row.endTime}"` };
  const capacity = count(row[`${side}_max_users`]);
  const booked = count(row[`${side}_count_users`]);
  if (capacity === null || booked === null) return { skip: 'bad capacity or booked count' };
  const area = row.area === 'bay' ? 'bay' : 'reef';
  const level = area === 'bay' ? 0 : count(row.wave_level);
  if (area === 'reef' && !level) return { skip: `bad wave level "${row.wave_level}"` };
  const spotsLeft = isDisabled(row.disabled) ? 0 : Math.max(0, capacity - booked);
  return {
    date: row.date,
    session: {
      id: row.scheduler_id,
      start,
      end,
      name: String(row.name ?? '').trim(),
      level,
      area,
      side,
      capacity,
      booked,
      spotsLeft,
      available: spotsLeft > 0,
    },
  };
}

const compareSessions = (a, b) =>
  a.start.localeCompare(b.start) ||
  AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
  SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
  a.id - b.id;

/** Raw windows → { schedule, warnings }. Days run from `today` through the last published date. */
export function normalize(windows, { today, fetchedAt }) {
  const warnings = [];
  const byDate = new Map();
  const closed = new Map();
  const seen = new Set();
  for (const w of windows) {
    for (const c of w.close_days ?? []) {
      if (DATE.test(String(c.date)) && c.date >= today) closed.set(c.date, String(c.text ?? '').trim() || 'סגור');
    }
    for (const row of w.scheduler ?? []) {
      if (seen.has(row.scheduler_id)) continue;
      seen.add(row.scheduler_id);
      const result = normalizeRow(row);
      if (result.skip) {
        warnings.push(`skipped row ${row.scheduler_id}: ${result.skip}`);
        continue;
      }
      if (result.date < today) continue;
      if (!byDate.has(result.date)) byDate.set(result.date, []);
      byDate.get(result.date).push(result.session);
    }
  }

  const dates = [...byDate.keys(), ...closed.keys()].sort();
  const publishedThrough = dates.at(-1) ?? null;
  const days = [];
  for (let date = today; publishedThrough && date <= publishedThrough; date = addDays(date, 1)) {
    const sessions = (byDate.get(date) ?? []).sort(compareSessions);
    days.push({
      date,
      open: sessions.length ? sessions[0].start : null,
      close: sessions.reduce((latest, s) => (latest === null || s.end > latest ? s.end : latest), null),
      closed: closed.get(date) ?? null,
      sessions,
    });
  }
  return { schedule: { fetchedAt, publishedThrough, days }, warnings };
}
```

Watch out: Bay rows have level 0, so validate the wave level for reef rows only. A plain `if (!level)` silently drops all 51 Bay rows (the fixture test then counts 387 sessions instead of 438).

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test scraper/test/normalize.test.mjs`
Expected: `tests 9`, `pass 9`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scraper/normalize.mjs scraper/test/normalize.test.mjs scraper/test-support/fake-park.mjs
git commit -m "feat: normalize park schedule rows into the data model"
```

---

### Task 3: Fetching windows with retries

**Files:**
- Create: `scraper/fetch.mjs`
- Test: `scraper/test/fetch.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `toParkDate` from `site/lib/time.mjs`; test helpers from Task 2.
- Produces (`scraper/fetch.mjs`):
  - `PARK_URL`, `RETRY_WAITS_MS = [2000, 4000, 8000]`
  - `windowUrl(fromIso) → string`
  - `fetchWindow(fromIso, { fetchImpl = fetch, sleep, log }) → Promise<rawWindow>`; throws `window <iso>: <reason> (after 4 attempts)`
  - `fetchHorizon(today, { maxWindows = 12, fetchImpl, sleep, log }) → Promise<rawWindow[]>`

- [ ] **Step 1: Write the failing test** in `scraper/test/fetch.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARK_URL, windowUrl, fetchWindow, fetchHorizon } from '../fetch.mjs';
import { EMPTY_WINDOW, response, isoFromUrl, fixtureFetch, scriptedFetch, recordingSleep } from '../test-support/fake-park.mjs';

const GOOD = { success: true, scheduler: [{ scheduler_id: 1 }], close_days: [] };

test('windowUrl asks for one 3-day window in the park date format', () => {
  assert.equal(windowUrl('2026-09-10'), `${PARK_URL}?ajax=1&from_date=10%2F09%2F26`);
});

test('fetchWindow sends the XHR header the park requires', async () => {
  const fetchImpl = fixtureFetch();
  const body = await fetchWindow('2026-09-10', { fetchImpl });
  assert.equal(body.scheduler.length, 88);
  assert.equal(fetchImpl.calls[0].init.headers['X-Requested-With'], 'XMLHttpRequest');
});

test('fetchWindow retries with 2 s, 4 s waits and then succeeds', async () => {
  const fetchImpl = scriptedFetch([new Error('socket hang up'), response('oops', { status: 500 }), response(GOOD)]);
  const sleep = recordingSleep();
  const body = await fetchWindow('2026-09-10', { fetchImpl, sleep });
  assert.deepEqual(body, GOOD);
  assert.deepEqual(sleep.waits, [2000, 4000]);
});

test('fetchWindow gives up after 4 attempts with a clear message', async () => {
  const fetchImpl = scriptedFetch([response('oops', { status: 500 })]);
  const sleep = recordingSleep();
  await assert.rejects(fetchWindow('2026-09-10', { fetchImpl, sleep }), /window 2026-09-10: HTTP 500 \(after 4 attempts\)/);
  assert.equal(fetchImpl.calls.length, 4);
  assert.deepEqual(sleep.waits, [2000, 4000, 8000]);
});

test('fetchWindow rejects the abuse page and unsuccessful bodies', async () => {
  const sleep = recordingSleep();
  await assert.rejects(fetchWindow('2026-09-10', { fetchImpl: scriptedFetch([response('<!DOCTYPE html>')]), sleep }), /not JSON/);
  await assert.rejects(fetchWindow('2026-09-10', { fetchImpl: scriptedFetch([response({ success: false })]), sleep }), /no success:true/);
});

test('fetchHorizon walks the real fixtures and stops after two empty windows', async () => {
  const fetchImpl = fixtureFetch();
  const windows = await fetchHorizon('2026-09-10', { fetchImpl });
  assert.deepEqual(fetchImpl.calls.map(c => isoFromUrl(c.url)), [
    '2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28',
  ]);
  assert.equal(windows.length, 7);
});

test('fetchHorizon: a window with only a close day is not empty', async () => {
  const closeOnly = { ...EMPTY_WINDOW, close_days: [{ date: '2026-09-21', text: 'יום כיפור' }] };
  const fetchImpl = scriptedFetch([response(GOOD), response(EMPTY_WINDOW), response(closeOnly), response(EMPTY_WINDOW), response(EMPTY_WINDOW), response(GOOD)]);
  const windows = await fetchHorizon('2026-09-10', { fetchImpl });
  assert.equal(windows.length, 5);
});

test('fetchHorizon never asks for more than 12 windows', async () => {
  const fetchImpl = scriptedFetch([response(GOOD)]);
  await fetchHorizon('2026-09-10', { fetchImpl });
  assert.equal(fetchImpl.calls.length, 12);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scraper/test/fetch.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/fetch.mjs`.

- [ ] **Step 3: Implement** `scraper/fetch.mjs`

```js
// Fetches the park's schedule, one 3-day window at a time (spec section 4).
import { addDays, toParkDate } from '../site/lib/time.mjs';

export const PARK_URL = 'https://www.srfparktlv.co.il/products/sessions-react/';
export const RETRY_WAITS_MS = [2000, 4000, 8000];

// Without X-Requested-With the park answers with a redirect to an "abuse" page.
const HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const windowUrl = fromIso => `${PARK_URL}?ajax=1&from_date=${encodeURIComponent(toParkDate(fromIso))}`;

async function fetchOnce(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`not JSON (starts with ${JSON.stringify(text.slice(0, 40))})`);
  }
  if (body?.success !== true || !Array.isArray(body.scheduler)) throw new Error('no success:true with a scheduler list');
  return body;
}

/** One window starting at `fromIso`, retried 3 times (2 s, 4 s, 8 s) before giving up. */
export async function fetchWindow(fromIso, { fetchImpl = fetch, sleep = wait, log = () => {} } = {}) {
  const url = windowUrl(fromIso);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url, fetchImpl);
    } catch (err) {
      if (attempt >= RETRY_WAITS_MS.length) throw new Error(`window ${fromIso}: ${err.message} (after ${attempt + 1} attempts)`);
      log(`window ${fromIso}: ${err.message}; retrying in ${RETRY_WAITS_MS[attempt] / 1000}s`);
      await sleep(RETRY_WAITS_MS[attempt]);
    }
  }
}

/** Consecutive windows from `today` until 2 in a row have no sessions and no close days (max 12). */
export async function fetchHorizon(today, { maxWindows = 12, ...options } = {}) {
  const windows = [];
  let emptyInARow = 0;
  for (let from = today; windows.length < maxWindows && emptyInARow < 2; from = addDays(from, 3)) {
    const w = await fetchWindow(from, options);
    windows.push(w);
    const hasData = w.scheduler.length > 0 || (w.close_days ?? []).length > 0;
    emptyInARow = hasData ? 0 : emptyInARow + 1;
  }
  return windows;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test scraper/test/fetch.test.mjs`
Expected: `tests 8`, `pass 8`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scraper/fetch.mjs scraper/test/fetch.test.mjs
git commit -m "feat: fetch park schedule windows with retries"
```

---

### Task 4: The scrape command and the first data file

**Files:**
- Create: `scraper/scrape.mjs`
- Test: `scraper/test/scrape.test.mjs`
- Create (generated): `site/data/schedule.json`

**Interfaces:**
- Consumes: `israelToday`, `israelIso` (Task 1), `fetchHorizon` (Task 3), `normalize` (Task 2).
- Produces (`scraper/scrape.mjs`):
  - `DATA_FILE` (absolute path of `site/data/schedule.json`)
  - `countSessions(schedule | null, fromDate) → number`
  - `scrape({ now, existing, log, fetchImpl, sleep }) → Promise<schedule>`; throws if the park returns no sessions while `existing` has upcoming ones
  - `main({ file = DATA_FILE, log, ...scrapeOptions }) → Promise<schedule>`; CLI entry when run as `node scraper/scrape.mjs` (exit code 1 on failure, file untouched)

- [ ] **Step 1: Write the failing test** in `scraper/test/scrape.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scrape, main, countSessions } from '../scrape.mjs';
import { EMPTY_WINDOW, response, fixtureFetch, scriptedFetch } from '../test-support/fake-park.mjs';

const NOW = new Date('2026-09-10T13:17:05Z'); // 16:17:05 in Israel
const quiet = () => {};

test('scrape builds the schedule from today in Israel time', async () => {
  const schedule = await scrape({ now: NOW, fetchImpl: fixtureFetch(), log: quiet });
  assert.equal(schedule.fetchedAt, '2026-09-10T16:17:05+03:00');
  assert.equal(schedule.days[0].date, '2026-09-10');
  assert.equal(schedule.publishedThrough, '2026-09-24');
  assert.equal(countSessions(schedule, '2026-09-10'), 438);
});

test('scrape refuses to replace upcoming sessions with nothing', async () => {
  const existing = { days: [{ date: '2026-09-10', sessions: [{ id: 1 }] }] };
  const fetchImpl = scriptedFetch([response(EMPTY_WINDOW)]);
  await assert.rejects(scrape({ now: NOW, existing, fetchImpl, log: quiet }), /returned no sessions/);
});

test('scrape accepts an empty park when there was nothing upcoming anyway', async () => {
  const existing = { days: [{ date: '2026-09-09', sessions: [{ id: 1 }] }] };
  const schedule = await scrape({ now: NOW, existing, fetchImpl: scriptedFetch([response(EMPTY_WINDOW)]), log: quiet });
  assert.deepEqual(schedule.days, []);
});

test('scrape logs skipped rows as warnings', async () => {
  const bad = { success: true, close_days: [], scheduler: [{ scheduler_id: 9, area: 'reef', area_number: 'middle', date: '2026-09-10' }] };
  const lines = [];
  await scrape({ now: NOW, fetchImpl: scriptedFetch([response(bad), response(EMPTY_WINDOW)]), log: l => lines.push(l) });
  assert.ok(lines.some(l => l.startsWith('warning: skipped row 9')), lines.join('\n'));
});

test('main writes readable JSON and keeps the old file when scraping fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srfsc-'));
  const file = join(dir, 'data', 'schedule.json');
  await main({ file, now: NOW, fetchImpl: fixtureFetch(), log: quiet });
  const text = await readFile(file, 'utf8');
  assert.ok(text.startsWith('{\n  "fetchedAt": "2026-09-10T16:17:05+03:00"'));
  assert.ok(text.endsWith('}\n'));

  await writeFile(file, text);
  await assert.rejects(main({ file, now: NOW, fetchImpl: scriptedFetch([response(EMPTY_WINDOW)]), log: quiet }));
  assert.equal(await readFile(file, 'utf8'), text);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test scraper/test/scrape.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scraper/scrape.mjs`.

- [ ] **Step 3: Implement** `scraper/scrape.mjs`

```js
// CLI: fetch the park's schedule and write site/data/schedule.json (spec section 4).
// Usage: node scraper/scrape.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { israelIso, israelToday } from '../site/lib/time.mjs';
import { fetchHorizon } from './fetch.mjs';
import { normalize } from './normalize.mjs';

export const DATA_FILE = fileURLToPath(new URL('../site/data/schedule.json', import.meta.url));

/** Sessions on days from `fromDate` on (any schedule shape, including null). */
export const countSessions = (schedule, fromDate) =>
  (schedule?.days ?? []).filter(d => d.date >= fromDate).reduce((n, d) => n + d.sessions.length, 0);

/** Fetch + normalize. Throws instead of replacing upcoming sessions with nothing. */
export async function scrape({ now = new Date(), existing = null, log = console.log, ...fetchOptions } = {}) {
  const today = israelToday(now);
  const windows = await fetchHorizon(today, { log, ...fetchOptions });
  const { schedule, warnings } = normalize(windows, { today, fetchedAt: israelIso(now) });
  for (const w of warnings) log(`warning: ${w}`);
  if (countSessions(schedule, today) === 0 && countSessions(existing, today) > 0) {
    throw new Error('the park returned no sessions but the current file has upcoming ones (blocked?); keeping the current file');
  }
  return schedule;
}

async function readExisting(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Scrape and write `file` (2-space JSON, trailing newline). */
export async function main({ file = DATA_FILE, log = console.log, ...scrapeOptions } = {}) {
  const existing = await readExisting(file);
  const schedule = await scrape({ existing, log, ...scrapeOptions });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(schedule, null, 2)}\n`);
  log(`wrote ${schedule.days.length} days, ${countSessions(schedule, '')} sessions, published through ${schedule.publishedThrough}`);
  return schedule;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`scrape failed: ${err.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test scraper/test/scrape.test.mjs`
Expected: `tests 5`, `pass 5`, `fail 0`.

- [ ] **Step 5: Scrape the live park once**

Run: `node scraper/scrape.mjs`
Expected: one line like `wrote 15 days, 438 sessions, published through 2026-09-24` (the numbers depend on the day you run it), and `site/data/schedule.json` starts with `"fetchedAt"` in Israel time. If it prints `scrape failed: …`, stop and report the message: the park may have changed its API.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: `pass 29`, `fail 0` (7 + 9 + 8 + 5).

- [ ] **Step 7: Commit**

```bash
git add scraper/scrape.mjs scraper/test/scrape.test.mjs site/data/schedule.json
git commit -m "feat: add scrape command and first schedule data"
```

---

### Task 5: View logic and the stale-data rule

Pure functions the renderer builds on: grouping sessions into calendar blocks, the overlap layout (spec section 6), the week and month ranges, past/now, month-cell summaries, day-view rows, tidy session names, and when to warn that data is old (spec section 8).

**Files:**
- Create: `site/lib/schedule.mjs`
- Create: `site/lib/stale.mjs`
- Test: `test/site/schedule.test.mjs`
- Test: `test/site/stale.test.mjs`

**Interfaces:**
- Consumes: `addDays`, `dayOfWeek`, `daysBetween`, `minutes`, `HE_MONTHS`, `israelTime` (Task 1). Session and day shapes (Task 2).
- Produces (`site/lib/schedule.mjs`):
  - `groupBlocks(sessions) → [{ start, end, area, sessions }]` (same start + end + area; sorted by start, reef first)
  - `layoutBlocks(blocks) → blocks with x0, x1` (percent from the inline start; full width 0–100 alone, reef 0–64 / Bay 64–100 in an overlapping cluster, same-area overlaps split side by side)
  - `reefSides(block) → { right, left, shared }`
  - `dayRows(sessions) → [{ start, end, area, main, right, left }]`
  - `weekDates(today) → 7 isos`; `hourRange(days) → { from, to }` (default `{ from: 6, to: 22 }`)
  - `monthDates(today, publishedThrough) → isos` (this week's Sunday through the week holding `publishedThrough`, plus one week); `monthTitle(dates) → 'ספטמבר–אוקטובר 2026'`
  - `isPast(item, date, today, now)`, `isNow(item, date, today, now)` (item has `start`/`end`; only true on `today`)
  - `daySummary(day) → { freeSpots, levels }`; `displayName(name) → { title, note }`
- Produces (`site/lib/stale.mjs`): `isStale(fetchedAtIso, now?) → boolean` (older than 12 h, or older than 3 h between 07:00 and 23:30 Israel time)

- [ ] **Step 1: Write the failing tests** in `test/site/schedule.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupBlocks, layoutBlocks, reefSides, weekDates, hourRange, monthDates, monthTitle,
  isPast, isNow, daySummary, dayRows, displayName,
} from '../../site/lib/schedule.mjs';

let nextId = 1;
const s = (start, end, over = {}) => ({
  id: nextId++, start, end, name: 'L3 - Intermediate (M3)', level: 3, area: 'reef', side: 'right',
  capacity: 18, booked: 5, spotsLeft: 13, available: true, ...over,
});
const bay = (start, end, over = {}) => s(start, end, { area: 'bay', level: 0, name: 'שיעור גלישה למתחילים ב Bay - ילדים 7-10', ...over });
const pos = blocks => blocks.map(b => [b.start, b.area, Math.round(b.x0), Math.round(b.x1)]);

test('groupBlocks joins sessions with the same start, end and area', () => {
  const blocks = groupBlocks([
    s('17:00', '18:00'), s('17:00', '18:00', { side: 'left' }),
    bay('17:30', '19:00'), bay('17:30', '19:00', { side: 'left' }),
    s('16:00', '17:00'),
  ]);
  assert.deepEqual(blocks.map(b => [b.start, b.area, b.sessions.length]), [
    ['16:00', 'reef', 1], ['17:00', 'reef', 2], ['17:30', 'bay', 2],
  ]);
});

test('layoutBlocks: blocks that overlap nothing use the full width; touching is not overlapping', () => {
  const blocks = groupBlocks([s('06:00', '07:00'), s('07:00', '08:00')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [['06:00', 'reef', 0, 100], ['07:00', 'reef', 0, 100]]);
});

test('layoutBlocks: reef and Bay overlapping split 64/36 for the whole cluster', () => {
  const blocks = groupBlocks([s('16:00', '17:00'), s('17:00', '18:00'), bay('17:30', '19:00'), s('18:00', '19:00'), s('19:00', '20:00')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [
    ['16:00', 'reef', 0, 100],
    ['17:00', 'reef', 0, 64],
    ['17:30', 'bay', 64, 100],
    ['18:00', 'reef', 0, 64],
    ['19:00', 'reef', 0, 100],
  ]);
});

test('layoutBlocks: same-area blocks that overlap at different times share the lane', () => {
  const blocks = groupBlocks([bay('10:00', '11:30'), bay('11:00', '12:30')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [['10:00', 'bay', 0, 50], ['11:00', 'bay', 50, 100]]);
});

test('reefSides: one shared session, or different sessions per side', () => {
  const same = groupBlocks([s('06:00', '07:00'), s('06:00', '07:00', { side: 'left' })])[0];
  assert.equal(reefSides(same).shared, true);
  const split = groupBlocks([
    s('20:00', '21:00', { name: 'ריטריט נשים נטלי', level: 2 }),
    s('20:00', '21:00', { side: 'left', name: 'L2 Improvers (M2) - כולל גלשן סופט ללא עלות', level: 2 }),
  ])[0];
  const sides = reefSides(split);
  assert.equal(sides.shared, false);
  assert.equal(sides.right.name, 'ריטריט נשים נטלי');
  const rightOnly = groupBlocks([s('06:00', '07:00')])[0];
  assert.deepEqual([reefSides(rightOnly).shared, reefSides(rightOnly).left], [true, null]);
});

test('dayRows: one row per shared reef pair, two for split sides, one per Bay lesson', () => {
  const rows = dayRows([
    s('06:00', '07:00'), s('06:00', '07:00', { side: 'left' }),
    s('20:00', '21:00', { name: 'ריטריט נשים נטלי' }), s('20:00', '21:00', { side: 'left' }),
    bay('15:30', '17:00'), bay('15:30', '17:00', { side: 'left', name: 'שיעור גלישה למתחילים ב Bay - ילדים 11-16' }),
  ]);
  assert.deepEqual(rows.map(r => [r.start, r.area, r.right ? 'R' : '-', r.left ? 'L' : '-']), [
    ['06:00', 'reef', 'R', 'L'],
    ['15:30', 'bay', '-', '-'],
    ['15:30', 'bay', '-', '-'],
    ['20:00', 'reef', 'R', '-'],
    ['20:00', 'reef', '-', 'L'],
  ]);
  assert.equal(rows[2].main.name, 'שיעור גלישה למתחילים ב Bay - ילדים 11-16');
});

test('weekDates and hourRange', () => {
  assert.deepEqual(weekDates('2026-09-10'), ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  assert.deepEqual(hourRange([{ sessions: [s('08:00', '09:00'), bay('17:30', '19:00')] }, undefined, { sessions: [s('06:00', '07:00'), s('22:00', '23:00')] }]), { from: 6, to: 23 });
  assert.deepEqual(hourRange([undefined, { sessions: [] }]), { from: 6, to: 22 });
});

test('monthDates starts on this week\'s Sunday and adds one week past the last published day', () => {
  const dates = monthDates('2026-09-10', '2026-09-24');
  assert.equal(dates.length, 28);
  assert.equal(dates[0], '2026-09-06');
  assert.equal(dates.at(-1), '2026-10-03');
  assert.equal(monthDates('2026-09-10', null).length, 14);
});

test('monthTitle names one or two months', () => {
  assert.equal(monthTitle(['2026-09-06', '2026-10-03']), 'ספטמבר–אוקטובר 2026');
  assert.equal(monthTitle(['2026-09-06', '2026-09-26']), 'ספטמבר 2026');
});

test('isPast and isNow only apply to today', () => {
  const x = s('16:00', '17:00');
  assert.equal(isNow(x, '2026-09-10', '2026-09-10', '16:20'), true);
  assert.equal(isPast(x, '2026-09-10', '2026-09-10', '16:20'), false);
  assert.equal(isPast(x, '2026-09-10', '2026-09-10', '17:00'), true);
  assert.equal(isNow(x, '2026-09-10', '2026-09-10', '17:00'), false);
  assert.equal(isPast(x, '2026-09-11', '2026-09-10', '23:00'), false);
});

test('daySummary counts free spots and lists reef levels in time order', () => {
  const day = { sessions: [s('06:00', '07:00', { level: 6, spotsLeft: 8 }), s('06:00', '07:00', { level: 6, side: 'left', spotsLeft: 6 }), bay('08:30', '10:00', { spotsLeft: 3 }), s('07:00', '08:00', { level: 5, spotsLeft: 0 })] };
  assert.deepEqual(daySummary(day), { freeSpots: 17, levels: [6, 5] });
  assert.deepEqual(daySummary(undefined), { freeSpots: 0, levels: [] });
});

test('displayName tidies the park\'s names', () => {
  assert.deepEqual(displayName('L6 Pro (T2+B2)'), { title: 'Pro (T2+B2)', note: '' });
  assert.deepEqual(displayName('L5 - Expert  (T2 Only)'), { title: 'Expert (T2 Only)', note: '' });
  assert.deepEqual(displayName('L4 – Advanced (T1 Only)'), { title: 'Advanced (T1 Only)', note: '' });
  assert.deepEqual(displayName('L2 Improvers (M2) - כולל גלשן סופט ללא עלות'), { title: 'Improvers (M2)', note: 'כולל גלשן סופט' });
  assert.deepEqual(displayName('שיעור גלישה למתחילים ב Bay - ילדים 7-10'), { title: 'שיעור מתחילים ב־Bay', note: 'ילדים 7-10' });
  assert.deepEqual(displayName('ריטריט נשים נטלי'), { title: 'ריטריט נשים נטלי', note: '' });
});
```

and in `test/site/stale.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale } from '../../site/lib/stale.mjs';

// All "now" values are Israel summer time (UTC+3).
const at = israel => new Date(`${israel}+03:00`);

test('fresh data is not stale', () => {
  assert.equal(isStale('2026-09-10T13:17:00+03:00', at('2026-09-10T14:00:00')), false);
});

test('more than 3 hours old during the day is stale', () => {
  assert.equal(isStale('2026-09-10T10:17:00+03:00', at('2026-09-10T14:00:00')), true);
  assert.equal(isStale('2026-09-10T11:00:00+03:00', at('2026-09-10T14:00:00')), false); // exactly 3 h
});

test('the overnight pause is not stale, but 12 hours always is', () => {
  assert.equal(isStale('2026-09-09T23:17:00+03:00', at('2026-09-10T06:30:00')), false);
  assert.equal(isStale('2026-09-09T17:00:00+03:00', at('2026-09-10T06:30:00')), true);
});

test('unreadable timestamps count as stale', () => {
  assert.equal(isStale('not a date', at('2026-09-10T14:00:00')), true);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/site/schedule.test.mjs test/site/stale.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/schedule.mjs` and `site/lib/stale.mjs`.

- [ ] **Step 3: Implement** `site/lib/schedule.mjs`

```js
// Pure view logic over the schedule model (spec section 6). No DOM here.
import { addDays, dayOfWeek, daysBetween, minutes, HE_MONTHS } from './time.mjs';

const AREA_ORDER = { reef: 0, bay: 1 };

/** Sessions sharing start, end and area form one block. Sorted by start, reef before Bay. */
export function groupBlocks(sessions) {
  const blocks = [];
  for (const s of sessions) {
    let block = blocks.find(b => b.start === s.start && b.end === s.end && b.area === s.area);
    if (!block) blocks.push((block = { start: s.start, end: s.end, area: s.area, sessions: [] }));
    block.sessions.push(s);
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start) || AREA_ORDER[a.area] - AREA_ORDER[b.area]);
}

/**
 * Calendar overlap layout. Adds x0/x1 (percent of the column width, measured from the
 * inline start, i.e. the right edge in RTL). A block that overlaps nothing spans 0–100.
 * In a cluster of overlapping blocks, reef gets 0–64 and Bay 64–100 when both are present,
 * and same-area blocks that overlap split their share side by side. Touching isn't overlapping.
 */
export function layoutBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start) || AREA_ORDER[a.area] - AREA_ORDER[b.area]);
  const out = [];
  let cluster = [];
  let clusterEnd = '';
  const flush = () => {
    const lanes = { reef: [], bay: [] };
    const sub = new Map();
    for (const b of cluster) {
      const ends = lanes[b.area];
      let i = ends.findIndex(end => end <= b.start);
      if (i < 0) {
        i = ends.length;
        ends.push(b.end);
      } else {
        ends[i] = b.end;
      }
      sub.set(b, i);
    }
    const both = lanes.reef.length > 0 && lanes.bay.length > 0;
    for (const b of cluster) {
      const [a0, a1] = !both ? [0, 100] : b.area === 'reef' ? [0, 64] : [64, 100];
      const width = (a1 - a0) / lanes[b.area].length;
      const x0 = a0 + sub.get(b) * width;
      out.push({ ...b, x0, x1: x0 + width });
    }
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    clusterEnd = cluster.length && clusterEnd > b.end ? clusterEnd : b.end;
    cluster.push(b);
  }
  if (cluster.length) flush();
  return out;
}

/** A reef block's two sides. `shared` = one session on both sides (or only one side exists). */
export function reefSides(block) {
  const right = block.sessions.find(s => s.side === 'right') ?? null;
  const left = block.sessions.find(s => s.side === 'left') ?? null;
  const shared = !right || !left || (right.name === left.name && right.level === left.level);
  return { right, left, shared };
}

/** The 7 dates of the week view, starting today. */
export const weekDates = today => Array.from({ length: 7 }, (_, i) => addDays(today, i));

/** Whole hours covering every session of the given days: { from, to }. Defaults to 6–22. */
export function hourRange(days) {
  const sessions = days.flatMap(d => d?.sessions ?? []);
  if (!sessions.length) return { from: 6, to: 22 };
  return {
    from: Math.floor(Math.min(...sessions.map(s => minutes(s.start))) / 60),
    to: Math.ceil(Math.max(...sessions.map(s => minutes(s.end))) / 60),
  };
}

/** Month view: from this week's Sunday through the week holding `publishedThrough`, plus one week. */
export function monthDates(today, publishedThrough) {
  const start = addDays(today, -dayOfWeek(today));
  const weeks = Math.floor(daysBetween(start, publishedThrough ?? today) / 7) + 2;
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** "ספטמבר 2026" or "ספטמבר–אוקטובר 2026" for a list of dates. */
export function monthTitle(dates) {
  const first = dates[0];
  const last = dates.at(-1);
  const m1 = HE_MONTHS[Number(first.slice(5, 7)) - 1];
  const m2 = HE_MONTHS[Number(last.slice(5, 7)) - 1];
  return m1 === m2 ? `${m1} ${last.slice(0, 4)}` : `${m1}–${m2} ${last.slice(0, 4)}`;
}

/** Finished today (`now` is Israel "HH:MM"). */
export const isPast = (session, date, today, now) => date === today && session.end <= now;

/** Running right now. */
export const isNow = (session, date, today, now) => date === today && session.start <= now && now < session.end;

/** For month cells: total spots left and the reef levels in time order (one per reef block). */
export function daySummary(day) {
  const sessions = day?.sessions ?? [];
  return {
    freeSpots: sessions.reduce((n, s) => n + s.spotsLeft, 0),
    levels: groupBlocks(sessions).filter(b => b.area === 'reef').map(b => b.sessions[0].level),
  };
}

/**
 * Day-view rows: a reef pair running one session is one row (right + left); different sessions
 * on the two sides are two rows; each Bay lesson is its own row. { start, end, area, main, right, left }.
 */
export function dayRows(sessions) {
  const rows = [];
  for (const block of groupBlocks(sessions)) {
    const { start, end, area } = block;
    if (area === 'bay') {
      for (const s of block.sessions) rows.push({ start, end, area, main: s, right: null, left: null });
      continue;
    }
    const { right, left, shared } = reefSides(block);
    if (shared) {
      rows.push({ start, end, area, main: right ?? left, right, left });
    } else {
      rows.push({ start, end, area, main: right, right, left: null });
      rows.push({ start, end, area, main: left, right: null, left });
    }
  }
  return rows;
}

/** Park name → { title, note }: drop the level prefix; "כולל גלשן סופט…" and Bay age groups become the note. */
export function displayName(name) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.includes('Bay')) return { title: 'שיעור מתחילים ב־Bay', note: clean.split(' - ').at(-1) };
  return {
    title: clean.replace(/\s*-\s*כולל.*$/, '').replace(/^L\d\s*[-–]?\s*/, '').trim(),
    note: clean.includes('כולל גלשן סופט') ? 'כולל גלשן סופט' : '',
  };
}
```

- [ ] **Step 4: Implement** `site/lib/stale.mjs`

```js
// When to warn that the data is old (spec section 8).
import { israelTime } from './time.mjs';

const HOUR = 3600000;

/**
 * Stale if older than 12 hours at any time, or older than 3 hours while the park is
 * normally being scraped (07:00–23:30 Israel time; the overnight pause doesn't count).
 */
export function isStale(fetchedAtIso, now = new Date()) {
  const age = now.getTime() - Date.parse(fetchedAtIso);
  if (!Number.isFinite(age)) return true;
  if (age > 12 * HOUR) return true;
  const time = israelTime(now);
  return time >= '07:00' && time <= '23:30' && age > 3 * HOUR;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `node --test test/site/schedule.test.mjs test/site/stale.test.mjs`
Expected: `tests 16`, `pass 16`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add site/lib/schedule.mjs site/lib/stale.mjs test/site/schedule.test.mjs test/site/stale.test.mjs
git commit -m "feat: add schedule view logic and stale-data rule"
```

---

### Task 6: The refresh-button flow

Starts the workflow, follows its run, and reads the fresh file from the GitHub API (spec section 8). Verified on 2026-09-10: the dispatch endpoint returns `200` with `workflow_run_id` (older behaviour: `204`, no body), `api.github.com` allows cross-origin calls, and the GitHub Pages CDN ignores `?t=` query strings, which is why the new data is read from the API rather than from Pages.

**Files:**
- Create: `site/lib/refresh.mjs`
- Test: `test/site/refresh.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (config comes from the caller).
- Produces (`site/lib/refresh.mjs`):
  - `API = 'https://api.github.com'`
  - `class RefreshError extends Error { kind: 'unauthorized'|'forbidden'|'network'|'failed'|'timeout'; url: string|null }` (Hebrew `message`)
  - `refresh({ token, config: { owner, repo, workflow, branch, dataPath }, fetchImpl, sleep, now, onStatus, pollMs = 5000, lookupMs = 30000, timeoutMs = 600000 }) → Promise<schedule>`
  - `onStatus({ phase: 'starting'|'queued'|'running', elapsedMs, url })`

- [ ] **Step 1: Write the failing test** in `test/site/refresh.test.mjs`

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
function fakeGitHub({ dispatch = json({ workflow_run_id: 42, run_url: 'x', html_url: 'https://github.com/run/42' }), runs, lists = [], content = json(SCHEDULE) }) {
  const calls = [];
  let runPoll = 0;
  let listPoll = 0;
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/dispatches')) return dispatch;
    if (url.includes('/runs?')) return json(lists[Math.min(listPoll++, lists.length - 1)]);
    if (url.startsWith(`${REPO}/actions/runs/`)) return json(runs[Math.min(runPoll++, runs.length - 1)]);
    if (url.startsWith(`${REPO}/contents/`)) return content;
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

  assert.deepEqual(result, SCHEDULE);
  assert.deepEqual(phases, ['starting', 'queued', 'running']);
  const [dispatch] = fetchImpl.calls;
  assert.equal(dispatch.url, `${REPO}/actions/workflows/update.yml/dispatches`);
  assert.equal(dispatch.init.method, 'POST');
  assert.equal(dispatch.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' });
  const read = fetchImpl.calls.at(-1);
  assert.equal(read.url, `${REPO}/contents/site/data/schedule.json?ref=main`);
  assert.equal(read.init.headers.Accept, 'application/vnd.github.raw+json');
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/site/refresh.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/refresh.mjs`.

- [ ] **Step 3: Implement** `site/lib/refresh.mjs`

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
 * Runs one refresh and resolves with the fresh schedule object.
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
}) {
  const repo = `${API}/repos/${config.owner}/${config.repo}`;
  const call = async (url, init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
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
    body: JSON.stringify({ ref: config.branch }),
  });
  // Newer API versions answer 200 with the run id; older ones 204 with no body.
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
      if (run.conclusion !== 'success') throw new RefreshError('failed', 'העדכון נכשל', run.html_url);
      break;
    }
    const elapsedMs = now() - startedAt;
    if (elapsedMs > timeoutMs) throw new RefreshError('timeout', 'העדכון עדיין רץ', run.html_url);
    onStatus({ phase: QUEUED.has(run.status) ? 'queued' : 'running', elapsedMs, url: run.html_url });
    await sleep(pollMs);
  }

  const file = await call(`${repo}/contents/${config.dataPath}?ref=${encodeURIComponent(config.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  return file.json();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/site/refresh.test.mjs`
Expected: `tests 6`, `pass 6`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/lib/refresh.mjs test/site/refresh.test.mjs
git commit -m "feat: add refresh flow against the GitHub API"
```

---

### Task 7: Rendering the three views

HTML strings for the week (calendar blocks), month and day views, following the spec's sections 6–7 and the mockup. Class names here are the contract with `site/styles.css` (Task 8); the `data-*` attributes are the contract with `site/app.js` (Task 8).

**Files:**
- Create: `site/lib/render.mjs`
- Test: `test/site/render.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`HE_DAYS`, `HE_DAYS_SHORT`, `dayOfWeek`, `minutes`, `shortDate`), Task 5 (all of `schedule.mjs`), Task 2 (`normalize`, `fixtureWindow` in the test).
- Produces (`site/lib/render.mjs`):
  - `HOUR_PX = 56`, `LEVELS = [0..6]`, `escapeHtml(value)`, `chip(level)`, `spot(spotsLeft)`
  - `renderLevelChips(levels: Set<number>) → html`
  - `renderWeek(schedule, ctx)`, `renderMonth(schedule, ctx)`, `renderDay(schedule, date, ctx) → html`, where `ctx = { today: 'YYYY-MM-DD', now: 'HH:MM', levels: Set<number>, showPast: boolean }`
  - Click targets it emits: `data-day="<iso>"` (week headers, month cells), `data-level="<n>"` (chips), `data-step="-1|1"` (day nav), `data-toggle-past` (day view)

- [ ] **Step 1: Write the failing test** in `test/site/render.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../scraper/normalize.mjs';
import { fixtureWindow } from '../../scraper/test-support/fake-park.mjs';
import { groupBlocks, weekDates } from '../../site/lib/schedule.mjs';
import { escapeHtml, renderWeek, renderMonth, renderDay, renderLevelChips } from '../../site/lib/render.mjs';

const DATES = ['2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const { schedule } = normalize(DATES.map(fixtureWindow), { today: '2026-09-10', fetchedAt: '2026-09-10T16:17:00+03:00' });
const ctx = (over = {}) => ({ today: '2026-09-10', now: '16:20', levels: new Set(), showPast: false, ...over });
const count = (html, needle) => html.split(needle).length - 1;
/** The HTML of the week block whose title starts with `titleStart`. */
const blockHtml = (html, titleStart) => {
  const at = html.indexOf(`title="${titleStart}`);
  assert.ok(at > 0, `no block titled ${titleStart}`);
  const from = html.lastIndexOf('<div class="blk', at);
  return html.slice(from, html.indexOf('</div></div>', at) + 12);
};

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('week: 7 day headers from today, full opening hours, hour labels', () => {
  const html = renderWeek(schedule, ctx());
  assert.equal(count(html, 'data-day="'), 7);
  assert.ok(html.includes('<button class="dh is-today" data-day="2026-09-10"><span class="dn">היום</span>'));
  assert.ok(html.includes('פתוח <span class="ltr num">06:00–14:00</span>')); // Friday 11.9
  assert.ok(html.includes('<div class="num">06:00</div>'));
  assert.ok(html.includes('<div class="num">22:00</div>')); // 14.9 ends at 23:00
});

test('week: one block per start/end/area with its time on top, and a now line on today', () => {
  const html = renderWeek(schedule, ctx());
  const expected = weekDates('2026-09-10').reduce((n, date) => n + groupBlocks(schedule.days.find(d => d.date === date)?.sessions ?? []).length, 0);
  assert.equal(count(html, '<div class="blk'), expected);
  assert.ok(html.includes('<span class="bt"><span class="ltr num">17:30–19:00</span></span>'));
  assert.equal(count(html, '<div class="now"'), 1);
  assert.match(blockHtml(html, '06:00–07:00 L6 Pro'), /class="blk past"/);
  assert.doesNotMatch(blockHtml(html, '16:00–17:00 L2'), /past/);
});

test('week: different sessions on the two reef sides share one line with a chip each', () => {
  const block = blockHtml(renderWeek(schedule, ctx()), '20:00–21:00 ריטריט');
  assert.equal(count(block, 'class="chip'), 2);
  assert.ok(block.includes('<span class="spot full">מלא</span>')); // the retreat is disabled
});

test('week: the level filter fades other levels', () => {
  const html = renderWeek(schedule, ctx({ levels: new Set([6]) }));
  assert.doesNotMatch(blockHtml(html, '06:00–07:00 L6 Pro'), /\boff\b/);
  assert.match(blockHtml(html, '16:00–17:00 L2'), /\boff\b/);
});

test('month: rolling weeks with closed, empty, unpublished and past days', () => {
  const html = renderMonth(schedule, ctx());
  assert.ok(html.includes('<h2 class="month-title">ספטמבר–אוקטובר 2026</h2>'));
  assert.equal(count(html, 'class="mc"') + count(html, 'class="mc '), 28); // cells, not the inner "mc-top"
  assert.equal(count(html, 'mc is-past'), 4); // 6–9.9
  assert.ok(html.includes('<button class="mc is-today" data-day="2026-09-10">'));
  assert.ok(html.includes('<span class="closed">סגור</span><span class="meta">יום כיפור</span>'));
  assert.equal(count(html, 'mc is-empty'), 1); // 20.9
  assert.equal(count(html, 'טרם פורסם'), 9); // 25.9–3.10
  assert.ok(html.includes('<span class="dd num">1.10</span>'));
  assert.ok(html.includes('<span class="hrs"><span class="ltr num">06:00–22:00</span></span>'));
});

test('day: today opens at now, with finished sessions behind a toggle', () => {
  const html = renderDay(schedule, '2026-09-10', ctx());
  assert.equal(count(html, '<span class="st num">'), 8);
  assert.ok(html.includes('הצגת 10 סשנים שכבר הסתיימו'));
  assert.equal(count(html, 'class="now-tag"'), 1);
  assert.ok(html.includes('<div class="open">פתוח <span class="ltr num">06:00–22:00</span></div>'));

  const all = renderDay(schedule, '2026-09-10', ctx({ showPast: true }));
  assert.equal(count(all, '<span class="st num">'), 18);
  assert.ok(all.includes('הסתרת 10 סשנים שכבר הסתיימו'));
});

test('day: other days show everything; closed and unpublished days explain themselves', () => {
  assert.doesNotMatch(renderDay(schedule, '2026-09-11', ctx()), /סשנים שכבר הסתיימו/);
  const closed = renderDay(schedule, '2026-09-21', ctx());
  assert.ok(closed.includes('סגור: יום כיפור') && closed.includes('הפארק סגור ביום הזה.'));
  assert.ok(renderDay(schedule, '2026-09-30', ctx()).includes('הלוח ליום הזה עוד לא פורסם.'));
});

test('park text never becomes markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const tiny = {
    fetchedAt: 'x', publishedThrough: '2026-09-10',
    days: [{ date: '2026-09-10', open: '08:00', close: '09:00', closed: null, sessions: [
      { id: 1, start: '08:00', end: '09:00', name: evil, level: 3, area: 'reef', side: 'right', capacity: 10, booked: 1, spotsLeft: 9, available: true },
    ] }],
  };
  for (const html of [renderWeek(tiny, ctx({ now: '07:00' })), renderDay(tiny, '2026-09-10', ctx({ now: '07:00' }))]) {
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  }
});

test('level chips show the saved filter', () => {
  const html = renderLevelChips(new Set([2]));
  assert.ok(html.includes('data-level="2" aria-pressed="true"'));
  assert.ok(html.includes('data-level="0" aria-pressed="false" aria-label="Bay"'));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/site/render.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/lib/render.mjs`.

- [ ] **Step 3: Implement** `site/lib/render.mjs`

```js
// HTML for the week, month and day views (spec sections 6–7). Pure functions returning strings.
// Everything that comes from the park is escaped before it reaches the HTML.
import { HE_DAYS, HE_DAYS_SHORT, dayOfWeek, minutes, shortDate } from './time.mjs';
import {
  dayRows, daySummary, displayName, groupBlocks, hourRange, isNow, isPast,
  layoutBlocks, monthDates, monthTitle, reefSides, weekDates,
} from './schedule.mjs';

export const HOUR_PX = 56;
export const LEVELS = [0, 1, 2, 3, 4, 5, 6];

export const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cls = (...names) => names.filter(Boolean).join(' ');
const range = (a, b) => `<span class="ltr num">${a}–${b}</span>`;
const dayOf = (schedule, date) => schedule.days.find(d => d.date === date);
const unpublished = (schedule, date) => !schedule.publishedThrough || date > schedule.publishedThrough;
const filteredOut = (sessions, levels) => levels.size > 0 && sessions.every(s => !levels.has(s.level));

export const chip = level => `<span class="chip lv${level}">${level === 0 ? 'Bay' : `L${level}`}</span>`;

export function spot(spotsLeft) {
  if (spotsLeft === null || spotsLeft === undefined) return '<span class="spot none">–</span>';
  if (spotsLeft === 0) return '<span class="spot full">מלא</span>';
  return `<span class="spot num${spotsLeft <= 3 ? ' few' : ''}">${spotsLeft}</span>`;
}

const pier = (right, left) => `<span class="pier">${spot(right)}<i class="pier-line"></i>${spot(left)}</span>`;

const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

/** The level filter buttons (Bay, L1–L6). */
export function renderLevelChips(levels) {
  const buttons = LEVELS.map(l =>
    `<button class="lv-toggle" data-level="${l}" aria-pressed="${levels.has(l)}" aria-label="${l ? `רמה ${l}` : 'Bay'}">${chip(l)}</button>`);
  return `<span class="levels-label">סינון לפי רמה</span>${buttons.join('')}`;
}

function openLine(schedule, date) {
  const day = dayOf(schedule, date);
  if (day?.closed) return 'סגור';
  if (day?.open) return `פתוח ${range(day.open, day.close)}`;
  return unpublished(schedule, date) ? 'טרם פורסם' : 'אין סשנים';
}

// ---------- week ----------

function weekBlock(block, date, fromHour, ctx) {
  const top = ((minutes(block.start) - fromHour * 60) / 60) * HOUR_PX + 2;
  const height = ((minutes(block.end) - minutes(block.start)) / 60) * HOUR_PX - 4;
  const position = `inset-inline-start:calc(${block.x0}% + 3px);inset-inline-end:calc(${100 - block.x1}% + 3px)`;
  let lines;
  if (block.area === 'bay') {
    lines = block.sessions.map(s => `<div class="sess">${spot(s.spotsLeft)}</div>`).join('');
  } else {
    const { right, left, shared } = reefSides(block);
    lines = shared
      ? `<div class="sess">${chip((right ?? left).level)}${pier(right?.spotsLeft, left?.spotsLeft)}</div>`
      : `<div class="sess">${chip(right.level)}${spot(right.spotsLeft)}<i class="pier-line"></i>${chip(left.level)}${spot(left.spotsLeft)}</div>`;
  }
  const past = block.sessions.every(s => isPast(s, date, ctx.today, ctx.now));
  const title = `${block.start}–${block.end} ${block.sessions.map(s => s.name).join(' / ')}`;
  const classes = cls('blk', block.area === 'bay' && 'bay', past && 'past', filteredOut(block.sessions, ctx.levels) && 'off');
  return `<div class="${classes}" style="top:${top}px;height:${height}px;${position}" title="${escapeHtml(title)}"><span class="bt">${range(block.start, block.end)}</span>${lines}</div>`;
}

function legend() {
  return `<div class="legend">
    <span><span class="sess">${chip(5)}${pier(8, 6)}</span>מקומות פנויים בריף ימין ובריף שמאל</span>
    <span>${spot(2)}נותרו מקומות אחרונים</span>
    <span>${spot(0)}אין מקומות פנויים</span>
    <span><i class="bay-swatch"></i>בלוק חולי הוא שיעור ב־Bay</span>
    <span>גובה הבלוק הוא משך הסשן</span>
  </div>`;
}

/** ctx: { today: "YYYY-MM-DD", now: "HH:MM", levels: Set<number>, showPast: boolean } */
export function renderWeek(schedule, ctx) {
  const dates = weekDates(ctx.today);
  const days = dates.map(d => dayOf(schedule, d));
  const { from, to } = hourRange(days);
  const hours = to - from;
  let html = '<div class="week-scroll"><div class="week"><div class="corner"></div>';
  for (const date of dates) {
    const today = date === ctx.today;
    html += `<button class="${cls('dh', today && 'is-today')}" data-day="${date}"><span class="dn">${today ? 'היום' : HE_DAYS[dayOfWeek(date)]}</span><span class="dd num">${shortDate(date)}</span><span class="hrs">${openLine(schedule, date)}</span></button>`;
  }
  html += `<div class="hours">${Array.from({ length: hours }, (_, i) => `<div class="num">${String(from + i).padStart(2, '0')}:00</div>`).join('')}</div>`;
  dates.forEach((date, i) => {
    const today = date === ctx.today;
    let column = Array.from({ length: hours }, (_, h) => `<i class="gl" style="top:${h * HOUR_PX}px"></i>`).join('');
    column += layoutBlocks(groupBlocks(days[i]?.sessions ?? [])).map(b => weekBlock(b, date, from, ctx)).join('');
    const nowMinutes = minutes(ctx.now);
    if (today && nowMinutes >= from * 60 && nowMinutes <= to * 60) {
      column += `<div class="now" style="top:${((nowMinutes - from * 60) / 60) * HOUR_PX}px"><span>עכשיו</span></div>`;
    }
    html += `<div class="${cls('col', today && 'is-today')}" style="height:${hours * HOUR_PX}px">${column}</div>`;
  });
  return `${html}</div></div>${legend()}`;
}

// ---------- month ----------

export function renderMonth(schedule, ctx) {
  const dates = monthDates(ctx.today, schedule.publishedThrough);
  let html = `<h2 class="month-title">${monthTitle(dates)}</h2><div class="month">`;
  html += HE_DAYS.map((name, i) => `<div class="mh"><span class="l">${name}</span><span class="s">${HE_DAYS_SHORT[i]}</span></div>`).join('');
  for (const date of dates) {
    const day = dayOf(schedule, date);
    const today = date === ctx.today;
    const hasSessions = (day?.sessions.length ?? 0) > 0;
    let kind = '';
    let body = '';
    if (date < ctx.today) {
      kind = 'is-past';
    } else if (day?.closed) {
      kind = 'is-closed';
      body = `<span class="closed">סגור</span><span class="meta">${escapeHtml(day.closed)}</span>`;
    } else if (unpublished(schedule, date)) {
      kind = 'is-unpub';
      body = '<span class="meta">טרם פורסם</span>';
    } else if (hasSessions) {
      const { freeSpots, levels } = daySummary(day);
      body = `<span class="hrs">${range(day.open, day.close)}</span><span class="strip">${levels.map(l => `<i class="lv${l}"></i>`).join('')}</span><span class="free num">${freeSpots} פנויים</span>`;
    } else {
      kind = 'is-empty';
      body = '<span class="meta">אין סשנים</span>';
    }
    const label = date.endsWith('-01') ? shortDate(date) : String(Number(date.slice(8)));
    const top = `<span class="mc-top"><span class="dd num">${label}</span>${today ? '<span class="tag">היום</span>' : ''}</span>`;
    const classes = cls('mc', kind, today && 'is-today');
    html += date >= ctx.today && hasSessions
      ? `<button class="${classes}" data-day="${date}">${top}${body}</button>`
      : `<div class="${classes}">${top}${body}</div>`;
  }
  return `${html}</div>`;
}

// ---------- day ----------

function sideCell(session, label) {
  if (!session) return `<span class="side"><span class="side-l">${label}</span><span class="spot none">–</span></span>`;
  const used = session.capacity ? Math.round(((session.capacity - session.spotsLeft) / session.capacity) * 100) : 100;
  return `<span class="side"><span class="side-l">${label}</span><span class="bar"><i class="lv${session.level}" style="width:${Math.max(0, Math.min(100, used))}%"></i></span>${spot(session.spotsLeft)}</span>`;
}

function dayRow(row, date, ctx) {
  const name = displayName(row.main.name);
  const now = isNow(row, date, ctx.today, ctx.now);
  const sessions = row.area === 'bay' ? [row.main] : [row.right, row.left].filter(Boolean);
  const sides = row.area === 'bay'
    ? `<span class="sides bay">${sideCell(row.main, 'Bay')}</span>`
    : `<span class="sides">${sideCell(row.right, 'ימין')}${sideCell(row.left, 'שמאל')}</span>`;
  const classes = cls('row', isPast(row, date, ctx.today, ctx.now) && 'past', now && 'is-now', filteredOut(sessions, ctx.levels) && 'off');
  return `<div class="${classes}"><span class="time"><span class="st num">${row.start}</span><span class="en">עד <span class="num">${row.end}</span></span>${now ? '<span class="now-tag">עכשיו</span>' : ''}</span>${chip(row.main.level)}<span class="name">${escapeHtml(name.title)}${name.note ? `<small>${escapeHtml(name.note)}</small>` : ''}</span>${sides}</div>`;
}

export function renderDay(schedule, date, ctx) {
  const day = dayOf(schedule, date);
  const today = date === ctx.today;
  const rows = dayRows(day?.sessions ?? []);
  const past = rows.filter(r => isPast(r, date, ctx.today, ctx.now));
  const shown = ctx.showPast ? rows : rows.filter(r => !past.includes(r));

  const open = day?.closed ? `סגור: ${escapeHtml(day.closed)}`
    : day?.open ? `פתוח ${range(day.open, day.close)}`
      : unpublished(schedule, date) ? 'הלוח עוד לא פורסם' : 'אין סשנים ביום הזה';
  const free = rows.length ? `<div class="sub num">${daySummary(day).freeSpots} מקומות פנויים</div>` : '';
  const toggle = past.length
    ? `<button class="past-toggle" data-toggle-past>${ctx.showPast ? 'הסתרת' : 'הצגת'} ${past.length} סשנים שכבר הסתיימו</button>`
    : '';
  let html = `<div class="day-head"><div>${today ? '<div class="kicker">היום</div>' : ''}<h2 class="dd">${HE_DAYS[dayOfWeek(date)]} <span class="num">${shortDate(date)}</span></h2><div class="open">${open}</div>${free}${toggle}</div>`
    + `<div class="nav"><button data-step="-1" aria-label="היום הקודם">${CHEVRON_RIGHT}</button><button data-step="1" aria-label="היום הבא">${CHEVRON_LEFT}</button></div></div>`;

  if (!rows.length) {
    const why = day?.closed ? 'הפארק סגור ביום הזה.' : unpublished(schedule, date) ? 'הלוח ליום הזה עוד לא פורסם.' : 'אין סשנים ביום הזה.';
    return `${html}<p class="empty">${why}</p>`;
  }
  html += '<div class="list"><div class="row head" aria-hidden="true"><span></span><span></span><span></span><span class="sides"><span>ריף ימין</span><span>ריף שמאל</span></span></div>';
  html += shown.map(r => dayRow(r, date, ctx)).join('');
  return `${html}</div>`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/site/render.test.mjs`
Expected: `tests 10`, `pass 10`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/lib/render.mjs test/site/render.test.mjs
git commit -m "feat: render week, month and day views"
```

---

### Task 8: The page

The HTML shell, styles, repo settings and the DOM glue: loading the data, the view switch (bookmarkable as `#day` / `#week` / `#month`), the level filter (saved in `localStorage` as `srfsc.levels`), the token panel, the refresh button, and the stale and error notices. Styles come from the approved mockup.

**Files:**
- Create: `site/config.js`
- Create: `site/index.html`
- Create: `site/styles.css`
- Create: `site/app.js`
- Create: `scripts/serve.mjs`

**Interfaces:**
- Consumes: everything in `site/lib/` (Tasks 1, 5, 6, 7); `site/data/schedule.json` (Task 4).
- Produces: the deployable `site/` folder. `site/config.js` exports `CONFIG = { owner, repo, workflow, branch, dataPath }`.

- [ ] **Step 1: Create** `site/config.js`

```js
// Where the refresh button starts the update workflow and reads the fresh data from.
export const CONFIG = {
  owner: 'AssafHaft',
  repo: 'srfsc',
  workflow: 'update.yml',
  branch: 'main',
  dataPath: 'site/data/schedule.json',
};
```

- [ ] **Step 2: Create** `site/index.html`

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

  <p class="notice" id="refresh-msg" role="status" hidden></p>
  <p class="notice" id="stale" hidden>הלוח לא התעדכן כבר כמה שעות, אז ייתכן שהמספרים לא עדכניים. אפשר ללחוץ על ״עדכון עכשיו״.</p>
  <p class="notice" id="load-error" hidden>לא הצלחנו לטעון את הלוח. <button data-action="reload">נסו שוב</button></p>

  <div class="controls">
    <div class="seg" role="group" aria-label="תצוגה">
      <button data-view="day" aria-pressed="false">יום</button>
      <button data-view="week" aria-pressed="false">שבוע</button>
      <button data-view="month" aria-pressed="false">חודש</button>
    </div>
    <div class="levels" id="levels"></div>
  </div>

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

- [ ] **Step 3: Create** `site/styles.css`

```css
/* SRF Park TLV session board. Design tokens and rules: docs/superpowers/specs/2026-09-10-surf-schedule-design.md §7 */
:root {
  --foam: #F1F6F5;
  --deck: #FFFFFF;
  --deep: #0F2B35;
  --deep-2: #244652;
  --deep-3: #17394A;
  --mist: #5F7A83;
  --mist-2: #9DB4BA;
  --line: #D8E3E2;
  --rescue: #FF5A1F;
  --sand-tint: #FBF5E6;
  --sand-line: #EBD9A8;
  --l0: #E2B860; --l1: #91C36B; --l2: #6F9B5C; --l3: #487037;
  --l4: #81ABCA; --l5: #225A8C; --l6: #8A71B2;
  --display: "Secular One", "IBM Plex Sans Hebrew", system-ui, sans-serif;
  --text: "IBM Plex Sans Hebrew", system-ui, sans-serif;
  --hpx: 56px; /* one hour in the week view; keep in sync with HOUR_PX in lib/render.mjs */
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--foam); }
body { margin: 0; font-family: var(--text); color: var(--deep); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; }
:focus-visible { outline: 2px solid var(--deep); outline-offset: 2px; border-radius: 6px; }
.num { font-variant-numeric: tabular-nums; }
.ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 32px 24px 56px; }

/* header */
.top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px 24px; flex-wrap: wrap; margin-bottom: 24px; }
.brand h1 { font-family: var(--display); font-weight: 400; font-size: 36px; line-height: 1; margin: 0; }
.brand p { margin: 8px 0 0; color: var(--mist); font-size: 14px; }
.fresh { display: flex; align-items: center; gap: 14px; }
.fresh-text { text-align: end; font-size: 13px; color: var(--mist); line-height: 1.45; }
.fresh-text strong { display: block; color: var(--deep); font-weight: 500; font-size: 14px; }
.btn-refresh { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border: 1.5px solid var(--deep); border-radius: 999px; font-weight: 500; font-size: 14px; transition: background-color .15s, color .15s; }
.btn-refresh:hover { background: var(--deep); color: var(--foam); }
.btn-refresh svg { width: 16px; height: 16px; }
.btn-refresh.is-busy svg { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(-360deg); } }

/* notices: refresh result, stale data, load failure */
.notice { margin: 0 0 16px; padding: 10px 14px; border-radius: 10px; font-size: 14px; background: var(--deck); border: 1px solid var(--line); border-inline-start: 4px solid var(--rescue); }
.notice a, .notice button { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }

/* controls */
.controls { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; margin-bottom: 16px; }
.seg { display: inline-flex; background: var(--deck); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.seg button { padding: 6px 18px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--mist); }
.seg button[aria-pressed="true"] { background: var(--deep); color: var(--foam); }
.levels { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.levels-label { font-size: 13px; color: var(--mist); margin-inline-end: 6px; }
.lv-toggle { padding: 3px; border-radius: 8px; border: 1.5px solid transparent; }
.lv-toggle[aria-pressed="true"] { border-color: var(--deep); }

/* level chip + spots */
.chip { display: inline-grid; place-items: center; min-width: 30px; height: 20px; padding: 0 5px; border-radius: 5px; font-size: 12px; font-weight: 600; line-height: 1; color: #fff; direction: ltr; flex: none; }
.chip.lv0, .chip.lv1, .chip.lv2, .chip.lv4 { color: var(--deep); }
.lv0 { background: var(--l0); } .lv1 { background: var(--l1); } .lv2 { background: var(--l2); } .lv3 { background: var(--l3); }
.lv4 { background: var(--l4); } .lv5 { background: var(--l5); } .lv6 { background: var(--l6); }
.spot { min-width: 20px; text-align: center; font-size: 13px; font-weight: 600; line-height: 20px; }
.spot.few { background: var(--rescue); color: var(--deep); border-radius: 4px; padding: 0 5px; }
.spot.full { font-size: 12px; font-weight: 400; color: var(--mist); }
.spot.none { color: var(--mist-2); font-weight: 400; }
.pier { display: inline-flex; align-items: center; }
.pier-line { width: 1px; height: 14px; background: var(--line); margin: 0 5px; }
.sess { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.past { opacity: .38; filter: grayscale(1); }
.off { opacity: .16; }

/* week: calendar blocks */
.week-scroll { overflow-x: auto; }
.week { display: grid; grid-template-columns: 48px repeat(7, minmax(140px, 1fr)); min-width: 1028px; }
.corner { position: sticky; right: 0; background: var(--foam); z-index: 5; }
.dh { display: flex; flex-direction: column; align-items: flex-start; padding: 10px; border-radius: 12px 12px 0 0; border-bottom: 1px solid var(--line); }
.dh:hover .dd { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
.dh .dn { font-size: 13px; color: var(--mist); }
.dh .dd { font-family: var(--display); font-size: 26px; line-height: 1.1; }
.dh .hrs { font-size: 13px; font-weight: 500; }
.hours { position: sticky; right: 0; z-index: 5; background: var(--foam); }
.hours div { height: var(--hpx); border-top: 1px solid var(--line); font-size: 12px; color: var(--mist); padding-top: 2px; }
.col { position: relative; }
.gl { position: absolute; inset-inline: 0; border-top: 1px solid var(--line); }
.is-today { background: var(--deep); color: var(--foam); }
.dh.is-today { border-bottom-color: var(--deep-2); }
.dh.is-today .dn { color: var(--foam); font-weight: 600; }
.col.is-today { border-radius: 0 0 12px 12px; }
.col.is-today .gl { border-top-color: var(--deep-2); }
.blk { position: absolute; display: flex; flex-direction: column; gap: 1px; padding: 3px 5px; overflow: hidden; background: var(--deck); border: 1px solid var(--line); border-radius: 7px; }
.blk.bay { background: var(--sand-tint); border-color: var(--sand-line); }
.blk .bt { font-size: 11px; font-weight: 500; line-height: 15px; }
.blk .sess { gap: 4px; }
.blk .chip { min-width: 26px; height: 18px; padding: 0 4px; font-size: 11px; }
.blk .spot { min-width: 16px; font-size: 12px; line-height: 18px; }
.blk .spot.full { font-size: 11px; }
.blk .pier-line { margin: 0 3px; }
.is-today .blk { background: var(--deep-3); border-color: var(--deep-2); }
.is-today .spot.full { color: var(--mist-2); }
.is-today .pier-line { background: var(--deep-2); }
.now { position: absolute; inset-inline: 0; height: 0; border-top: 2px solid var(--foam); pointer-events: none; z-index: 4; }
.now::before { content: ""; position: absolute; inset-inline-start: -1px; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--foam); }
.now span { position: absolute; inset-inline-end: 4px; top: -9px; font-size: 11px; font-weight: 600; line-height: 16px; background: var(--foam); color: var(--deep); padding: 0 6px; border-radius: 4px; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-top: 18px; font-size: 13px; color: var(--mist); }
.legend > span { display: inline-flex; align-items: center; gap: 8px; }
.bay-swatch { display: inline-block; width: 22px; height: 14px; border-radius: 4px; background: var(--sand-tint); border: 1px solid var(--sand-line); }

/* month */
.month-title { font-family: var(--display); font-weight: 400; font-size: 24px; margin: 4px 0 12px; }
.month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.mh { font-size: 13px; color: var(--mist); padding: 0 10px 2px; }
.mh .s { display: none; }
.mc { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-height: 112px; padding: 9px 10px 10px; border-radius: 12px; background: var(--deck); border: 1px solid var(--line); }
button.mc:hover { border-color: var(--deep); }
.mc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.mc .dd { font-family: var(--display); font-size: 22px; line-height: 1; }
.mc .tag { font-size: 12px; font-weight: 600; }
.mc .meta { font-size: 12px; color: var(--mist); }
.mc .hrs { font-size: 13px; font-weight: 500; }
.mc .free { font-size: 13px; font-weight: 500; margin-top: auto; }
.strip { display: flex; gap: 2px; height: 8px; }
.strip i { flex: 1; border-radius: 2px; }
.mc.is-past { background: transparent; border-color: transparent; color: var(--mist-2); }
.mc.is-empty, .mc.is-closed { background: transparent; }
.mc.is-unpub { background: transparent; border: 1px dashed var(--mist-2); }
.mc .closed { font-weight: 600; font-size: 14px; }
.mc.is-today { background: var(--deep); border-color: var(--deep); color: var(--foam); }
.mc.is-today .meta { color: var(--mist-2); }

/* day */
.day-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 4px 0 16px; }
.day-head .kicker { font-size: 14px; font-weight: 600; }
.day-head .dd { font-family: var(--display); font-weight: 400; font-size: 32px; line-height: 1.05; margin: 0; }
.day-head .open { font-size: 16px; font-weight: 500; margin-top: 6px; }
.day-head .sub { font-size: 14px; color: var(--mist); }
.past-toggle { display: block; margin-top: 6px; font-size: 13px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
.nav { display: flex; gap: 8px; }
.nav button { width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line); background: var(--deck); display: inline-grid; place-items: center; }
.nav button:hover { border-color: var(--deep); }
.nav svg { width: 18px; height: 18px; }
.list { background: var(--deck); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.row { display: grid; grid-template-columns: 110px 36px minmax(0, 1fr) minmax(250px, 320px); gap: 14px; align-items: center; padding: 11px 18px; border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.row.head { padding-block: 9px; font-size: 12px; color: var(--mist); }
.row .time { display: flex; flex-direction: column; line-height: 1.25; }
.row .st { font-size: 18px; font-weight: 600; }
.row .en { font-size: 12px; color: var(--mist); }
.row .name { font-size: 15px; font-weight: 500; line-height: 1.35; }
.row .name small { display: block; font-size: 12px; font-weight: 400; color: var(--mist); }
.row.is-now { background: #E6F0EF; }
.now-tag { align-self: flex-start; margin-top: 3px; font-size: 11px; font-weight: 600; background: var(--deep); color: var(--foam); padding: 1px 6px; border-radius: 4px; }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.sides.bay { grid-template-columns: 1fr; }
.side { display: flex; align-items: center; gap: 8px; }
.side-l { display: none; font-size: 12px; color: var(--mist); min-width: 34px; }
.bar { flex: 1; height: 6px; border-radius: 3px; background: #E4ECEB; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; }
.empty { padding: 28px; text-align: center; color: var(--mist); background: var(--deck); border: 1px solid var(--line); border-radius: 14px; }

/* token panel */
dialog { max-width: min(460px, calc(100vw - 32px)); border: 0; border-radius: 16px; padding: 22px 24px; color: var(--deep); background: var(--deck); }
dialog::backdrop { background: rgb(15 43 53 / .45); }
dialog h2 { font-family: var(--display); font-weight: 400; font-size: 24px; margin: 0 0 8px; }
dialog p { margin: 0 0 8px; font-size: 14px; }
dialog ol { padding-inline-start: 20px; margin: 0 0 12px; line-height: 1.8; font-size: 14px; }
dialog a { font-weight: 600; }
dialog label { display: block; font-size: 13px; color: var(--mist); margin: 12px 0 4px; }
dialog input { width: 100%; font: inherit; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; }
.token-error { color: #B3261E; font-size: 13px; }
.dialog-actions { display: flex; gap: 10px; margin-top: 16px; }
.dialog-actions button { padding: 8px 18px; border-radius: 999px; border: 1.5px solid var(--deep); font-weight: 500; }
.btn-primary { background: var(--deep); color: var(--foam); }

@media (max-width: 720px) {
  .wrap { padding: 20px 14px 44px; }
  .brand h1 { font-size: 30px; }
  .fresh { width: 100%; justify-content: space-between; }
  .fresh-text { text-align: start; }
  .row { grid-template-columns: 36px minmax(0, 1fr); gap: 6px 10px; padding: 12px 14px; }
  .row .time { grid-column: 1 / -1; flex-direction: row; align-items: baseline; gap: 8px; }
  .row .now-tag { align-self: center; margin-top: 0; }
  .row .sides { grid-column: 1 / -1; }
  .row.head { display: none; }
  .side-l { display: inline; }
  .mh .l { display: none; }
  .mh .s { display: inline; }
  .mh { padding: 0 4px 2px; }
  .month { gap: 4px; }
  .mc { min-height: 76px; padding: 6px 6px 7px; border-radius: 9px; }
  .mc .dd { font-size: 18px; }
  .mc .meta, .mc .tag, .mc .hrs { display: none; }
  .mc.is-closed .meta, .mc.is-unpub .meta, .mc.is-empty .meta { display: block; font-size: 11px; }
  .mc .free { font-size: 11px; }
  .day-head .dd { font-size: 28px; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 4: Create** `site/app.js`

```js
// Page glue: loads the data, keeps UI state, renders the views and runs the refresh button.
import { CONFIG } from './config.js';
import { HE_DAYS, addDays, dayOfWeek, formatAge, israelTime, israelToday, shortDate } from './lib/time.mjs';
import { isStale } from './lib/stale.mjs';
import { RefreshError, refresh } from './lib/refresh.mjs';
import { renderDay, renderLevelChips, renderMonth, renderWeek } from './lib/render.mjs';

const TOKEN_KEY = 'srfsc.githubToken';
const LEVELS_KEY = 'srfsc.levels';
const VIEWS = ['day', 'week', 'month'];
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
  return window.matchMedia('(max-width: 720px)').matches ? 'day' : 'week';
}

function savedLevels() {
  try {
    return new Set(JSON.parse(store.get(LEVELS_KEY) ?? '[]').map(Number));
  } catch {
    return new Set();
  }
}

const state = { schedule: null, view: initialView(), day: null, levels: savedLevels(), showPast: false, refreshing: false };

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

function render() {
  if (!state.schedule) return;
  const ctx = context();
  if (!state.day || state.day < ctx.today) state.day = ctx.today;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#levels').innerHTML = renderLevelChips(state.levels);
  $('#view').innerHTML = state.view === 'week' ? renderWeek(state.schedule, ctx)
    : state.view === 'month' ? renderMonth(state.schedule, ctx)
      : renderDay(state.schedule, state.day, ctx);
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
  history.replaceState(null, '', `#${view}`);
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
  timeout: 'הלוח יתעדכן כשהריצה תסתיים.',
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
    state.schedule = await refresh({
      token,
      config: CONFIG,
      onStatus: ({ phase, elapsedMs }) =>
        setButton(phase === 'queued' ? 'ממתין בתור' : phase === 'running' ? `מעדכן… ${clockText(elapsedMs)}` : 'מתחיל…', true),
    });
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
  const el = event.target.closest('[data-view],[data-day],[data-level],[data-step],[data-toggle-past],[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'refresh') return startRefresh();
  if (d.action === 'reload') return load();
  if (d.action === 'save-token') return saveToken();
  if (d.action === 'close-token') return $('#token-panel').close();
  if (!state.schedule) return;
  if (d.view) {
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
  }
  render();
});

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (VIEWS.includes(view) && view !== state.view) {
    state.view = view;
    render();
  }
});

setInterval(render, 60000); // keeps "now", finished sessions and "updated N minutes ago" current
load();
```

- [ ] **Step 5: Create** `scripts/serve.mjs`

```js
// Local preview of site/ (ES modules need http://, not file://). Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../site/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const port = Number(process.argv[2] ?? 8000);

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`serving site/ at http://localhost:${port}/`));
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: `tests 61`, `pass 61`, `fail 0`.

- [ ] **Step 7: Check the page in a browser**

Run: `npm run serve` (leave it running) and open http://localhost:8000/.

Check each item:
- Week view (default on a wide window): today is the dark first column on the right; blocks show `start–end` on top, then the level chip and spots; Bay blocks are sand-tinted and span 90 minutes; a light "עכשיו" line crosses today's column during opening hours; finished blocks are grey.
- Month view: starts at this week's Sunday; today dark; past days show only their number; closed days say "סגור" and why; days after the last published date are dashed "טרם פורסם"; the 1st of a new month reads like `1.10`.
- Day view: rows lead with a large start time and "עד …"; for today, finished sessions sit behind "הצגת N סשנים שכבר הסתיימו"; the arrows move between today and the last published day.
- Level chips fade the other levels in all views, and the choice survives a reload.
- The header says "עודכן לפני … " and "הלוח פורסם עד …". Editing `fetchedAt` in `site/data/schedule.json` to 4 hours ago (then reloading) shows the stale notice; restore the file afterwards with `git checkout site/data/schedule.json`.
- Pressing "עדכון עכשיו" with no token opens the token panel; "שמירה ועדכון" with an empty field shows "הדביקו את הטוקן לפני השמירה."; "ביטול" closes it.
- No errors in the browser console.

- [ ] **Step 8: Check the phone layout**

In the browser's device toolbar at 375 × 812, open each view and run this in the console:

```js
({ pageFits: document.documentElement.scrollWidth === document.documentElement.clientWidth,
   clippedBlocks: [...document.querySelectorAll('.blk')].filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).length })
```

Expected in every view: `{ pageFits: true, clippedBlocks: 0 }`. The week grid scrolls sideways inside its box and opens with today and the hour column in view. The day view is the default at this width.

- [ ] **Step 9: Commit**

```bash
git add site/config.js site/index.html site/styles.css site/app.js scripts/serve.mjs
git commit -m "feat: add the schedule page"
```

---

### Task 9: The workflow, README and first deploy

**Files:**
- Create: `.github/workflows/update.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: `node --test` (all tasks), `node scraper/scrape.mjs` (Task 4), the `site/` folder (Task 8).
- Produces: the hourly and on-demand pipeline. The page's refresh button (Task 6) dispatches `update.yml` on `main`.

- [ ] **Step 1: Create** `.github/workflows/update.yml`

```yaml
# Scrape the park's schedule, commit site/data/schedule.json, deploy site/ to GitHub Pages.
# Spec: docs/superpowers/specs/2026-09-10-surf-schedule-design.md, section 5.
name: Update schedule

on:
  schedule:
    - cron: '17 3-20 * * *' # hourly at :17, 06:17–23:17 Israel summer time (05:17–22:17 in winter)
  workflow_dispatch: # the page's "עדכון עכשיו" button
  push:
    branches: [main]

permissions:
  contents: write
  pages: write
  id-token: write

# One run at a time; a button press waits behind a running hourly run.
concurrency:
  group: update
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
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
        if: vars.SCRAPE_IN_ACTIONS != 'false'
        run: node scraper/scrape.mjs

      - name: Commit new data
        if: vars.SCRAPE_IN_ACTIONS != 'false'
        run: |
          if git diff --quiet -- site/data/schedule.json; then
            echo "No changes to commit"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add site/data/schedule.json
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

Notes for the reviewer:
- Pushes made with `GITHUB_TOKEN` don't trigger workflows, so scrape, commit and deploy must stay in this one job.
- `git pull --rebase` before pushing keeps a data commit from failing when code was pushed meanwhile.
- `concurrency` with `cancel-in-progress: false` queues a button press behind a running hourly run.
- `workflow_dispatch` only works once this file is on the default branch (`main`).

- [ ] **Step 2: Validate the YAML**

Run: `python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/update.yml', encoding='utf-8')); print(sorted(d[True].keys()), [s.get('name', s.get('uses')) for s in d['jobs']['update']['steps']])"`
Expected: the trigger list `['push', 'schedule', 'workflow_dispatch']` and the eight steps in order. (PyYAML reads the `on:` key as `True`.) If PyYAML isn't installed, skip this step; GitHub reports YAML errors on the Actions tab after the push.

- [ ] **Step 3: Create** `README.md`

````markdown
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
````

- [ ] **Step 4: Run the whole suite once more**

Run: `npm test`
Expected: `tests 61`, `pass 61`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/update.yml README.md
git commit -m "ci: add hourly scrape and Pages deploy workflow"
```

Don't commit `.claude/launch.json`: it holds local preview settings with machine-specific paths.

- [ ] **Step 6: Hand over for merge and one-time setup (owner)**

Push the branch and ask the owner to merge it into `main` and do the README's one-time setup (public repo, Pages source "GitHub Actions"). This step changes repository settings, so the owner does it.

- [ ] **Step 7: Live check (after merge)**

Ask the owner to run **Actions → Update schedule → Run workflow**, then check the run:
- "Test" passes (61 tests).
- "Scrape the park" prints `wrote … sessions, published through …`. If it fails with `HTTP 403`, `not JSON` or similar, GitHub's servers are being blocked by the park: follow the README's fallback section.
- "deploy" finishes and https://assafhaft.github.io/srfsc/ shows today's schedule.
- On the site, "עדכון עכשיו" with the owner's token goes through "ממתין בתור" / "מעדכן…" and ends with "עודכן עכשיו".
