import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupBlocks, layoutBlocks, reefSides, weekDates, hourRange, monthDates, monthTitle,
  isPast, isNow, daySummary, dayRows, displayName,
} from '../../site/lib/schedule.mjs';

let nextId = 1;
const s = (start, end, over = {}) => ({
  id: nextId++, start, end, name: 'L3 - Intermediate (M3)', level: 3, area: 'reef', side: 'right',
  capacity: 18, booked: 5, spotsLeft: 13, available: true, ...over,
});
const bay = (start, end, over = {}) => s(start, end, { area: 'bay', level: 0, name: 'שיעור גלישה למתחילים ב Bay - ילדים 7-10', ...over });
const pos = blocks => blocks.map(b => [b.start, b.area, Math.round(b.x0), Math.round(b.x1)]);

test('groupBlocks joins sessions with the same start, end and area', () => {
  const blocks = groupBlocks([
    s('17:00', '18:00'), s('17:00', '18:00', { side: 'left' }),
    bay('17:30', '19:00'), bay('17:30', '19:00', { side: 'left' }),
    s('16:00', '17:00'),
  ]);
  assert.deepEqual(blocks.map(b => [b.start, b.area, b.sessions.length]), [
    ['16:00', 'reef', 1], ['17:00', 'reef', 2], ['17:30', 'bay', 2],
  ]);
});

test('layoutBlocks: blocks that overlap nothing use the full width; touching is not overlapping', () => {
  const blocks = groupBlocks([s('06:00', '07:00'), s('07:00', '08:00')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [['06:00', 'reef', 0, 100], ['07:00', 'reef', 0, 100]]);
});

test('layoutBlocks: reef and Bay overlapping split 64/36 for the whole cluster', () => {
  const blocks = groupBlocks([s('16:00', '17:00'), s('17:00', '18:00'), bay('17:30', '19:00'), s('18:00', '19:00'), s('19:00', '20:00')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [
    ['16:00', 'reef', 0, 100],
    ['17:00', 'reef', 0, 64],
    ['17:30', 'bay', 64, 100],
    ['18:00', 'reef', 0, 64],
    ['19:00', 'reef', 0, 100],
  ]);
});

test('layoutBlocks: same-area blocks that overlap at different times share the lane', () => {
  const blocks = groupBlocks([bay('10:00', '11:30'), bay('11:00', '12:30')]);
  assert.deepEqual(pos(layoutBlocks(blocks)), [['10:00', 'bay', 0, 50], ['11:00', 'bay', 50, 100]]);
});

test('reefSides: one shared session, or different sessions per side', () => {
  const same = groupBlocks([s('06:00', '07:00'), s('06:00', '07:00', { side: 'left' })])[0];
  assert.equal(reefSides(same).shared, true);
  const split = groupBlocks([
    s('20:00', '21:00', { name: 'ריטריט נשים נטלי', level: 2 }),
    s('20:00', '21:00', { side: 'left', name: 'L2 Improvers (M2) - כולל גלשן סופט ללא עלות', level: 2 }),
  ])[0];
  const sides = reefSides(split);
  assert.equal(sides.shared, false);
  assert.equal(sides.right.name, 'ריטריט נשים נטלי');
  const rightOnly = groupBlocks([s('06:00', '07:00')])[0];
  assert.deepEqual([reefSides(rightOnly).shared, reefSides(rightOnly).left], [true, null]);
});

test('dayRows: one row per shared reef pair, two for split sides, one per Bay lesson', () => {
  const rows = dayRows([
    s('06:00', '07:00'), s('06:00', '07:00', { side: 'left' }),
    s('20:00', '21:00', { name: 'ריטריט נשים נטלי' }), s('20:00', '21:00', { side: 'left' }),
    bay('15:30', '17:00'), bay('15:30', '17:00', { side: 'left', name: 'שיעור גלישה למתחילים ב Bay - ילדים 11-16' }),
  ]);
  assert.deepEqual(rows.map(r => [r.start, r.area, r.right ? 'R' : '-', r.left ? 'L' : '-']), [
    ['06:00', 'reef', 'R', 'L'],
    ['15:30', 'bay', '-', '-'],
    ['15:30', 'bay', '-', '-'],
    ['20:00', 'reef', 'R', '-'],
    ['20:00', 'reef', '-', 'L'],
  ]);
  assert.equal(rows[2].main.name, 'שיעור גלישה למתחילים ב Bay - ילדים 11-16');
});

test('weekDates and hourRange', () => {
  assert.deepEqual(weekDates('2026-09-10'), ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  assert.deepEqual(hourRange([{ sessions: [s('08:00', '09:00'), bay('17:30', '19:00')] }, undefined, { sessions: [s('06:00', '07:00'), s('22:00', '23:00')] }]), { from: 6, to: 23 });
  assert.deepEqual(hourRange([undefined, { sessions: [] }]), { from: 6, to: 22 });
});

test('monthDates starts on this week\'s Sunday and adds one week past the last published day', () => {
  const dates = monthDates('2026-09-10', '2026-09-24');
  assert.equal(dates.length, 28);
  assert.equal(dates[0], '2026-09-06');
  assert.equal(dates.at(-1), '2026-10-03');
  assert.equal(monthDates('2026-09-10', null).length, 14);
});

test('monthTitle names one or two months', () => {
  assert.equal(monthTitle(['2026-09-06', '2026-10-03']), 'ספטמבר–אוקטובר 2026');
  assert.equal(monthTitle(['2026-09-06', '2026-09-26']), 'ספטמבר 2026');
});

test('isPast and isNow only apply to today', () => {
  const x = s('16:00', '17:00');
  assert.equal(isNow(x, '2026-09-10', '2026-09-10', '16:20'), true);
  assert.equal(isPast(x, '2026-09-10', '2026-09-10', '16:20'), false);
  assert.equal(isPast(x, '2026-09-10', '2026-09-10', '17:00'), true);
  assert.equal(isNow(x, '2026-09-10', '2026-09-10', '17:00'), false);
  assert.equal(isPast(x, '2026-09-11', '2026-09-10', '23:00'), false);
});

test('daySummary counts free spots and lists reef levels in time order', () => {
  const day = { sessions: [s('06:00', '07:00', { level: 6, spotsLeft: 8 }), s('06:00', '07:00', { level: 6, side: 'left', spotsLeft: 6 }), bay('08:30', '10:00', { spotsLeft: 3 }), s('07:00', '08:00', { level: 5, spotsLeft: 0 })] };
  assert.deepEqual(daySummary(day), { freeSpots: 17, levels: [6, 5] });
  assert.deepEqual(daySummary(undefined), { freeSpots: 0, levels: [] });
});

test('displayName tidies the park\'s names', () => {
  assert.deepEqual(displayName('L6 Pro (T2+B2)'), { title: 'Pro (T2+B2)', note: '' });
  assert.deepEqual(displayName('L5 - Expert  (T2 Only)'), { title: 'Expert (T2 Only)', note: '' });
  assert.deepEqual(displayName('L4 – Advanced (T1 Only)'), { title: 'Advanced (T1 Only)', note: '' });
  assert.deepEqual(displayName('L2 Improvers (M2) - כולל גלשן סופט ללא עלות'), { title: 'Improvers (M2)', note: 'כולל גלשן סופט' });
  assert.deepEqual(displayName('שיעור גלישה למתחילים ב Bay - ילדים 7-10'), { title: 'שיעור מתחילים ב־Bay', note: 'ילדים 7-10' });
  assert.deepEqual(displayName('ריטריט נשים נטלי'), { title: 'ריטריט נשים נטלי', note: '' });
});
