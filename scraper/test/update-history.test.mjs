import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from '../normalize.mjs';
import { formatMonth, parseMonth } from '../history.mjs';
import { updateHistory } from '../update-history.mjs';
import { fixtureFetch, fixtureWindow, isoFromUrl, recordingSleep, scriptedFetch } from '../test-support/fake-park.mjs';

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

test('updateHistory catches up the final counts from the day after the last final day', async () => {
  const { dir, scheduleFile } = await setup();
  const lastFinal = { id: 1, date: '2026-09-06', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false, name: 'L3', kind: 'surf', capacity: 18, booked: 5, final: true, pace: [] };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '2026-09.json'), formatMonth({ month: '2026-09', closed: [], sessions: [lastFinal] }));
  const fetchImpl = fixtureFetch();
  await updateHistory({ dir, scheduleFile, now: NOW, fetchImpl, log: quiet });
  assert.deepEqual(fetchImpl.calls.map(c => isoFromUrl(c.url)), ['2026-09-07', '2026-09-10']);
});
