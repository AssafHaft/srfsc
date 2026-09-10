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
