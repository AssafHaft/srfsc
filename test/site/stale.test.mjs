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
