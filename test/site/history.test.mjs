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
