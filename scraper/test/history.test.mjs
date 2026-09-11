import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../normalize.mjs';
import {
  applyFinal, compareRows, finalizeStale, formatMonth, minutesBefore, nextIndex, parseMonth, toRow, upsertUpcoming,
} from '../history.mjs';
import { fixtureWindow } from '../test-support/fake-park.mjs';

const DATES = ['2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const scheduleAt = fetchedAt => normalize(DATES.map(fixtureWindow), { today: '2026-09-10', fetchedAt }).schedule;
const allRows = store => Object.values(store).flatMap(m => m.sessions);
const rowById = (store, id) => allRows(store).find(r => r.id === id);
const sessionOf = (schedule, id) => schedule.days.flatMap(d => d.sessions).find(s => s.id === id);
// A plausible history row; override fields per test.
const row = (over = {}) => ({
  id: 1, date: '2026-09-10', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 18, booked: 5, final: false, pace: [], ...over,
});

test('toRow: real rows get their kind, kids flag and numbers', () => {
  const schedule = scheduleAt('2026-09-10T16:17:00+03:00');
  const rows = schedule.days.flatMap(d => d.sessions.map(s => toRow(d.date, s)));
  const byId = id => rows.find(r => r.id === id);
  assert.equal(byId(38905).kind, 'blocked'); // 10/09 20:00 women's retreat, disabled
  assert.deepEqual([byId(37616).kind, byId(37616).capacity, byId(37616).booked], ['lesson', 2, 8]); // overbooked Bay
  assert.deepEqual([byId(37303).kind, byId(37303).final, byId(37303).pace], ['surf', false, []]);
  const kids = rows.filter(r => r.kids);
  assert.ok(kids.length > 0);
  assert.ok(kids.every(r => r.area === 'bay' && /ילדים|גילאי/.test(r.name)));
});

test('minutesBefore counts Israel time, across the DST change too', () => {
  assert.equal(minutesBefore('2026-09-10', '16:30', '2026-09-10T16:17:00+03:00'), 13);
  assert.equal(minutesBefore('2026-10-25', '08:00', '2026-10-24T20:00:00+03:00'), 780);
  assert.equal(minutesBefore('2026-09-10', '06:00', '2026-09-10T16:17:00+03:00'), -617);
});

test('upsertUpcoming adds every session with a first pace entry and records closed days', () => {
  const schedule = scheduleAt('2026-09-10T16:17:00+03:00');
  const store = upsertUpcoming({}, schedule);
  assert.deepEqual(Object.keys(store), ['2026-09']);
  assert.equal(allRows(store).length, 438);
  assert.deepEqual(store['2026-09'].closed, [{ date: '2026-09-21', text: 'יום כיפור' }]);
  const later = allRows(store).find(r => r.date === '2026-09-14');
  assert.deepEqual(later.pace, [[minutesBefore(later.date, later.start, schedule.fetchedAt), later.booked]]);
  assert.deepEqual(rowById(store, 37303).pace, []); // 10/09 06:00 had already started at 16:17
});

test('upsertUpcoming appends pace only when booked changes, and updates changed fields', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T16:17:00+03:00'));
  const id = allRows(store).find(r => r.date === '2026-09-14' && r.area === 'reef').id;
  upsertUpcoming(store, scheduleAt('2026-09-10T16:47:00+03:00'));
  assert.equal(rowById(store, id).pace.length, 1);

  const changed = scheduleAt('2026-09-10T17:17:00+03:00');
  const s = sessionOf(changed, id);
  s.booked += 2;
  s.capacity = 0;
  upsertUpcoming(store, changed);
  const r = rowById(store, id);
  assert.equal(r.pace.length, 2);
  assert.deepEqual(r.pace[1], [minutesBefore(r.date, r.start, changed.fetchedAt), s.booked]);
  assert.deepEqual([r.booked, r.capacity, r.kind], [s.booked, 0, 'cancelled']);
});

test('upsertUpcoming never overwrites a final row', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T16:17:00+03:00'));
  const r = allRows(store).find(x => x.date === '2026-09-14');
  r.final = true;
  const before = structuredClone(r);
  const changed = scheduleAt('2026-09-10T17:17:00+03:00');
  sessionOf(changed, r.id).booked += 3;
  upsertUpcoming(store, changed);
  assert.deepEqual(rowById(store, r.id), before);
});

test('applyFinal takes the park counts for its range, keeps pace, and marks unlisted rows removed', () => {
  const store = upsertUpcoming({}, scheduleAt('2026-09-10T08:00:00+03:00'));
  const target = allRows(store).find(r => r.date === '2026-09-11');
  const pace = structuredClone(target.pace);
  assert.equal(pace.length, 1);
  store['2026-09'].sessions.push(row({ id: 999001, date: '2026-09-12' }));

  const window = structuredClone(fixtureWindow('2026-09-10'));
  const raw = window.scheduler.find(x => x.scheduler_id === target.id);
  raw[`${target.side}_count_users`] = 3;
  applyFinal(store, window, { from: '2026-09-10', to: '2026-09-12' });

  const r = rowById(store, target.id);
  assert.deepEqual([r.final, r.booked, r.pace], [true, 3, pace]);
  assert.deepEqual([rowById(store, 999001).kind, rowById(store, 999001).final], ['removed', true]);
  assert.ok(allRows(store).filter(x => x.date >= '2026-09-13').every(x => x.final === false));
});

test('applyFinal records close days with tidy text, and marks the sessions of a closed day removed', () => {
  const store = { '2026-09': { month: '2026-09', closed: [], sessions: [row({ date: '2026-09-11' })] } };
  applyFinal(store, { scheduler: [], close_days: [{ date: '2026-09-11', text: 'סגור\n לתחזוקה ' }] }, { from: '2026-09-11', to: '2026-09-13' });
  assert.deepEqual(store['2026-09'].closed, [{ date: '2026-09-11', text: 'סגור לתחזוקה' }]);
  assert.equal(store['2026-09'].sessions[0].kind, 'removed');
});

test('finalizeStale keeps the last snapshot for rows more than 3 days old', () => {
  const store = { '2026-09': { month: '2026-09', closed: [], sessions: [
    row({ id: 1, date: '2026-09-06' }), row({ id: 2, date: '2026-09-07' }), row({ id: 3, date: '2026-09-05', final: true }),
  ] } };
  finalizeStale(store, '2026-09-10');
  assert.deepEqual(store['2026-09'].sessions.map(r => r.final), ['snapshot', false, true]);
});

test('formatMonth writes one sorted session per line with names by index, and parses back', () => {
  const m = {
    month: '2026-09',
    closed: [{ date: '2026-09-21', text: 'יום כיפור' }],
    sessions: [row({ id: 3, start: '09:00', name: 'B' }), row({ id: 2, side: 'left', name: 'A' }), row({ id: 1, name: 'A', pace: [[600, 2]] })],
  };
  const text = formatMonth(m);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 5), ['{', '  "month": "2026-09",', '  "names": ["A","B"],', '  "closed": [{"date":"2026-09-21","text":"יום כיפור"}],', '  "sessions": [']);
  assert.equal(lines[5], '    {"id":1,"date":"2026-09-10","start":"08:00","end":"09:00","level":3,"area":"reef","side":"right","kids":false,"name":0,"kind":"surf","capacity":18,"booked":5,"final":false,"pace":[[600,2]]},');
  assert.match(lines[6], /^ {4}\{"id":2,.*"side":"left",.*"name":0,/);
  assert.match(lines[7], /^ {4}\{"id":3,.*"name":1,.*\}$/);
  assert.ok(text.endsWith('\n  ]\n}\n'));
  assert.deepEqual(parseMonth(text), { ...m, sessions: [...m.sessions].sort(compareRows) });
  assert.equal(formatMonth({ month: '2026-10', closed: [], sessions: [] }), '{\n  "month": "2026-10",\n  "names": [],\n  "closed": [],\n  "sessions": []\n}\n');
});

test('nextIndex counts snapshots and keeps the earliest date and every month', () => {
  const first = nextIndex(null, { months: ['2026-09'], updatedAt: '2026-09-12T06:17:00+03:00', first: '2026-09-12', snapshot: true });
  assert.deepEqual(first, { updatedAt: '2026-09-12T06:17:00+03:00', first: '2026-09-12', months: ['2026-09'], snapshots: 1, snapshotsSince: '2026-09-12' });
  const backfilled = nextIndex(first, { months: ['2025-04', '2026-09'], updatedAt: 'x', first: '2025-04-02', snapshot: false });
  assert.deepEqual([backfilled.first, backfilled.months, backfilled.snapshots, backfilled.snapshotsSince], ['2025-04-02', ['2025-04', '2026-09'], 1, '2026-09-12']);
  assert.equal(nextIndex(null, { months: [], updatedAt: 'x', first: null, snapshot: false }).snapshotsSince, null);
});
