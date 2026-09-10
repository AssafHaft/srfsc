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
