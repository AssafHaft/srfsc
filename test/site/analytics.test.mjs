import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate, analyse, bookedAt, curveAt, heatmap, levelKey, levelTable, operations, pace, priceOf,
  selectRows, slotRanking, trend, upcoming, weekSplit,
} from '../../site/lib/analytics.mjs';
import { periodRange } from '../../site/lib/history.mjs';
import { addDays } from '../../site/lib/time.mjs';

const PRICES = { reef: 360, reefHigh: 390, bayAdult: 250, bayKids: 195 };
const ALL = new Set();
// A plausible history row on Sunday 6.9.2026; override fields per test.
const row = (over = {}) => ({
  id: 1, date: '2026-09-06', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 10, booked: 5, final: true, pace: [], ...over,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('prices and level keys by area, level and age group', () => {
  assert.equal(priceOf(row(), PRICES), 360);
  assert.equal(priceOf(row({ level: 5 }), PRICES), 390);
  assert.equal(priceOf(row({ area: 'bay', level: 0 }), PRICES), 250);
  assert.equal(priceOf(row({ area: 'bay', level: 0, kids: true }), PRICES), 195);
  assert.deepEqual([levelKey(row()), levelKey(row({ area: 'bay', kids: true })), levelKey(row({ area: 'bay' }))], ['L3', 'bay-kids', 'bay-adult']);
});

test('aggregate caps overbooking for occupancy but counts every person for revenue', () => {
  const a = aggregate([row({ booked: 12 }), row({ booked: 5 }), row({ booked: 10 })], PRICES);
  assert.deepEqual(
    [a.sessions, a.capacity, a.spotsSold, a.people, a.revenue, a.emptyValue],
    [3, 30, 25, 27, 27 * 360, 5 * 360],
  );
  close(a.occupancy, 25 / 30);
  close(a.soldOutShare, 2 / 3);
  assert.deepEqual([aggregate([], PRICES).occupancy, aggregate([], PRICES).soldOutShare], [null, null]);
});

test('selectRows keeps counted sessions in the range that pass the level filter', () => {
  const rows = [
    row({ id: 1 }), row({ id: 2, kind: 'blocked' }), row({ id: 3, kind: 'lesson', area: 'bay', level: 0 }),
    row({ id: 4, date: '2026-09-20' }), row({ id: 5, kind: 'cancelled' }), row({ id: 6, kind: 'removed' }),
  ];
  const range = { from: '2026-09-01', to: '2026-09-10' };
  assert.deepEqual(selectRows(rows, range, ALL).map(r => r.id), [1, 3]);
  assert.deepEqual(selectRows(rows, range, new Set([0])).map(r => r.id), [3]);
});

test('heatmap needs 4 sessions in a cell', () => {
  const sundays = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map(date => row({ date }));
  const mondays = ['2026-08-17', '2026-08-24', '2026-08-31'].map(date => row({ date }));
  const [h] = heatmap([...sundays, ...mondays], PRICES);
  assert.equal(h.hour, '08');
  assert.equal(h.cells[0].sessions, 4);
  assert.equal(h.cells[1], null);
});

test('weekSplit puts Friday and Saturday in the weekend', () => {
  const s = weekSplit([row({ date: '2026-09-11' }), row({ date: '2026-09-12' }), row({ date: '2026-09-10' })], PRICES);
  assert.deepEqual([s.weekend.sessions, s.weekday.sessions], [2, 1]);
});

test('levelTable: shares of the whole, in level order, with the comparison when it ran', () => {
  const cur = [row({ level: 4, booked: 10 }), row({ level: 4, booked: 10 }), row({ area: 'bay', level: 0, kind: 'lesson', booked: 5 })];
  const cmp = [row({ level: 4, booked: 5 })];
  const t = levelTable(cur, cmp, PRICES);
  assert.deepEqual(t.map(l => l.key), ['bay-adult', 'L4']);
  const [bay, l4] = t;
  close(l4.capacityShare, 2 / 3);
  close(l4.bookingShare, 20 / 25);
  assert.equal(l4.cmp.sessions, 1);
  assert.equal(bay.cmp, null);
  assert.equal(levelTable(cur, null, PRICES)[1].cmp, null);
});

test('slotRanking needs 4 dates per slot and never lists a slot twice', () => {
  const dates = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'];
  const rows = [
    ...dates.map(date => row({ date, start: '08:00', booked: 9 })),
    ...dates.map(date => row({ date, start: '10:00', booked: 2 })),
    ...dates.slice(0, 3).map(date => row({ date, start: '12:00', booked: 10 })),
  ];
  const { count, top, bottom } = slotRanking(rows, PRICES, 1);
  assert.equal(count, 2);
  assert.deepEqual(top.map(s => [s.weekday, s.start, s.level, s.dates]), [[0, '08:00', 'L3', 4]]);
  assert.deepEqual(bottom.map(s => s.start), ['10:00']);
  assert.deepEqual(slotRanking(rows, PRICES).bottom, []); // 2 slots, 10 a side: all in "top"
});

test('trend: weekly up to 92 days, compared with the matching weeks; closed days counted', () => {
  const range = periodRange('30d', '2026-09-11', '2025-04-02'); // 12.8–10.9.2026 against 13.8–11.9.2025
  const cur = [row({ date: '2026-08-12', booked: 10 })];
  const cmp = [row({ date: '2025-08-13', booked: 5 })];
  const t = trend(cur, cmp, range, [{ date: '2026-08-14', text: 'סגור' }], PRICES);
  assert.equal(t.unit, 'week');
  assert.deepEqual(t.buckets.map(b => [b.from, b.to]), [
    ['2026-08-12', '2026-08-18'], ['2026-08-19', '2026-08-25'], ['2026-08-26', '2026-09-01'], ['2026-09-02', '2026-09-08'], ['2026-09-09', '2026-09-10'],
  ]);
  assert.deepEqual([t.buckets[0].occupancy, t.buckets[0].cmpOccupancy, t.buckets[0].closedDays], [1, 0.5, 1]);
  assert.deepEqual([t.buckets[1].occupancy, t.buckets[1].cmpOccupancy, t.buckets[1].cmpRevenue], [null, null, null]);
});

test('trend: monthly above 92 days, first and last months clipped to the range', () => {
  const t = trend([], [], { from: '2025-09-11', to: '2026-09-10', compare: null }, [], PRICES);
  assert.equal(t.unit, 'month');
  assert.equal(t.buckets.length, 13);
  assert.deepEqual([t.buckets[0].from, t.buckets[0].to, t.buckets[4].to], ['2025-09-11', '2025-09-30', '2026-01-31']);
  assert.deepEqual([t.buckets.at(-1).from, t.buckets.at(-1).to], ['2026-09-01', '2026-09-10']);
});

test('trend: monthly comparison is the same calendar month a year earlier, across 29 February', () => {
  const range = { from: '2025-01-01', to: '2025-12-31', compare: { kind: 'previous', from: '2024-01-01', to: '2024-12-31' } };
  const cmp = [row({ date: '2024-01-31', booked: 10 }), row({ date: '2024-02-29', booked: 5 })];
  const t = trend([], cmp, range, [], PRICES);
  assert.deepEqual([t.buckets[0].cmpOccupancy, t.buckets[1].cmpOccupancy], [1, 0.5]);
  const lastYear = trend([], [row({ date: '2026-03-01', booked: 10 })], { from: '2026-09-11', to: '2027-09-10', compare: { kind: 'lastYear', from: '2025-09-12', to: '2026-09-11' } }, [], PRICES);
  assert.equal(lastYear.buckets.find(b => b.from === '2027-03-01').cmpOccupancy, 1);
});

test('bookedAt reads the pace log as of a lead time; curveAt interpolates between lead points', () => {
  const log = [[20000, 1], [10000, 3], [1500, 6], [30, 8]];
  assert.equal(bookedAt(log, 7 * 1440), 1);
  assert.equal(bookedAt(log, 1440), 6);
  assert.equal(bookedAt(log, 0), 8);
  assert.equal(bookedAt(log, 30000), null);
  const curve = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]; // at 14, 10, 7, 5, 3, 2, 1, 0 days
  close(curveAt(curve, 4), 0.45);
  assert.deepEqual([curveAt(curve, 20), curveAt(curve, 0), curveAt(null, 3)], [0.1, 0.8, null]);
});

test('pace waits for 30 sessions seen a week ahead', () => {
  const rows = Array.from({ length: 29 }, (_, i) => row({ id: i, pace: [[8 * 1440, 1]] }));
  assert.deepEqual(pace([...rows, row({ id: 99, pace: [[600, 2]] }), row({ id: 100 })]), { ready: false, tracked: 30, deep: 29 });
});

test('pace: fill curves, sell-out lead, last-24h share and cancellations', () => {
  const log = [[14 * 1440, 2], [3 * 1440, 6], [600, 10]];
  const rows = Array.from({ length: 30 }, (_, i) => row({ id: i, level: 4, booked: 10, date: addDays('2026-08-02', i), pace: log }));
  const released = row({ id: 50, level: 2, booked: 4, pace: [[9 * 1440, 5], [2 * 1440, 3], [100, 6]] });
  const p = pace([...rows, released]);
  assert.equal(p.ready, true);
  assert.deepEqual(p.curves.L4.map(v => Math.round(v * 1000) / 1000), [0.2, 0.2, 0.2, 0.2, 0.6, 0.6, 0.6, 1]);
  assert.equal(p.curves.L2, undefined); // fewer than 5 sessions
  close(p.sellOutLeadDays.L4, 600 / 1440);
  close(p.last24Share, (30 * 4 + 1) / (30 * 10 + 4)); // L2: 3 booked a day ahead, 4 at the end
  assert.equal(p.released, 2 + 2); // 5 → 3 in the log, then 6 → 4 at the end
  assert.ok(p.weekday.length === 8 && p.weekend.length === 8);
});

test('upcoming: booked share per day, and sessions at risk in the next 48 hours', () => {
  const s = (over = {}) => ({ id: 1, start: '18:00', end: '19:00', name: 'L4', level: 4, area: 'reef', side: 'right', capacity: 18, booked: 2, spotsLeft: 16, available: true, blocked: false, ...over });
  const schedule = {
    days: [
      { date: '2026-09-11', sessions: [s({ id: 1, start: '08:00', end: '09:00', booked: 0 }), s({ id: 2 }), s({ id: 3, side: 'left', booked: 17 })] },
      { date: '2026-09-12', sessions: [
        s({ id: 4, start: '10:00', end: '11:30', area: 'bay', level: 0, name: 'שיעור ב Bay - בוגרים', capacity: 24, booked: 1 }),
        s({ id: 5, start: '11:00', end: '12:00', blocked: true, booked: 0 }),
      ] },
      { date: '2026-09-14', sessions: [s({ id: 6, start: '10:00', end: '11:00', level: 2, capacity: 20, booked: 0 })] },
    ],
  };
  const u = upcoming(schedule, { now: new Date('2026-09-11T13:00:00Z'), prices: PRICES, levels: ALL }); // 16:00 in Israel
  assert.deepEqual(u.days.map(d => [d.date, d.spotsSold, d.capacity, d.usual]), [
    ['2026-09-11', 19, 36, null], ['2026-09-12', 1, 24, null], ['2026-09-14', 0, 20, null],
  ]);
  assert.deepEqual(u.atRisk, [
    { date: '2026-09-11', start: '18:00', level: 'L4', name: 'L4', booked: 2, capacity: 18, hours: 2, emptyValue: 16 * 360 },
    { date: '2026-09-12', start: '10:00', level: 'bay-adult', name: 'שיעור ב Bay - בוגרים', booked: 1, capacity: 24, hours: 18, emptyValue: 23 * 250 },
  ]);
  assert.deepEqual(upcoming(schedule, { now: new Date('2026-09-11T13:00:00Z'), prices: PRICES, levels: new Set([2]) }).atRisk, []);
});

test('upcoming: the usual fill counts days from now, even when schedule.json still starts yesterday', () => {
  const s = { id: 1, start: '18:00', end: '19:00', name: 'L4', level: 4, area: 'reef', side: 'right', capacity: 10, booked: 5, spotsLeft: 5, available: true, blocked: false };
  const curve = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const schedule = { days: [{ date: '2026-09-10', sessions: [] }, { date: '2026-09-13', sessions: [s] }] };
  const u = upcoming(schedule, { now: new Date('2026-09-11T03:00:00Z'), prices: PRICES, levels: ALL, paceModel: { ready: true, weekday: curve, weekend: curve } });
  close(u.days[0].usual, curveAt(curve, 2)); // 11.9 → 13.9 is 2 days, not 3
});

test('operations: closures, blocked events, cancellations, removals and overbooking in the period', () => {
  const rows = [
    row({ id: 1, kind: 'blocked', name: 'אירוע סגור' }), row({ id: 2, kind: 'blocked', name: 'אירוע סגור' }), row({ id: 3, kind: 'blocked', name: 'Private' }),
    row({ id: 4, kind: 'cancelled', capacity: 0 }), row({ id: 5, kind: 'removed' }), row({ id: 6, booked: 13 }),
    row({ id: 7, kind: 'blocked', date: '2026-10-01' }),
  ];
  const closed = [{ date: '2026-09-07', text: 'תחזוקה' }, { date: '2026-10-02', text: 'חג' }];
  const o = operations(rows, closed, { from: '2026-09-01', to: '2026-09-30' }, ALL);
  assert.deepEqual(o, {
    closed: [{ date: '2026-09-07', text: 'תחזוקה' }],
    blocked: 3, blockedNames: [{ name: 'אירוע סגור', count: 2 }, { name: 'Private', count: 1 }],
    cancelled: 1, removed: 1, events: 0, overbooked: 1, overbookedPeople: 3,
  });
});

test('analyse builds every section and counts the period for the coverage line', () => {
  const rows = ['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map((date, i) => row({ id: i, date }));
  const model = analyse({
    rows, closed: [], range: periodRange('30d', '2026-09-11', '2025-04-02'), levels: ALL, prices: PRICES,
    schedule: { days: [] }, now: new Date('2026-09-11T13:00:00Z'), index: { first: '2025-04-02', snapshots: 12, snapshotsSince: '2026-09-12', updatedAt: '2026-09-12T06:17:00+03:00' },
  });
  assert.deepEqual(Object.keys(model), ['range', 'prices', 'kpis', 'split', 'heat', 'levels', 'slots', 'trend', 'pace', 'upcoming', 'ops', 'coverage']);
  assert.deepEqual([model.kpis.cur.sessions, model.kpis.cur.daysOpen, model.kpis.cmp.sessions], [4, 4, 0]);
  assert.deepEqual(model.coverage, { first: '2025-04-02', sessions: 4, snapshots: 12, snapshotsSince: '2026-09-12', updatedAt: '2026-09-12T06:17:00+03:00' });
});
