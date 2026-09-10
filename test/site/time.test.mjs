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
