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
