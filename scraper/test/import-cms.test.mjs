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

test('importCms creates new months and registers them in index.months', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srfsc-cms-'));
  const dir = join(root, 'history');
  await mkdir(dir);
  await writeFile(join(dir, '2025-07.json'), formatMonth({ month: '2025-07', closed: [], sessions: [ours] }));
  await writeFile(join(dir, 'index.json'), `${JSON.stringify({ updatedAt: 'x', first: '2025-04-02', months: ['2025-07'], snapshots: 0, snapshotsSince: null }, null, 2)}\n`);
  const file = join(root, 'export.xlsx');
  await writeFile(file, xlsxOf([
    EXPORT_HEADER,
    ['2025-07-07', 'Monday', '08:00', 'ריף', 'סשן L4', 'L4 - Advanced', ' ימין', '18', '9'],
    ['2025-08-01', 'Friday', '09:00', 'ביי', 'פרטי - לקוח לדוגמה', '', ' שמאל 1', '1', '1'],
  ]));
  await importCms({ file, dir, now: NOW, log: quiet });
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(index.months, ['2025-07', '2025-08']);
  const august = parseMonth(await readFile(join(dir, '2025-08.json'), 'utf8'));
  assert.deepEqual(august.sessions.map(r => [r.id, r.kind, r.name]), [[-1, 'hidden', 'שיעורים פרטיים']]);
});
