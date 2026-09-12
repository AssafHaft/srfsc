import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../../site/lib/analytics.mjs';
import { periodRange } from '../../site/lib/history.mjs';
import { insights } from '../../site/lib/insights.mjs';
import { compareNote, money, renderAnalysis, renderPeriods } from '../../site/lib/render-analysis.mjs';
import { addDays } from '../../site/lib/time.mjs';

const PRICES = { reef: 360, reefHigh: 390, bayAdult: 250, bayKids: 195 };
const UI = { heatMetric: 'occupancy', trendMetric: 'occupancy' };
const count = (html, needle) => html.split(needle).length - 1;
const row = (over = {}) => ({
  id: 1, date: '2026-09-06', start: '08:00', end: '09:00', level: 3, area: 'reef', side: 'right', kids: false,
  name: 'L3', kind: 'surf', capacity: 10, booked: 3, final: true, pace: [], ...over,
});

/** 12 weeks of a weak Sunday 08:00 L3 and a full Friday 17:00 L5, plus a blocked private event. */
function history() {
  const rows = [];
  for (let w = 0; w < 12; w++) {
    const sunday = addDays('2026-06-14', w * 7);
    rows.push(row({ id: rows.length + 1, date: sunday }));
    rows.push(row({ id: rows.length + 1, date: addDays(sunday, 5), start: '17:00', end: '18:00', level: 5, capacity: 15, booked: 15 }));
  }
  rows.push(row({ id: 99, kind: 'blocked', name: '<b>אירוע</b>' }));
  return rows;
}

/** 10 nearly empty sessions in the next 48 hours, each its own at-risk slot. */
function schedule() {
  const s = (date, hour, id) => ({
    id, start: `${hour}:00`, end: `${hour}:59`, name: 'L4 <x>', level: 4, area: 'reef', side: 'right',
    capacity: 18, booked: 1, spotsLeft: 17, available: true, blocked: false,
  });
  return {
    days: [
      { date: '2026-09-11', sessions: ['17', '18', '19', '20', '21'].map((h, i) => s('2026-09-11', h, 900 + i)) },
      { date: '2026-09-12', sessions: ['08', '09', '10', '11', '12'].map((h, i) => s('2026-09-12', h, 910 + i)) },
    ],
  };
}

const model = () => analyse({
  rows: history(), closed: [{ date: '2026-07-01', text: 'תחזוקה' }], range: periodRange('90d', '2026-09-11', '2025-04-02'),
  levels: new Set(), prices: PRICES, schedule: schedule(), now: new Date('2026-09-11T13:00:00Z'),
  index: { first: '2025-04-02', snapshots: 3, snapshotsSince: '2026-09-10', updatedAt: '2026-09-10T20:00:00+03:00' },
});

test('money: millions, thousands, and small amounts', () => {
  assert.equal(money(12559995), '<span class="ltr num">₪12.6M</span>');
  assert.equal(money(317710), '<span class="ltr num">₪318K</span>');
  assert.equal(money(8500), '<span class="ltr num">₪8,500</span>');
});

test('period buttons and the comparison line', () => {
  const buttons = renderPeriods('90d');
  assert.equal(count(buttons, 'data-period="'), 4);
  assert.ok(buttons.includes('<button data-period="90d" aria-pressed="true">90 יום</button>'));
  const note = compareNote(periodRange('90d', '2026-09-11', '2025-04-02'));
  assert.ok(note.includes('<span class="ltr num">13.6.2026–10.9.2026</span>'));
  assert.ok(note.includes('אותם שבועות אשתקד') && note.includes('14.6.2025–11.9.2025'));
  assert.ok(compareNote(periodRange('all', '2026-09-11', '2025-04-02')).includes('אין להיסטוריה תקופה קודמת'));
});

test('renderAnalysis: nine sections in order, the numbers, and escaped park text', () => {
  const m = model();
  const html = renderAnalysis(m, insights(m), UI);
  const ids = [...html.matchAll(/<section class="sec" id="a-([a-z]+)"/g)].map(x => x[1]);
  assert.deepEqual(ids, ['kpis', 'insights', 'heat', 'levels', 'slots', 'trend', 'pace', 'upcoming', 'ops']);
  assert.ok(html.includes('<span class="v num">72%</span>')); // (12×3 + 12×15) of (12×10 + 12×15)
  assert.ok(html.includes('אין נתון להשוואה')); // no sessions a year earlier
  assert.ok(html.includes('class="c s5 num"')); // Friday 17:00 is full
  assert.ok(html.includes('מלא ב־100%'));
  assert.ok(html.includes('שישי־שבת מלאים ב־100%') && html.includes('data-jump="heat"'));
  assert.ok(html.includes('&lt;b&gt;אירוע&lt;/b&gt; ×1') && !html.includes('<b>אירוע'));
  assert.ok(html.includes('L4 &lt;x&gt;') && !html.includes('L4 <x>'));
  assert.ok(html.includes('1.7 תחזוקה'));
  assert.ok(html.includes('(ריף L1–L4 360 ₪, L5–L6 390 ₪, Bay מבוגרים 250 ₪, Bay ילדים 195 ₪)'));
  assert.match(html, /ההיסטוריה עודכנה לפני /);
});

test('renderAnalysis: collecting card before pace is ready, and the at-risk overflow in a details box', () => {
  const html = renderAnalysis(model(), [], UI);
  assert.ok(html.includes('אוספים נתונים') && html.includes('3 צילומי מצב') && html.includes('בערך ב־24.9'));
  assert.equal(count(html, '<div class="rrow">'), 10);
  assert.ok(html.includes('<details class="more"><summary>ועוד 3 סשנים</summary>'));
  assert.ok(html.includes('אין מסקנות בולטות'));
  assert.ok(html.includes('בעוד שעה') && !html.includes('בעוד 1 שעות'));
});

test('renderAnalysis: the heat and trend switches change what is drawn', () => {
  const html = renderAnalysis(model(), [], { heatMetric: 'revenue', trendMetric: 'revenue' });
  assert.ok(html.includes('data-heat-metric="revenue" aria-pressed="true"'));
  assert.ok(html.includes('data-trend-metric="revenue" aria-pressed="true"'));
  assert.match(html, /class="c s\d num" title="[^"]*">\d+K<\/div>/);
  assert.ok(html.includes('aria-label="הכנסה לפי שבוע"'));
});
