# One-time CMS Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the park's CMS "wave demand" export into the history files once. Public sessions take the park's booked counts, and bookings that never appeared on the public schedule are stored by category and shown in a new analysis section.

**Architecture:**
- A pure module, `scraper/cms.mjs`, reads the .xlsx, parses and validates it, categorizes rows, pairs them with history rows by slot, and merges them. A small CLI, `scraper/import-cms.mjs`, runs it once against `site/data/history/`.
- The daily history update learns to leave `hidden` rows alone.
- On the page, `hidden()` in `analytics.mjs`, `hiddenSection()` in `render-analysis.mjs` and one insight rule show the hidden bookings.

**Tech Stack:** Node 20+ ES modules, `node:test`, `node:zlib`, no dependencies; the static page in `site/`.

**Spec:** `docs/superpowers/specs/2026-09-12-cms-import-design.md`. It builds on `docs/superpowers/specs/2026-09-11-schedule-analysis-design.md`.

## Global Constraints

- No new dependencies. Node's built-ins only (`node:zlib` inflates the .xlsx).
- Work on branch `schedule-analysis`. Don't touch `site/data/` before Task 8.
- The repo is public. A hidden row's `name` is always one of the 8 `HIDDEN_CATEGORIES` labels. No original export name of a hidden row is ever written anywhere, and `*.xlsx` is git-ignored.
- `kind: 'hidden'` is never counted: `isCounted` stays `surf` or `lesson`, and no existing section's definition changes.
- Hidden rows get ids −1, −2, −3… (the park's ids are positive), `level: 0`, `end` = start + 1 hour (23:00 → 23:59), `final: true` and `pace: []`.
- `index.json` gains `cms: { from, to, importedAt }`, and every later history update keeps it.
- The page escapes every stored name with `escapeHtml` before it reaches the HTML.
- The UI copy is exactly the Hebrew text given in the tasks.
- Tests:
  - run one file with `node --test <file>`, never with a directory argument;
  - run the full suite with `npm test`;
  - test output must be clean.
- Commits: conventional prefix (`feat:`, `fix:`, `data:`, `docs:`). The trailer goes in a second `-m`: `-m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`.
- The worktree may check files out with CRLF line endings. Keep a file's existing endings when editing it.

## File map

| File | Task | Responsibility |
|---|---|---|
| `site/lib/history.mjs` | 1 | `HIDDEN_CATEGORIES`, shared by the import and the page |
| `scraper/history.mjs` | 1 | `applyFinal`, `finalFrom` and `nextIndex` leave hidden rows and `cms` alone |
| `scraper/cms.mjs` | 2, 3 | `readXlsx`, `EXPORT_HEADER`, `parseExport`, `categoryOf`, `slotOf`, `pairExport`, `mergeExport` |
| `scraper/test-support/xlsx.mjs` | 2 | test helper: builds .xlsx files in memory |
| `scraper/import-cms.mjs` | 4 | the CLI: `importCms({ file, dir, dryRun, now, log })` |
| `package.json`, `.gitignore`, `README.md` | 4 | `npm run import-cms`, `*.xlsx`, docs |
| `site/lib/analytics.mjs` | 5 | `hidden(rows, range, cms)`, `periodBuckets`, `analyse()` wiring |
| `site/lib/insights.mjs` | 6 | rule `hidden-share` |
| `site/lib/render-analysis.mjs`, `site/styles.css` | 7 | the "מה לא בלוח הציבורי" section, KPI footnote, coverage line |
| `site/data/history/*` | 8 | the imported data (the controller runs the import) |

---

### Task 1: Hidden-row categories and guards in the history update

**Files:**
- Modify: `site/lib/history.mjs` (add the export after `isKids`)
- Modify: `scraper/history.mjs` (`applyFinal`, `finalFrom`, `nextIndex`)
- Test: `scraper/test/history.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `HIDDEN_CATEGORIES: string[]` (8 labels, in this order) from `site/lib/history.mjs`;
  - rows with `kind: 'hidden'` survive `applyFinal` and are ignored by `finalFrom`;
  - `nextIndex(prev, …)` returns `prev.cms` unchanged when present.

- [ ] **Step 1: Write the failing tests**

Add to the end of `scraper/test/history.test.mjs`:

```js
test('hidden rows from the CMS import survive the final-count pass and never move the catch-up', () => {
  const hidden = row({ id: -1, date: '2026-09-11', kind: 'hidden', name: 'קייטנות', final: true, booked: 9, capacity: 12 });
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T08:00:00+03:00'));
  store['2026-09'].sessions.push(structuredClone(hidden));
  applyFinal(store, structuredClone(fixtureWindow('2026-09-10')), { from: '2026-09-10', to: '2026-09-12' });
  assert.deepEqual(rowById(store, -1), hidden); // not overwritten, not "removed"

  const month = (...rows) => ({ '2026-09': { month: '2026-09', closed: [], sessions: rows } });
  const park = row({ date: '2026-09-10', final: true });
  assert.equal(finalFrom(month(park, row({ id: -1, date: '2026-09-18', kind: 'hidden', final: true })), '2026-09-20', '2026-08-21'), '2026-09-11');
});

test('nextIndex keeps the CMS import coverage', () => {
  const cms = { from: '2025-05-01', to: '2026-09-10', importedAt: '2026-09-12T12:00:00+03:00' };
  const prev = { updatedAt: 'x', first: '2025-04-02', months: ['2026-09'], snapshots: 2, snapshotsSince: '2026-09-12', cms };
  assert.deepEqual(nextIndex(prev, { months: ['2026-09'], updatedAt: 'y', first: '2025-04-02', snapshot: true }).cms, cms);
  assert.equal('cms' in nextIndex(null, { months: [], updatedAt: 'x', first: null, snapshot: false }), false);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test scraper/test/history.test.mjs`
Expected: FAIL on both new tests.
- The first fails because `applyFinal` marks the hidden row `removed`, since id −1 isn't in the window.
- The second fails because `cms` is `undefined`.

- [ ] **Step 3: Implement**

In `site/lib/history.mjs`, right after the `isKids` line, add:

```js

/** Categories of bookings the public schedule never showed (CMS import spec section 3); stored as the row's name. */
export const HIDDEN_CATEGORIES = [
  'קבוצות וארגונים', 'קייטנות', 'אירועים', 'שיעורים פרטיים',
  'חוגים', 'קורסי Bay', 'שימוש פנימי ושריונים', 'שיעורי Bay קבוצתיים',
];
```

In `scraper/history.mjs`:

1. Update the `applyFinal` doc comment's last sentence and the removal loop:

```js
/**
 * Final counts from one past park window: its rows dated from..to take the park's numbers and
 * final: true (keeping their pace). Rows we hold for those dates that the park no longer lists
 * become kind "removed", except rows from the CMS import (kind "hidden"), which the park never lists.
 */
```

   and change the condition inside the last loop from
   `if (r.date >= from && r.date <= to && !listed.has(r.id)) {`
   to
   `if (r.date >= from && r.date <= to && r.kind !== 'hidden' && !listed.has(r.id)) {`

   (Hidden rows can't be overwritten by the upsert above: their ids are negative, and the park's are positive.)

2. In `finalFrom`, change `.filter(r => r.final === true && r.date < today)` to
   `.filter(r => r.final === true && r.kind !== 'hidden' && r.date < today)`.

3. In `nextIndex`, add a last property to the returned object, after `snapshotsSince`:

```js
    ...(prev?.cms ? { cms: prev.cms } : {}),
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test scraper/test/history.test.mjs`
Expected: PASS, every test in the file.

Run: `npm test`
Expected: PASS, the whole suite (122 + 2 = 124 tests).

- [ ] **Step 5: Commit**

```bash
git add site/lib/history.mjs scraper/history.mjs scraper/test/history.test.mjs
git commit -m "feat: keep CMS-imported rows through history updates" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read and validate the .xlsx export

**Files:**
- Create: `scraper/cms.mjs`
- Create: `scraper/test-support/xlsx.mjs` (a test helper outside `scraper/test/`, so `node --test` doesn't run it as a test)
- Test: `scraper/test/cms.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, from `scraper/cms.mjs`:
  - `readXlsx(buffer: Buffer): string[][]`: the first sheet's rows. Each row is an array of cell strings, placed by column letter, with missing cells as `''`.
  - `EXPORT_HEADER: string[]`: the 9 column names.
  - `parseExport(sheet: string[][]): { rows: ExportRow[], skipped: { [reason]: number } }`, where
    `ExportRow = { date, hour, area: 'reef'|'bay', side: 'right'|'left', name, level: number|null, capacity, booked }`.
    `name` is trimmed with whitespace collapsed.
- Produces, from `scraper/test-support/xlsx.mjs`:
  - `zip(files: [name, text, deflate][]): Buffer`;
  - `xlsxOf(rows: string[][]): Buffer`: a one-sheet workbook of inline strings, where `''` becomes a missing cell;
  - `WORKBOOK`, `RELS`: the XML strings `xlsxOf` uses.

- [ ] **Step 1: Write the test helper**

Create `scraper/test-support/xlsx.mjs`:

```js
// Test helpers: builds small .xlsx files in memory, shaped like the park's CMS export.
// Lives outside scraper/test/ so `node --test` doesn't run it as a test file.
import { deflateRawSync } from 'node:zlib';

/** A zip of [name, text, deflate] entries (no CRCs: readXlsx doesn't check them). */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(head, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

export const WORKBOOK = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="sheet 1" sheetId="1" r:id="rId1"/></sheets></workbook>';
export const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = i => String.fromCharCode(65 + i); // A–Z is enough for the export's 9 columns

/** A one-sheet workbook of inline strings, like the CMS export. '' becomes a missing cell. */
export function xlsxOf(rows) {
  const cells = (r, y) => r.map((v, x) => (v === '' ? '' : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, y) => `<row r="${y + 1}">${cells(r, y)}</row>`).join('')}</sheetData></worksheet>`;
  return zip([['xl/workbook.xml', WORKBOOK, true], ['xl/_rels/workbook.xml.rels', RELS, false], ['xl/worksheets/sheet1.xml', sheet, true]]);
}
```

- [ ] **Step 2: Write the failing tests**

Create `scraper/test/cms.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_HEADER, parseExport, readXlsx } from '../cms.mjs';
import { RELS, WORKBOOK, xlsxOf, zip } from '../test-support/xlsx.mjs';

test('readXlsx reads inline strings from the first sheet, stored or deflated', () => {
  const rows = [EXPORT_HEADER, ['2025-05-01', 'Thursday', '07:00', 'ריף', 'סשן <L6> & co', '', ' שמאל', '15', '15']];
  const read = readXlsx(xlsxOf(rows));
  assert.deepEqual(read, rows);
});

test('readXlsx reads shared strings, plain values, gaps and empty rows', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="C1"><v>18</v></c><c r="D1" s="2"/></row>'
    + '<row r="2"/><row r="3"><c r="B3" t="inlineStr"><is><r><t>א &amp; </t></r><r><t xml:space="preserve">ב</t></r></is></c></row></sheetData></worksheet>';
  const strings = '<sst><si><t>zero</t></si><si><t>ריף</t></si></sst>';
  const buf = zip([
    ['xl/workbook.xml', WORKBOOK, false], ['xl/_rels/workbook.xml.rels', RELS, true],
    ['xl/sharedStrings.xml', strings, true], ['xl/worksheets/sheet1.xml', sheet, false],
  ]);
  assert.deepEqual(readXlsx(buf), [['ריף', '', '18', ''], [], ['', 'א & ב']]);
});

test('readXlsx rejects a file that is not a zip', () => {
  assert.throws(() => readXlsx(Buffer.from('תאריך,יום\n')), /not an \.xlsx file/);
});

test('parseExport checks the header and turns rows into sessions, skipping bad ones by reason', () => {
  assert.throws(() => parseExport([['תאריך', 'יום', 'שעה']]), /column 4 is "", expected "איזור"/);
  const { rows, skipped } = parseExport([
    EXPORT_HEADER,
    ['2025-05-01', 'Thursday', '07:00', 'ריף', ' סשן  L6 ', 'L6 - Pro Surfers', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '09:00', 'ביי', 'פרטי - לקוחה', '', ' ימין 1', '1', '1'],
    ['', '', '', '', '', '', '', '', ''],
    ['01/05/2025', 'Thursday', '07:00', 'ריף', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '7', 'ריף', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ים', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ריף', 'x', '', ' מרכז', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ריף', 'x', '', ' שמאל', '15', '-1'],
  ]);
  assert.deepEqual(rows, [
    { date: '2025-05-01', hour: '07:00', area: 'reef', side: 'left', name: 'סשן L6', level: 6, capacity: 15, booked: 15 },
    { date: '2025-05-01', hour: '09:00', area: 'bay', side: 'right', name: 'פרטי - לקוחה', level: null, capacity: 1, booked: 1 },
  ]);
  assert.deepEqual(skipped, { 'bad date': 1, 'bad hour': 1, 'bad area': 1, 'bad side': 1, 'bad number': 1 });
});
```

- [ ] **Step 3: Run the tests to check they fail**

Run: `node --test scraper/test/cms.test.mjs`
Expected: FAIL with `Cannot find module` for `../cms.mjs`.

- [ ] **Step 4: Implement**

Create `scraper/cms.mjs`:

```js
// The one-time import of the park's CMS "wave demand" export (CMS import spec section 4).
// Pure functions: .xlsx bytes → rows → merged history. The CLI is scraper/import-cms.mjs.
import { inflateRawSync } from 'node:zlib';

// ---------- .xlsx reading (no dependencies) ----------

/** Zip entries by name → contents, read through the central directory. */
function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not an .xlsx file (no zip directory)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('not an .xlsx file (broken zip directory)');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const skip = nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression ${method} in ${name}`);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + skip;
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => (e[0] !== '#'
  ? ENTITIES[e] ?? all
  : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], unescapeXml(m[2])]));
/** All <t> text inside an element, joined (rich text runs included). */
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
/** "C12" → 2. */
const column = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first sheet of an .xlsx file as rows of cell strings; missing cells are ''. */
export function readXlsx(buffer) {
  const entries = unzip(buffer);
  const text = name => entries.get(name)?.toString('utf8') ?? null;
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('not an .xlsx file (no workbook)');
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook);
  if (!firstSheet) throw new Error('the workbook has no sheets');
  const id = attrs(firstSheet[0])['r:id'];
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).find(r => r.Id === id)?.Target;
  const sheet = target && text(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!sheet) throw new Error('the first sheet is missing');
  const strings = text('xl/sharedStrings.xml');
  const shared = strings ? [...strings.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];

  const rows = [];
  for (const [, body = ''] of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    for (const [, a, inner = ''] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { r, t } = attrs(a);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value = t === 'inlineStr' ? texts(inner) : t === 's' ? shared[Number(v)] ?? '' : v === undefined ? '' : unescapeXml(v);
      cells[r ? column(r) : cells.length] = value;
    }
    rows.push(Array.from(cells, c => c ?? ''));
  }
  return rows;
}

// ---------- parsing ----------

export const EXPORT_HEADER = ['תאריך', 'יום', 'שעה', 'איזור', 'שם', 'סוג', 'צד', "מס' משתתפים מקסימלי", "מס' נרשמים"];
const AREAS = { 'ריף': 'reef', 'ביי': 'bay' };
const COUNT = /^\d+$/;
const collapse = s => String(s).replace(/\s+/g, ' ').trim();

/** Sheet rows → { rows, skipped: { reason: count } }. Throws unless the header is the CMS export's. */
export function parseExport(sheet) {
  const header = (sheet[0] ?? []).map(c => String(c).trim());
  EXPORT_HEADER.forEach((name, i) => {
    if (header[i] !== name) throw new Error(`column ${i + 1} is "${header[i] ?? ''}", expected "${name}"`);
  });
  const rows = [];
  const skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const cells of sheet.slice(1)) {
    const [date, , hour, area, name, type, side, capacity, booked] = EXPORT_HEADER.map((_, i) => String(cells[i] ?? '').trim());
    if (!cells.some(c => String(c).trim())) continue; // a blank line
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) skip('bad date');
    else if (!/^\d{2}:\d{2}$/.test(hour)) skip('bad hour');
    else if (!AREAS[area]) skip('bad area');
    else if (!/ימין|שמאל/.test(side)) skip('bad side');
    else if (!COUNT.test(capacity) || !COUNT.test(booked)) skip('bad number');
    else {
      const level = /L(\d)/.exec(type);
      rows.push({
        date, hour, area: AREAS[area], side: side.includes('ימין') ? 'right' : 'left', name: collapse(name),
        level: level ? Number(level[1]) : null, capacity: Number(capacity), booked: Number(booked),
      });
    }
  }
  return { rows, skipped };
}
```

- [ ] **Step 5: Run the tests to check they pass**

Run: `node --test scraper/test/cms.test.mjs`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: PASS, the whole suite.

- [ ] **Step 6: Commit**

```bash
git add scraper/cms.mjs scraper/test-support/xlsx.mjs scraper/test/cms.test.mjs
git commit -m "feat: read and validate the CMS export" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Categorize, pair and merge

**Files:**
- Modify: `scraper/cms.mjs` (append a section)
- Test: `scraper/test/cms.test.mjs` (append)

**Interfaces:**
- Consumes:
  - `ExportRow` from Task 2;
  - `HIDDEN_CATEGORIES` and `isKids` from `site/lib/history.mjs`;
  - `monthOf` from `scraper/history.mjs`;
  - history rows `{ id, date, start, end, level, area, side, kids, name, kind, capacity, booked, final, pace }`.
- Produces:
  - `categoryOf(name: string): string`, always one of `HIDDEN_CATEGORIES`;
  - `slotOf(start: 'HH:MM'): 'HH:00'`, rounding up when the minutes aren't 0;
  - `pairExport(historyRows, exportRows) → { pairs: [historyRow, exportRow][], unpairedExport: ExportRow[], unpairedHistory: historyRow[] }`;
  - `mergeExport(store, exportRows) → { store, from, to, summary }`. It mutates `store`.
    `summary = { pairs, changed, netPeople, notInExport, hidden, hiddenPeople, categories: { [label]: { rows, people } } }`.

- [ ] **Step 1: Write the failing tests**

In `scraper/test/cms.test.mjs`:

1. Change the import lines at the top to:

```js
import { EXPORT_HEADER, categoryOf, mergeExport, pairExport, parseExport, readXlsx, slotOf } from '../cms.mjs';
import { HIDDEN_CATEGORIES } from '../../site/lib/history.mjs';
import { RELS, WORKBOOK, xlsxOf, zip } from '../test-support/xlsx.mjs';
```

2. Append:

```js
// A history row and an export row in the same slot; override fields per test.
const ours = (over = {}) => ({
  id: 1, date: '2025-07-07', start: '08:00', end: '09:00', level: 4, area: 'reef', side: 'right', kids: false,
  name: 'סשן L4', kind: 'surf', capacity: 18, booked: 10, final: true, pace: [[600, 4]], ...over,
});
const theirs = (over = {}) => ({
  date: '2025-07-07', hour: '08:00', area: 'reef', side: 'right', name: 'סשן L4', level: 4, capacity: 18, booked: 10, ...over,
});

test('categoryOf: first matching rule wins; anything else is a group', () => {
  const cases = [
    ['שמור ל SRF KAMP', 'שימוש פנימי ושריונים'], ['ערב צוות- מדריכים/מצילים', 'שימוש פנימי ושריונים'], ['אירוע SRF', 'שימוש פנימי ושריונים'],
    ['SUMMER CAMP (5 days) גילאי 11-13', 'קייטנות'], ['Summer Surf n’ Slice', 'קייטנות'],
    ['קורס מפגש אחד BAY- מעל גיל 16', 'קורסי Bay'], ['חוג ילדים Beginners', 'חוגים'],
    ['אירוע פרטי - משפחה', 'אירועים'], ['בת מצווה - 60 אורחים', 'אירועים'],
    ['פרטי - לקוח לדוגמה', 'שיעורים פרטיים'], ['זוגי - שני גולשים', 'שיעורים פרטיים'], ['הדרכה פרטית', 'שיעורים פרטיים'],
    ['שיעור גלישה קבוצתי - בוגרים מעל גיל 16', 'שיעורי Bay קבוצתיים'],
    ['קבוצת נוער מהשכונה', 'קבוצות וארגונים'], ['חברת הייטק - 20', 'קבוצות וארגונים'],
  ];
  for (const [name, label] of cases) assert.equal(categoryOf(name), label, name);
  assert.deepEqual([...new Set(cases.map(([name]) => categoryOf(name)))].sort(), [...HIDDEN_CATEGORIES].sort());
});

test('pairExport: same slot only; the same name beats the same level, which beats the closest counts', () => {
  const a = ours({ id: 1, name: 'T-Time Mega Turns', level: 5, capacity: 15, booked: 15 });
  const b = ours({ id: 2 });
  const x = theirs({ name: 'סשן L5', level: 5, capacity: 15, booked: 14 }); // pairs with a by level
  const y = theirs({ booked: 9 }); // pairs with b by name
  const z = theirs({ name: 'פרטי - לקוחה', level: null, capacity: 1, booked: 1 }); // nothing left for it
  const lonely = ours({ id: 3, start: '12:00', end: '13:00' });
  const { pairs, unpairedExport, unpairedHistory } = pairExport([a, b, lonely], [z, x, y]);
  assert.deepEqual(pairs.map(([r, e]) => [r.id, e.name]).sort(), [[1, 'סשן L5'], [2, 'סשן L4']]);
  assert.deepEqual(unpairedExport, [z]);
  assert.deepEqual(unpairedHistory, [lonely]);
});

test('pairExport: a 14:30 session pairs with the 15:00 row; Bay rows never pair by level; closest counts break ties', () => {
  assert.deepEqual([slotOf('14:30'), slotOf('09:00'), slotOf('09:15')], ['15:00', '09:00', '10:00']);
  const r = ours({ area: 'bay', level: 0, start: '14:30', end: '16:00', name: 'שיעור גלישה', capacity: 14, booked: 2 });
  const far = theirs({ area: 'bay', hour: '15:00', name: 'קורס', level: 0, capacity: 18, booked: 2 });
  const near = theirs({ area: 'bay', hour: '15:00', name: 'אחר', level: 4, capacity: 14, booked: 3 });
  const early = theirs({ area: 'bay', hour: '14:00', name: 'שיעור גלישה', level: 0, capacity: 14, booked: 2 }); // other slot
  const { pairs, unpairedExport } = pairExport([r], [far, near, early]);
  assert.deepEqual(pairs, [[r, near]]); // distance 1 beats 4
  assert.deepEqual(unpairedExport, [far, early]);
});

test('mergeExport: paired rows take only the export count; the rest become hidden rows named by category', () => {
  const cancelled = ours({ id: 7, kind: 'cancelled', capacity: 0, booked: 0 });
  const paired = ours({ id: 8, start: '10:00', end: '11:00' });
  const lonely = ours({ id: 10, start: '12:00', end: '13:00' });
  const before = ours({ id: 9, date: '2025-06-30' }); // before the export's first date: untouched
  const store = {
    '2025-06': { month: '2025-06', closed: [], sessions: [before] },
    '2025-07': { month: '2025-07', closed: [], sessions: [cancelled, paired, lonely] },
  };
  const exportRows = [
    theirs({ booked: 0 }), // pairs with the cancelled row, which stays cancelled with capacity 0
    theirs({ hour: '10:00', booked: 7 }),
    theirs({ date: '2025-07-08', hour: '23:00', area: 'bay', side: 'left', name: 'SUMMER CAMP גילאי 7-10', level: 4, capacity: 12, booked: 9 }),
    theirs({ date: '2025-08-01', hour: '09:00', area: 'bay', name: 'פרטי - לקוח לדוגמה', level: null, capacity: 1, booked: 1 }),
  ];
  const { summary, from, to } = mergeExport(store, exportRows);

  assert.deepEqual([from, to], ['2025-07-07', '2025-08-01']);
  assert.deepEqual(cancelled, ours({ id: 7, kind: 'cancelled', capacity: 0, booked: 0 }));
  assert.deepEqual(paired, ours({ id: 8, start: '10:00', end: '11:00', booked: 7 })); // pace, capacity, kind kept
  assert.deepEqual(before, ours({ id: 9, date: '2025-06-30' }));
  assert.deepEqual(store['2025-07'].sessions.at(-1), {
    id: -1, date: '2025-07-08', start: '23:00', end: '23:59', level: 0, area: 'bay', side: 'left', kids: true,
    name: 'קייטנות', kind: 'hidden', capacity: 12, booked: 9, final: true, pace: [],
  });
  assert.deepEqual(store['2025-08'].sessions, [{
    id: -2, date: '2025-08-01', start: '09:00', end: '10:00', level: 0, area: 'bay', side: 'right', kids: false,
    name: 'שיעורים פרטיים', kind: 'hidden', capacity: 1, booked: 1, final: true, pace: [],
  }]);
  assert.deepEqual(summary, {
    pairs: 2, changed: 1, netPeople: -3, notInExport: 1, hidden: 2, hiddenPeople: 10,
    categories: { 'קייטנות': { rows: 1, people: 9 }, 'שיעורים פרטיים': { rows: 1, people: 1 } },
  });
  const text = JSON.stringify(store);
  assert.ok(!text.includes('לדוגמה') && !text.includes('SUMMER'), 'no original name of a hidden row is stored');
  const hidden = Object.values(store).flatMap(m => m.sessions).filter(r => r.kind === 'hidden');
  assert.ok(hidden.every(r => HIDDEN_CATEGORIES.includes(r.name)));
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test scraper/test/cms.test.mjs`
Expected: FAIL with a SyntaxError: `cms.mjs` doesn't export `categoryOf`.

- [ ] **Step 3: Implement**

1. At the top of `scraper/cms.mjs`, below the `node:zlib` import, add:

```js
import { HIDDEN_CATEGORIES, isKids } from '../site/lib/history.mjs';
import { monthOf } from './history.mjs';
```

2. Append to `scraper/cms.mjs`:

```js
// ---------- categories ----------

// First match wins (CMS import spec section 3); anything else is a group or organisation.
const CATEGORY_RULES = [
  [/צוות|מדריכ|מציל|שותפים|תחזוק|SRF(?! ?KAMP)|בדיק|צילומ|שמור|שמירת|שריון|חסום|סגור/i, 'שימוש פנימי ושריונים'],
  [/קייטנ|CAMP|KAMP|Surf n.? ?Slice/i, 'קייטנות'],
  [/קורס/, 'קורסי Bay'],
  [/חוג/, 'חוגים'],
  [/אירוע|יום הולדת|מצו|גיבוש|כנס|השקה|event/i, 'אירועים'],
  [/פרטי|פרטית|הדרכה|זוגי/, 'שיעורים פרטיים'],
  [/שיעור גלישה|מפגש היכרות|לימוד גלישה/, 'שיעורי Bay קבוצתיים'],
];
const GROUP = HIDDEN_CATEGORIES[0];

/** The category label a hidden booking is stored under; its original name is never stored. */
export const categoryOf = name => CATEGORY_RULES.find(([rule]) => rule.test(name))?.[1] ?? GROUP;

// ---------- pairing and merging ----------

const nextHour = hhmm => `${String(Number(hhmm.slice(0, 2)) + 1).padStart(2, '0')}:00`;

/** A history start as the export's whole hour: "14:30" → "15:00", "14:00" → "14:00". */
export const slotOf = start => (start.endsWith(':00') ? start : nextHour(start));

/**
 * Pairs export rows with history rows of the same date, area, side and slot. Inside a slot the
 * same name pairs first, then the same reef level, then the closest capacity and booked count.
 */
export function pairExport(historyRows, exportRows) {
  const buckets = new Map();
  const bucket = key => {
    if (!buckets.has(key)) buckets.set(key, { ours: [], theirs: [] });
    return buckets.get(key);
  };
  for (const r of historyRows) bucket(`${r.date}|${r.area}|${r.side}|${slotOf(r.start)}`).ours.push(r);
  for (const e of exportRows) bucket(`${e.date}|${e.area}|${e.side}|${e.hour}`).theirs.push(e);

  const pairs = [];
  for (const { ours, theirs } of buckets.values()) {
    const candidates = [];
    ours.forEach((r, a) => theirs.forEach((e, b) => {
      const score = collapse(e.name) === collapse(r.name) ? 0 : r.area === 'reef' && e.level === r.level ? 1 : 2;
      candidates.push({ score, distance: Math.abs(e.capacity - r.capacity) + Math.abs(e.booked - r.booked), a, b });
    }));
    candidates.sort((x, y) => x.score - y.score || x.distance - y.distance || x.a - y.a || x.b - y.b);
    const usedOurs = new Set();
    const usedTheirs = new Set();
    for (const { a, b } of candidates) {
      if (usedOurs.has(a) || usedTheirs.has(b)) continue;
      usedOurs.add(a);
      usedTheirs.add(b);
      pairs.push([ours[a], theirs[b]]);
    }
  }
  const pairedOurs = new Set(pairs.map(([r]) => r));
  const pairedTheirs = new Set(pairs.map(([, e]) => e));
  return {
    pairs,
    unpairedExport: exportRows.filter(e => !pairedTheirs.has(e)),
    unpairedHistory: historyRows.filter(r => !pairedOurs.has(r)),
  };
}

/**
 * The one-time merge (CMS import spec section 4.5), mutating `store`. History rows dated inside the
 * export pair with its rows. Paired rows take the export's booked count and keep everything else.
 * Unpaired export rows become kind "hidden" rows named by category, with ids -1, -2, …
 */
export function mergeExport(store, exportRows) {
  const dates = exportRows.map(e => e.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  const history = Object.values(store).flatMap(m => m.sessions).filter(r => r.date >= from && r.date <= to);
  const { pairs, unpairedExport, unpairedHistory } = pairExport(history, exportRows);

  let changed = 0;
  let netPeople = 0;
  for (const [r, e] of pairs) {
    if (r.booked === e.booked) continue;
    changed += 1;
    netPeople += e.booked - r.booked;
    r.booked = e.booked;
  }

  const categories = {};
  unpairedExport.forEach((e, i) => {
    const name = categoryOf(e.name);
    const month = monthOf(e.date);
    store[month] ??= { month, closed: [], sessions: [] };
    store[month].sessions.push({
      id: -(i + 1), date: e.date, start: e.hour, end: e.hour === '23:00' ? '23:59' : nextHour(e.hour),
      level: 0, area: e.area, side: e.side, kids: isKids(e.name), name, kind: 'hidden',
      capacity: e.capacity, booked: e.booked, final: true, pace: [],
    });
    categories[name] ??= { rows: 0, people: 0 };
    categories[name].rows += 1;
    categories[name].people += e.booked;
  });

  const hiddenPeople = unpairedExport.reduce((n, e) => n + e.booked, 0);
  return {
    store, from, to,
    summary: { pairs: pairs.length, changed, netPeople, notInExport: unpairedHistory.length, hidden: unpairedExport.length, hiddenPeople, categories },
  };
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test scraper/test/cms.test.mjs`
Expected: PASS, 8 tests.

Run: `npm test`
Expected: PASS, the whole suite.

- [ ] **Step 5: Commit**

```bash
git add scraper/cms.mjs scraper/test/cms.test.mjs
git commit -m "feat: pair the CMS export with history and keep hidden bookings by category" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The import CLI

**Files:**
- Create: `scraper/import-cms.mjs`
- Modify: `package.json` (scripts), `.gitignore`, `README.md`
- Test: `scraper/test/import-cms.test.mjs`

**Interfaces:**
- Consumes:
  - `readXlsx`, `parseExport`, `mergeExport` and `EXPORT_HEADER` (Tasks 2–3);
  - `HISTORY_DIR`, `readIndex`, `readMonths`, `writeIndex` and `writeMonths` from `scraper/update-history.mjs`;
  - `israelIso` and `monthsBetween` from `site/lib/time.mjs`;
  - `xlsxOf` from `scraper/test-support/xlsx.mjs`.
- Produces: `importCms({ file, dir = HISTORY_DIR, dryRun = false, now = new Date(), log = console.log }) → Promise<summary>`.
  - It writes the history months and `index.json` with `cms: { from, to, importedAt }`.
  - It rejects with `already imported on YYYY-MM-DD` when `index.cms` exists.
  - The CLI is `node scraper/import-cms.mjs <file.xlsx> [--dry-run]`.

- [ ] **Step 1: Write the failing tests**

Create `scraper/test/import-cms.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPORT_HEADER } from '../cms.mjs';
import { formatMonth, parseMonth } from '../history.mjs';
import { importCms } from '../import-cms.mjs';
import { xlsxOf } from '../test-support/xlsx.mjs';

const NOW = new Date('2026-09-12T09:00:00Z'); // 12:00 in Israel
const quiet = () => {};
const ours = {
  id: 5, date: '2025-07-07', start: '08:00', end: '09:00', level: 4, area: 'reef', side: 'right', kids: false,
  name: 'סשן L4', kind: 'surf', capacity: 18, booked: 10, final: true, pace: [],
};

/** A history dir with one July session and an index, and an export that pairs with it plus one private lesson. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'srfsc-cms-'));
  const dir = join(root, 'history');
  await mkdir(dir);
  await writeFile(join(dir, '2025-07.json'), formatMonth({ month: '2025-07', closed: [], sessions: [ours] }));
  await writeFile(join(dir, 'index.json'), `${JSON.stringify({ updatedAt: 'x', first: '2025-04-02', months: ['2025-07'], snapshots: 0, snapshotsSince: null }, null, 2)}\n`);
  const file = join(root, 'export.xlsx');
  await writeFile(file, xlsxOf([
    EXPORT_HEADER,
    ['2025-07-07', 'Monday', '08:00', 'ריף', 'סשן L4', 'L4 - Advanced', ' ימין', '18', '9'],
    ['2025-07-07', 'Monday', '09:00', 'ביי', 'פרטי - לקוח לדוגמה', '', ' שמאל 1', '1', '1'],
  ]));
  return { dir, file };
}
const readBoth = dir => Promise.all(['2025-07.json', 'index.json'].map(f => readFile(join(dir, f), 'utf8')));

test('importCms merges the export into the history months and records its coverage', async () => {
  const { dir, file } = await setup();
  const summary = await importCms({ file, dir, now: NOW, log: quiet });
  assert.deepEqual([summary.pairs, summary.changed, summary.hidden], [1, 1, 1]);
  const text = await readFile(join(dir, '2025-07.json'), 'utf8');
  assert.deepEqual(parseMonth(text).sessions.map(r => [r.id, r.kind, r.name, r.booked]), [[5, 'surf', 'סשן L4', 9], [-1, 'hidden', 'שיעורים פרטיים', 1]]);
  assert.ok(!text.includes('לדוגמה'));
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(index.cms, { from: '2025-07-07', to: '2025-07-07', importedAt: '2026-09-12T12:00:00+03:00' });
  assert.equal(index.first, '2025-04-02');
});

test('importCms --dry-run reports but writes nothing', async () => {
  const { dir, file } = await setup();
  const before = await readBoth(dir);
  const lines = [];
  const summary = await importCms({ file, dir, dryRun: true, now: NOW, log: l => lines.push(l) });
  assert.equal(summary.hidden, 1);
  assert.deepEqual(await readBoth(dir), before);
  assert.deepEqual((await readdir(dir)).sort(), ['2025-07.json', 'index.json']);
  assert.ok(lines.includes('  שיעורים פרטיים: 1 rows, 1 bookings') && lines.includes('dry run: nothing written'), lines.join('\n'));
});

test('importCms refuses a second run, and a file that is not the CMS export', async () => {
  const { dir, file } = await setup();
  await importCms({ file, dir, now: NOW, log: quiet });
  await assert.rejects(importCms({ file, dir, now: NOW, log: quiet }), /already imported on 2026-09-12/);

  const other = await setup();
  const before = await readBoth(other.dir);
  await writeFile(other.file, xlsxOf([['שם', 'טלפון']]));
  await assert.rejects(importCms({ file: other.file, dir: other.dir, now: NOW, log: quiet }), /column 1 is "שם", expected "תאריך"/);
  assert.deepEqual(await readBoth(other.dir), before);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test scraper/test/import-cms.test.mjs`
Expected: FAIL with `Cannot find module` for `../import-cms.mjs`.

- [ ] **Step 3: Implement**

Create `scraper/import-cms.mjs`:

```js
// CLI: the one-time import of the park's CMS "wave demand" export into site/data/history/
// (CMS import spec section 4). It refuses to run twice; --dry-run only prints the summary.
// Usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { israelIso, monthsBetween } from '../site/lib/time.mjs';
import { mergeExport, parseExport, readXlsx } from './cms.mjs';
import { HISTORY_DIR, readIndex, readMonths, writeIndex, writeMonths } from './update-history.mjs';

export async function importCms({ file, dir = HISTORY_DIR, dryRun = false, now = new Date(), log = console.log }) {
  const index = await readIndex(dir);
  if (index?.cms) throw new Error(`already imported on ${index.cms.importedAt.slice(0, 10)}`);
  const { rows, skipped } = parseExport(readXlsx(await readFile(file)));
  if (!rows.length) throw new Error('the export has no usable rows');
  const dates = rows.map(r => r.date).sort();
  const store = await readMonths(dir, monthsBetween(dates[0], dates.at(-1)));
  const { from, to, summary } = mergeExport(store, rows);

  log(`read ${rows.length} rows ${from}..${to}; skipped ${JSON.stringify(skipped)}`);
  log(`paired ${summary.pairs}; booked changed on ${summary.changed} (${summary.netPeople > 0 ? '+' : ''}${summary.netPeople} people); ${summary.notInExport} of ours not in the export`);
  log(`hidden: ${summary.hidden} rows, ${summary.hiddenPeople} bookings`);
  for (const [label, c] of Object.entries(summary.categories).sort((a, b) => b[1].people - a[1].people)) {
    log(`  ${label}: ${c.rows} rows, ${c.people} bookings`);
  }
  if (dryRun) {
    log('dry run: nothing written');
    return summary;
  }
  const months = await writeMonths(dir, store);
  await writeIndex(dir, { ...index, cms: { from, to, importedAt: israelIso(now) } });
  log(`wrote ${months.length} months and index.json`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]');
    process.exitCode = 1;
  } else {
    importCms({ file, dryRun: args.includes('--dry-run') }).catch(err => {
      console.error(`CMS import failed: ${err.message}`);
      process.exitCode = 1;
    });
  }
}
```

In `package.json`, add this script after `"backfill"`:

```json
    "import-cms": "node scraper/import-cms.mjs",
```

Append to `.gitignore`:

```
# CMS exports hold customers' names: never commit them
*.xlsx
```

In `README.md`:

1. Append `, [CMS import](docs/superpowers/specs/2026-09-12-cms-import-design.md)` to the end of the `- Design:` line.
2. After the paragraph that starts "The page is static HTML", add this paragraph:

```markdown
History from 1.5.2025 to 10.9.2026 also holds a one-time import of the park's management-system (CMS) export. Public sessions carry its booked counts, and bookings the public schedule never showed (groups, camps, events, private lessons, clubs, courses) are stored by category only, never by name. The analysis tab shows them in their own section.
```

3. In the "Working on it" code block, after the `npm run backfill` line, add:

```
npm run import-cms -- <file.xlsx> [--dry-run]  # one-time: merge the park's CMS export (refuses to run twice)
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test scraper/test/import-cms.test.mjs`
Expected: PASS, 3 tests.

Run: `npm test`
Expected: PASS, the whole suite.

Run: `node scraper/import-cms.mjs`
Expected: prints `usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]` and exits with code 1. Don't run it on a real file: Task 8 does that.

- [ ] **Step 5: Commit**

```bash
git add scraper/import-cms.mjs scraper/test/import-cms.test.mjs package.json .gitignore README.md
git commit -m "feat: add the one-time CMS import command" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `hidden()` in the analysis model

**Files:**
- Modify: `site/lib/analytics.mjs` (add `periodBuckets` and use it in `trend`, add `hidden`, wire it into `analyse`)
- Test: `test/site/analytics.test.mjs`

**Interfaces:**
- Consumes:
  - history rows, including `kind: 'hidden'` rows whose `name` is a category label;
  - `periodRange` ranges `{ preset, from, to, compare: { kind, from, to } | null }`;
  - `index.cms` `{ from, to, importedAt }` or null.
- Produces: `hidden(rows, range, cms)`, which returns either `{ window: null }` or:

  ```js
  { window: { from, to }, compare: { from, to } | null, partial: boolean,
    people, sessions, share, reefShare,
    cmp: { people, sessions, share, reefShare } | null,
    categories: [{ label, people, sessions, share, avgSize, bayShare, cmpPeople: number | null }],
    unit: 'week' | 'month', buckets: [{ from, to, people }],
    grid: [{ hour: 'HH', cells: number[7] }] }  // cells: Sunday..Saturday
  ```

  - `analyse()` returns a new key, `hidden`, between `ops` and `coverage`.
  - `coverage` gains `cms` (`index.cms` or null).

- [ ] **Step 1: Write the failing tests**

In `test/site/analytics.test.mjs`:

1. Add `hidden` to the import list from `../../site/lib/analytics.mjs`. It sits alphabetically between `heatmap` and `levelKey`.
2. In the test `'analyse builds every section and counts the period for the coverage line'`, change the two last assertions to:

```js
  assert.deepEqual(Object.keys(model), ['range', 'prices', 'kpis', 'split', 'heat', 'levels', 'slots', 'trend', 'pace', 'upcoming', 'ops', 'hidden', 'coverage']);
  assert.deepEqual([model.kpis.cur.sessions, model.kpis.cur.daysOpen, model.kpis.cmp.sessions], [4, 4, 0]);
  assert.deepEqual(model.coverage, { first: '2025-04-02', sessions: 4, snapshots: 12, snapshotsSince: '2026-09-12', updatedAt: '2026-09-12T06:17:00+03:00', cms: null });
  assert.deepEqual(model.hidden, { window: null });
```

3. Append:

```js
const CMS = { from: '2025-05-01', to: '2026-09-10', importedAt: '2026-09-12T12:00:00+03:00' };
// A hidden booking from the CMS import (6.9.2026, a Bay camp); override fields per test.
const hid = (over = {}) => row({ id: -1, kind: 'hidden', name: 'קייטנות', area: 'bay', level: 0, capacity: 12, booked: 6, ...over });

test('hidden: no import, or a period outside it, has no window', () => {
  const range = periodRange('30d', '2026-12-01', '2025-04-02'); // 1.11–30.11.2026
  assert.deepEqual(hidden([hid()], range, null), { window: null });
  assert.deepEqual(hidden([hid()], range, CMS), { window: null });
});

test('hidden: totals, shares, categories, buckets and grid, compared with the same weeks a year earlier', () => {
  const rows = [
    hid({ id: -1, start: '09:00' }), // Sunday 6.9, Bay camp, 6 people
    hid({ id: -2, start: '09:00', area: 'reef', name: 'אירועים', capacity: 15, booked: 10 }),
    hid({ id: -3, date: '2026-07-03', start: '17:00', booked: 4 }), // a Friday
    hid({ id: -4, date: '2026-06-01', booked: 99 }), // before the period
    row({ id: 1, capacity: 20, booked: 20 }), // public reef surf
    row({ id: 2, date: '2026-08-01', kind: 'lesson', area: 'bay', level: 0, booked: 10 }),
    row({ id: 3, kind: 'blocked', booked: 0 }), // reef time, not for sale
    row({ id: 4, kind: 'cancelled', capacity: 0, booked: 0 }), // not reef time at all
    hid({ id: -5, date: '2025-07-04', booked: 5 }), // a year earlier
    row({ id: 5, date: '2025-07-04', capacity: 15, booked: 15 }),
  ];
  const h = hidden(rows, periodRange('90d', '2026-09-11', '2025-04-02'), CMS);
  assert.deepEqual([h.window, h.compare, h.partial], [{ from: '2026-06-13', to: '2026-09-10' }, { from: '2025-06-14', to: '2025-09-11' }, false]);
  assert.deepEqual([h.people, h.sessions, h.share], [20, 3, 0.4]); // 20 of 20 + 30 public
  close(h.reefShare, 1 / 3); // one hidden reef side of surf, blocked and hidden
  assert.deepEqual(h.cmp, { people: 5, sessions: 1, share: 0.25, reefShare: 0 });
  assert.deepEqual(h.categories, [
    { label: 'אירועים', people: 10, sessions: 1, share: 0.5, avgSize: 10, bayShare: 0, cmpPeople: 0 },
    { label: 'קייטנות', people: 10, sessions: 2, share: 0.5, avgSize: 5, bayShare: 1, cmpPeople: 5 },
  ]);
  assert.deepEqual([h.unit, h.buckets.length, h.buckets.reduce((n, b) => n + b.people, 0)], ['week', 13, 20]);
  assert.deepEqual(h.buckets.at(-1), { from: '2026-09-05', to: '2026-09-10', people: 16 });
  assert.deepEqual(h.grid, [{ hour: '09', cells: [16, 0, 0, 0, 0, 0, 0] }, { hour: '17', cells: [0, 0, 0, 0, 0, 4, 0] }]);
});

test('hidden: a period running past the import is partial; no comparison before the import starts', () => {
  const past = hidden([hid({ date: '2025-05-10' })], periodRange('30d', '2025-06-01', '2025-04-02'), CMS);
  assert.deepEqual([past.window, past.compare, past.cmp, past.partial], [{ from: '2025-05-02', to: '2025-05-31' }, null, null, false]);
  assert.equal(past.categories[0].cmpPeople, null);
  const year = hidden([hid({ date: '2026-01-15' })], periodRange('12m', '2026-09-12', '2025-04-02'), CMS);
  assert.deepEqual([year.window, year.partial, year.unit, year.buckets.length], [{ from: '2025-09-12', to: '2026-09-10' }, true, 'month', 13]);
  assert.deepEqual([year.buckets[0].from, year.buckets.at(-1).to], ['2025-09-12', '2026-09-10']);
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test test/site/analytics.test.mjs`
Expected: FAIL with a SyntaxError: `analytics.mjs` doesn't export `hidden`.

- [ ] **Step 3: Implement**

In `site/lib/analytics.mjs`:

1. Right after the `yearEarlier` line, add:

```js

/** Weekly buckets up to 92 days, calendar months above, clipped to from..to. */
function periodBuckets(from, to) {
  const weekly = daysBetween(from, to) + 1 <= WEEKLY_MAX_DAYS;
  const buckets = [];
  if (weekly) {
    for (let f = from; f <= to; f = addDays(f, 7)) {
      const end = addDays(f, 6);
      buckets.push({ from: f, to: end < to ? end : to });
    }
  } else {
    for (const m of monthsBetween(from, to)) {
      const end = monthEnd(m);
      buckets.push({ from: `${m}-01` > from ? `${m}-01` : from, to: end < to ? end : to });
    }
  }
  return { unit: weekly ? 'week' : 'month', buckets };
}
```

2. In `trend`, replace the lines from `const weekly = daysBetween(range.from, range.to) + 1 <= WEEKLY_MAX_DAYS;` through the closing `}` of the `if (weekly) { … } else { … }` block with:

```js
  const { unit, buckets } = periodBuckets(range.from, range.to);
  const weekly = unit === 'week';
```

   The rest of `trend` stays as it is: it already uses `weekly` and `buckets`, and returns `unit: weekly ? 'week' : 'month'`.

3. After the `operations` function (before `analyse`), add:

```js

const REEF_TIME = new Set(['surf', 'event', 'blocked', 'hidden']);
const peopleOf = rows => rows.reduce((n, r) => n + r.booked, 0);

/**
 * Bookings the public schedule never showed, from the one-time CMS import (CMS import spec 6.2).
 * Only the part of the range inside the import's coverage counts; the level filter doesn't apply.
 */
export function hidden(rows, range, cms) {
  if (!cms) return { window: null };
  const from = range.from > cms.from ? range.from : cms.from;
  const to = range.to < cms.to ? range.to : cms.to;
  if (from > to) return { window: null };
  const offset = range.compare ? daysBetween(range.compare.from, range.from) : null;
  const compare = offset !== null && addDays(from, -offset) >= cms.from ? { from: addDays(from, -offset), to: addDays(to, -offset) } : null;
  const measure = (a, b) => {
    const inWindow = rows.filter(r => inRange(r, a, b));
    const list = inWindow.filter(r => r.kind === 'hidden');
    const people = peopleOf(list);
    const reef = inWindow.filter(r => r.area === 'reef' && REEF_TIME.has(r.kind));
    return {
      list,
      totals: {
        people, sessions: list.length,
        share: share(people, people + peopleOf(inWindow.filter(isCounted))),
        reefShare: share(reef.filter(r => r.kind === 'hidden').length, reef.length),
      },
    };
  };
  const cur = measure(from, to);
  const cmp = compare ? measure(compare.from, compare.to) : null;
  const cmpByLabel = cmp ? groupBy(cmp.list, r => r.name) : new Map();
  const categories = [...groupBy(cur.list, r => r.name)]
    .map(([label, g]) => {
      const people = peopleOf(g);
      return {
        label, people, sessions: g.length, share: share(people, cur.totals.people), avgSize: people / g.length,
        bayShare: share(peopleOf(g.filter(r => r.area === 'bay')), people),
        cmpPeople: cmp ? peopleOf(cmpByLabel.get(label) ?? []) : null,
      };
    })
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));
  const { unit, buckets } = periodBuckets(from, to);
  const hours = [...new Set(cur.list.map(r => r.start.slice(0, 2)))].sort();
  return {
    window: { from, to }, compare, partial: from > range.from || to < range.to,
    ...cur.totals, cmp: cmp ? cmp.totals : null, categories, unit,
    buckets: buckets.map(b => ({ ...b, people: peopleOf(cur.list.filter(r => inRange(r, b.from, b.to))) })),
    grid: hours.map(hour => ({
      hour,
      cells: [0, 1, 2, 3, 4, 5, 6].map(d => peopleOf(cur.list.filter(r => r.start.slice(0, 2) === hour && dayOfWeek(r.date) === d))),
    })),
  };
}
```

4. In `analyse`, add `hidden: hidden(rows, range, index?.cms ?? null),` after the `ops:` line. Then add `cms: index?.cms ?? null` as the last property of the `coverage` object, after `updatedAt`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test test/site/analytics.test.mjs`
Expected: PASS, every test. The three `trend` tests must still pass unchanged: they prove the `periodBuckets` refactor kept behaviour.

Run: `npm test`
Expected: PASS, the whole suite.

- [ ] **Step 5: Commit**

```bash
git add site/lib/analytics.mjs test/site/analytics.test.mjs
git commit -m "feat: measure hidden bookings in the analysis model" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The `hidden-share` insight

**Files:**
- Modify: `site/lib/insights.mjs`
- Test: `test/site/insights.test.mjs`

**Interfaces:**
- Consumes: `model.hidden` from Task 5 (`{ window, sessions, share, categories: [{ label, share }] }`, or `{ window: null }`, or absent in older test models).
- Produces: `{ rule: 'hidden-share', tone: 'info', link: 'hidden', impact: null, text }`. Task 7 adds the `hidden` link target.

- [ ] **Step 1: Write the failing test**

Append to `test/site/insights.test.mjs`:

```js
test('hidden-share: 10% of bookings and 20 sessions outside the public schedule', () => {
  const hid = (over = {}) => ({ window: { from: '2026-06-13', to: '2026-09-10' }, sessions: 40, share: 0.17, categories: [{ label: 'קבוצות וארגונים', share: 0.37 }], ...over });
  const [i] = insights(model({ hidden: hid() }));
  assert.deepEqual([i.rule, i.tone, i.link, i.impact], ['hidden-share', 'info', 'hidden', null]);
  assert.equal(i.text, '17% מההזמנות בתקופה לא עברו בלוח הציבורי, בעיקר קבוצות וארגונים (37%).');
  assert.equal(insights(model({ hidden: hid({ share: 0.1 }) })).length, 1);
  assert.deepEqual(insights(model({ hidden: hid({ share: 0.09 }) })), []);
  assert.deepEqual(insights(model({ hidden: hid({ sessions: 19 }) })), []);
  assert.deepEqual(insights(model({ hidden: { window: null } })), []);
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `node --test test/site/insights.test.mjs`
Expected: FAIL. `i` is `undefined` because no rule fires.

- [ ] **Step 3: Implement**

In `site/lib/insights.mjs`, right before the final `return out.sort(…)` line, add:

```js

  const hid = model.hidden;
  if (hid?.window && hid.sessions >= MIN_SESSIONS && hid.share >= 0.1 && hid.categories.length) {
    const top = hid.categories[0];
    out.push({
      rule: 'hidden-share', tone: 'info', link: 'hidden', impact: null,
      text: `${points(hid.share)}% מההזמנות בתקופה לא עברו בלוח הציבורי, בעיקר ${top.label} (${points(top.share)}%).`,
    });
  }
```

Then update the file's header comment to mention the rule's source: change `(analysis spec section 6.9)` to `(analysis spec section 6.9, CMS import spec 6.4)`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test test/site/insights.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add site/lib/insights.mjs test/site/insights.test.mjs
git commit -m "feat: point out when many bookings bypass the public schedule" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The "מה לא בלוח הציבורי" section

**Files:**
- Modify: `site/lib/render-analysis.mjs`
- Modify: `site/styles.css` (append)
- Test: `test/site/render-analysis.test.mjs`

**Interfaces:**
- Consumes: `model.hidden` and `model.coverage.cms` (Task 5); the `hidden` insight link (Task 6).
- Produces:
  - a `<section class="sec" id="a-hidden">` placed right after `a-levels`;
  - `LINKS.hidden`;
  - the new KPI footnote and the coverage-line text.

- [ ] **Step 1: Write the failing tests**

In `test/site/render-analysis.test.mjs`:

1. In the test `'renderAnalysis: nine sections in order, …'`:
   - rename it to `'renderAnalysis: ten sections in order, the numbers, and escaped park text'`;
   - change the ids assertion to:

```js
  assert.deepEqual(ids, ['kpis', 'insights', 'heat', 'levels', 'hidden', 'slots', 'trend', 'pace', 'upcoming', 'ops']);
```

   - add these two lines at the end of that test:

```js
  assert.ok(html.includes('הזמנות שלא עברו בלוח מופיעות ב״מה לא בלוח הציבורי״.'));
  assert.ok(html.includes('<p class="empty">אין נתוני מערכת ניהול.</p>')); // this model has no import
```

2. Append:

```js
const CMS = { from: '2025-05-01', to: '2026-09-10', importedAt: '2026-09-12T12:00:00+03:00' };
const withCms = (range = periodRange('90d', '2026-09-12', '2025-04-02')) => analyse({
  rows: [
    ...history(),
    row({ id: -1, kind: 'hidden', name: 'קייטנות', area: 'bay', level: 0, date: '2026-07-03', start: '09:00', capacity: 12, booked: 9 }),
    row({ id: -2, kind: 'hidden', name: 'אירועים', date: '2026-08-02', start: '20:00', capacity: 30, booked: 30 }),
  ],
  closed: [], range, levels: new Set(), prices: PRICES, schedule: { days: [] }, now: new Date('2026-09-12T09:00:00Z'),
  index: { first: '2025-04-02', snapshots: 0, snapshotsSince: null, updatedAt: null, cms: CMS },
});

test('renderAnalysis: hidden bookings with partial coverage, and the coverage line', () => {
  const html = renderAnalysis(withCms(), [], UI);
  assert.ok(html.includes('<section class="sec" id="a-hidden">'));
  assert.ok(html.includes('בתקופה שנבחרה הנתונים מכסים רק את <span class="ltr num">14.6.2026–10.9.2026</span>.'));
  assert.ok(html.includes('<span class="k">הזמנות סגורות</span><span class="v num">39</span>'));
  assert.ok(html.includes('<span class="k">חלק מכל ההזמנות</span><span class="v num">15%</span>')); // 39 of 39 + 216 public
  assert.ok(html.indexOf('<td>אירועים</td>') < html.indexOf('<td>קייטנות</td>')); // 30 people before 9
  assert.ok(html.includes('<td class="dlt num">חדש</td>')); // none a year earlier
  assert.ok(html.includes('aria-label="הזמנות סגורות לפי שבוע"'));
  assert.ok(html.includes('title="שישי 09:00 · 9 הזמנות"')); // 3.7.2026 was a Friday
  assert.ok(html.includes('נתוני מערכת הניהול <span class="ltr num">1.5.2025–10.9.2026</span>'));
});

test('renderAnalysis: a period after the import shows how to reach its data', () => {
  const html = renderAnalysis(withCms(periodRange('30d', '2026-12-01', '2025-04-02')), [], UI);
  assert.ok(html.includes('אין נתוני מערכת ניהול לתקופה הזו – הייצוא מכסה <span class="ltr num">1.5.2025–10.9.2026</span>. בחרו 12 חודשים או הכול.'));
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node --test test/site/render-analysis.test.mjs`
Expected: FAIL. The ids don't include `hidden`, and the new strings are missing.

- [ ] **Step 3: Implement**

In `site/lib/render-analysis.mjs`:

1. Add `hidden: 'לפעילות הסגורה'` to the end of the `LINKS` object.

2. Below the `seg` helper, add two shared helpers:

```js
const HEAT_HEAD = `<div></div>${HE_DAYS.map((_, i) => `<div class="hd"><b>${HE_DAYS_SHORT[i]}</b>${i >= 5 ? 'סופ״ש' : ''}</div>`).join('')}`;
/** A chart bucket's axis label: "13.6" for a week, "6.26" for a month. */
const bucketLabel = (b, unit) => (unit === 'week' ? shortDate(b.from) : `${Number(b.from.slice(5, 7))}.${b.from.slice(2, 4)}`);
```

   Then use them in the existing code:
   - in `heatSection`, replace the whole `const head = …;` line with `const head = HEAT_HEAD;`;
   - in `trendChart`, replace `${unit === 'week' ? shortDate(b.from) : `${Number(b.from.slice(5, 7))}.${b.from.slice(2, 4)}`}` with `${bucketLabel(b, unit)}`.

3. In `kpiSection`'s footnote, replace the sentence `התפוסה והמקומות לא כוללים אירועים פרטיים וסשנים שבוטלו.` with `התפוסה והמקומות כוללים רק את הלוח הציבורי, בלי סשנים שבוטלו. הזמנות שלא עברו בלוח מופיעות ב״מה לא בלוח הציבורי״.`

4. After `levelSection` (before the `// ---------- 5. slots ----------` comment), add:

```js
// ---------- 4b. hidden bookings (CMS import) ----------

function countChart(buckets, unit) {
  const W = 700, H = 180, L = 44, R = 8, T = 12, B = 34;
  const top = Math.max(1, ...buckets.map(b => b.people));
  const bw = (W - L - R) / buckets.length;
  const y = v => T + (1 - v / top) * (H - T - B);
  const x = i => W - R - (i + 1) * bw; // time runs right to left, like the trend chart
  const every = Math.ceil(buckets.length / 7);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="הזמנות סגורות לפי ${unit === 'week' ? 'שבוע' : 'חודש'}">`;
  for (const g of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g * top)}" y2="${y(g * top)}" class="grid"/><text x="${L - 6}" y="${y(g * top) + 4}" text-anchor="end">${int(g * top)}</text>`;
  buckets.forEach((b, i) => {
    if (b.people) s += `<rect x="${x(i) + 3}" y="${y(b.people)}" width="${Math.max(1, bw - 6)}" height="${y(0) - y(b.people)}" rx="3" class="bar-cur"><title>${fullDate(b.from)}: ${int(b.people)}</title></rect>`;
    if (i % every === 0) s += `<text x="${x(i) + bw / 2}" y="${H - 12}" text-anchor="middle">${bucketLabel(b, unit)}</text>`;
  });
  return `${s}</svg>`;
}

function hiddenGrid(grid) {
  const max = Math.max(1, ...grid.flatMap(r => r.cells));
  const step = v => HEAT_STEPS.revenue.filter(t => v / max >= t).length; // relative to the busiest cell
  const rows = grid.map(r => `<div class="hr num">${r.hour}:00</div>${r.cells.map((v, d) => (v
    ? `<div class="c s${step(v)} num" title="${HE_DAYS[d]} ${r.hour}:00 · ${int(v)} הזמנות">${int(v)}</div>`
    : '<div class="c"></div>')).join('')}`).join('');
  return `<div class="heat">${HEAT_HEAD}${rows}</div>`;
}

const categoryChange = c => {
  if (c.cmpPeople === null) return '–';
  if (!c.cmpPeople) return 'חדש';
  const diff = Math.round((c.people / c.cmpPeople - 1) * 100);
  return `${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${Math.abs(diff)}%`;
};

function hiddenSection(model) {
  const h = model.hidden;
  const cov = model.coverage.cms;
  const title = 'מה לא בלוח הציבורי';
  if (!h?.window) {
    return section('hidden', title, '', empty(cov
      ? `אין נתוני מערכת ניהול לתקופה הזו – הייצוא מכסה ${dates(cov.from, cov.to)}. בחרו 12 חודשים או הכול.`
      : 'אין נתוני מערכת ניהול.'));
  }
  const sub = `הזמנות שלא הופיעו בלוח הציבורי: קבוצות, קייטנות, אירועים, פרטיים וחוגים. לפי ייצוא מערכת הניהול, ${dates(cov.from, cov.to)}. סינון הרמות לא חל כאן.`
    + (h.partial ? ` בתקופה שנבחרה הנתונים מכסים רק את ${dates(h.window.from, h.window.to)}.` : '');
  const label = model.range.compare?.kind === 'lastYear' ? 'אשתקד' : 'בתקופה הקודמת';
  const d = (key, opts) => delta(h[key], h.cmp ? h.cmp[key] : null, { label, ...opts });
  const tiles = [
    ['הזמנות סגורות', `<span class="v num">${int(h.people)}</span>`, d('people', { format: int })],
    ['חלק מכל ההזמנות', `<span class="v num">${pct(h.share)}</span>`, d('share', { ratio: true, format: pct })],
    ['משבצות ריף שלא היו למכירה', `<span class="v num">${pct(h.reefShare)}</span>`, d('reefShare', { ratio: true, format: pct })],
  ].map(([k, v, dd]) => `<div class="card kpi"><span class="k">${k}</span>${v}${dd}</div>`).join('');
  const kpis = `<div class="kpis hid">${tiles}</div>`;
  if (!h.sessions) return section('hidden', title, sub, kpis + empty('אין הזמנות סגורות בתקופה.'));
  const rows = h.categories.map(c => `<tr><td>${escapeHtml(c.label)}</td><td class="num">${int(c.people)}</td><td class="num">${pct(c.share)}</td>`
    + `<td class="num">${int(c.sessions)}</td><td class="num">${c.avgSize.toFixed(1)}</td><td class="num">${pct(c.bayShare)}</td><td class="dlt num">${categoryChange(c)}</td></tr>`).join('');
  const table = `<div class="card tbl-scroll"><table class="tbl"><thead><tr><th>קטגוריה</th><th>הזמנות</th><th>חלק</th><th>סשנים</th><th>ממוצע לסשן</th><th>ב־Bay</th><th>שינוי</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const chart = `<div class="card trend">${countChart(h.buckets, h.unit)}<p class="foot">${h.unit === 'week' ? 'לפי שבוע' : 'לפי חודש'}. הזמן זורם מימין לשמאל.</p></div>`;
  const grid = `<div class="card heat-wrap">${hiddenGrid(h.grid)}<p class="foot">כמה הזמנות סגורות היו בכל יום ושעה בתקופה.</p></div>`;
  return section('hidden', title, sub, `${kpis}${table}<div class="hid-when">${chart}${grid}</div>`);
}
```

5. In `opsSection`, put the CMS coverage in the `coverage` template string right before ` · מתעדכן בכל ריענון`:

```js
${c.cms ? ` · נתוני מערכת הניהול ${dates(c.cms.from, c.cms.to)}` : ''}
```

6. In `renderAnalysis`, insert `+ hiddenSection(model)` right after `levelSection(model)`:

```js
  return kpiSection(model) + insightSection(insightList) + heatSection(model, ui.heatMetric) + levelSection(model) + hiddenSection(model)
    + slotSection(model) + trendSection(model, ui.trendMetric) + paceSection(model) + upcomingSection(model) + opsSection(model);
```

Append to `site/styles.css`:

```css

/* hidden bookings (CMS import) */
.kpis.hid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 8px; }
.hid-when { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
@media (max-width: 720px) {
  .kpis.hid, .hid-when { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node --test test/site/render-analysis.test.mjs`
Expected: PASS, every test. The existing heat and trend assertions prove the `HEAT_HEAD` and `bucketLabel` refactor kept output identical.

Run: `npm test`
Expected: PASS, the whole suite.

- [ ] **Step 5: Commit**

```bash
git add site/lib/render-analysis.mjs site/styles.css test/site/render-analysis.test.mjs
git commit -m "feat: show hidden bookings in the analysis tab" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Run the import, check it, and commit the data (controller)

The controller does this task itself, not an implementer. It needs the owner's file, `C:\Users\Asi\Downloads\wave-demand-report.xlsx`, and it writes public data.

**Files:**
- Modify: `site/data/history/2025-05.json` … `2026-09.json`, `site/data/history/index.json`
- Temporary: `<scratchpad>/check-privacy.mjs` (never committed)

- [ ] **Step 1: Dry run**

Run: `node scraper/import-cms.mjs "C:\Users\Asi\Downloads\wave-demand-report.xlsx" --dry-run`

Expected: close to these figures.
- `read 17912 rows 2025-05-01..2026-09-10; skipped {}`.
- About 14,564 pairs.
- Booked changed on roughly 333 or more sessions, about −418 people. That count covers all pairs, so it can be slightly above the spec's counted-only figure.
- About 3,348 hidden rows and 18,325 bookings.
- Categories led by קבוצות וארגונים (~37%), קייטנות (~24%) and אירועים (~18%).

If pairs or hidden rows differ by more than 1%, stop and investigate before writing anything.

- [ ] **Step 2: Import**

Run: `npm run import-cms -- "C:\Users\Asi\Downloads\wave-demand-report.xlsx"`
Expected: the same summary, then `wrote 17 months and index.json`.

Run: `git status --short`
Expected: only `site/data/history/*.json` changed. No `.xlsx` is listed.

- [ ] **Step 3: Privacy check**

Write `<scratchpad>/check-privacy.mjs`, replacing `<repo>` with the absolute repo path as a `file:///` URL:

```js
// Every export name that the public schedule never published must be absent from site/data.
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseExport, readXlsx } from 'file:///<repo>/scraper/cms.mjs';

const clean = s => s.replace(/\s+/g, ' ').trim();
const exported = new Set(parseExport(readXlsx(await readFile(process.argv[2]))).rows.map(r => r.name));
const published = new Set(); // names in the history before the import
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1e9 });
for (const f of git(['ls-tree', '--name-only', 'HEAD', 'site/data/history/']).split('\n').filter(f => /\d{4}-\d{2}\.json$/.test(f))) {
  for (const n of JSON.parse(git(['show', `HEAD:${f}`])).names) published.add(clean(n));
}
let text = '';
for (const f of await readdir('site/data', { recursive: true })) if (f.endsWith('.json')) text += await readFile(`site/data/${f}`, 'utf8');
const leaks = [...exported].filter(n => !published.has(n) && n.length >= 3 && text.includes(n));
console.log(leaks.length ? `LEAKS:\n${leaks.join('\n')}` : `no leaks (${exported.size} export names checked)`);
```

Run from the repo root: `node <scratchpad>/check-privacy.mjs "C:\Users\Asi\Downloads\wave-demand-report.xlsx"`
Expected: `no leaks (…)`.

Any leak stops the rollout, but check each one first. A short export name can also be a substring of a public name or a category label; those are fine once confirmed.

- [ ] **Step 4: Tests and the page**

Run: `npm test`
Expected: PASS.

Start the `site` preview (port 8124) and open the analysis tab. Check:
- **At 1280px, 90 days:**
  - the new section sits after "מה נמכר";
  - the subtitle says the data covers only up to 10.9.2026;
  - the tiles, the category table (קבוצות וארגונים near the top), the weekly bar chart and the day × hour grid all show;
  - the footnote and the coverage line carry the new text.
- **"12 חודשים" and "הכול":** monthly bars, and the section shows no comparison where the history doesn't cover one.
- **At 375px:** the tiles and the two cards stack; the page doesn't scroll sideways (`document.documentElement.scrollWidth <= innerWidth`).
- **Console:** no errors.

- [ ] **Step 5: Commit the data**

```bash
git add site/data/history
git commit -m "data: import the park's CMS export (1.5.2025–10.9.2026)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
