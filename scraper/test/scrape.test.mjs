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

test('scrape accepts a park that publishes only closures', async () => {
  const existing = { days: [{ date: '2026-09-10', sessions: [{ id: 1 }] }] };
  const closures = { ...EMPTY_WINDOW, close_days: [{ date: '2026-09-11', text: 'סגור לתחזוקה' }] };
  const schedule = await scrape({ now: NOW, existing, fetchImpl: scriptedFetch([response(closures), response(EMPTY_WINDOW)]), log: quiet });
  assert.equal(schedule.publishedThrough, '2026-09-11');
  assert.equal(schedule.days.at(-1).closed, 'סגור לתחזוקה');
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
