import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insights } from '../../site/lib/insights.mjs';

// Plain totals in the shape aggregate() returns.
const totals = (over = {}) => ({
  sessions: 0, capacity: 0, spotsSold: 0, people: 0, revenue: 0, emptyValue: 0, occupancy: null, soldOutShare: null, ...over,
});
/** A model where nothing fires; override parts per test. avgPrice = revenue / people = ₪360. */
const model = (over = {}) => ({
  range: { compare: { kind: 'lastYear' } },
  kpis: { cur: totals({ sessions: 500, capacity: 1000, spotsSold: 600, people: 100, revenue: 36000, occupancy: 0.6 }), cmp: null },
  levels: [],
  split: { weekend: totals(), weekday: totals() },
  heat: [],
  upcoming: { atRisk: [] },
  pace: { ready: false },
  ...over,
});
const level = (key, over = {}) => ({ key, ...totals({ sessions: 100, occupancy: 0.7, soldOutShare: 0.2, revenue: 100000 }), cmp: null, ...over });
const rules = list => list.map(i => i.rule);

test('nothing fires on an unremarkable period', () => {
  assert.deepEqual(insights(model()), []);
});

test('trend fires at 3 points and explains it when supply and demand moved apart', () => {
  const [i] = insights(model({
    kpis: {
      cur: totals({ sessions: 3199, capacity: 51925, spotsSold: 35518, people: 35518, revenue: 12559995, occupancy: 0.684 }),
      cmp: totals({ sessions: 2885, capacity: 46160, spotsSold: 35274, people: 35274, revenue: 12654485, occupancy: 0.764 }),
    },
  }));
  assert.deepEqual([i.rule, i.tone, i.link], ['trend', 'bad', 'trend']);
  assert.equal(i.text, 'התפוסה ירדה ב־8 נקודות מאשתקד, מ־76% ל־68%. ההיצע גדל ב־12% וההזמנות כמעט לא השתנו.');

  const small = cmp => insights(model({ kpis: { cur: model().kpis.cur, cmp } }));
  assert.deepEqual(small(totals({ sessions: 500, capacity: 1000, spotsSold: 620, occupancy: 0.62 })), []); // 2 points
  assert.deepEqual(small(totals({ sessions: 99, capacity: 1000, spotsSold: 800, occupancy: 0.8 })), []); // too few sessions
  const prev = insights(model({ range: { compare: { kind: 'previous' } }, kpis: { cur: model().kpis.cur, cmp: totals({ sessions: 500, capacity: 1000, spotsSold: 500, occupancy: 0.5 }) } }));
  assert.equal(prev[0].text, 'התפוסה עלתה ב־10 נקודות מהתקופה הקודמת, מ־50% ל־60%. ההיצע כמעט לא השתנה וההזמנות גדלו ב־20%.');
});

test('level movers: the two biggest drops of 10+ points in one insight, gains in another', () => {
  const list = insights(model({
    levels: [
      level('L2', { occupancy: 0.59, cmp: totals({ sessions: 100, occupancy: 0.66, revenue: 90000 }) }),
      level('L3', { occupancy: 0.6, cmp: totals({ sessions: 100, occupancy: 0.8, revenue: 150000 }) }),
      level('L4', { occupancy: 0.71, cmp: totals({ sessions: 100, occupancy: 0.88, revenue: 120000 }) }),
      level('bay-adult', { occupancy: 0.61, cmp: totals({ sessions: 100, occupancy: 0.49, revenue: 80000 }) }),
      level('L6', { occupancy: 0.2, sessions: 19, cmp: totals({ sessions: 100, occupancy: 0.9 }) }),
    ],
  }));
  const drop = list.find(i => i.rule === 'level-drop');
  assert.equal(drop.text, 'הירידות הגדולות מאשתקד: L3 מ־80% ל־60%, L4 מ־88% ל־71%.');
  assert.equal(drop.impact, 50000 + 20000);
  assert.equal(list.find(i => i.rule === 'level-gain').text, 'עלייה מאשתקד: Bay מבוגרים מ־49% ל־61%.');
});

test('weekend gap of 10+ points is priced at the weekday capacity', () => {
  const [i] = insights(model({
    split: { weekend: totals({ sessions: 10, occupancy: 0.82 }), weekday: totals({ sessions: 10, capacity: 1000, occupancy: 0.63 }) },
  }));
  assert.equal(i.text, 'שישי־שבת מלאים ב־82%, ימי חול ב־63%. אם ימי החול היו מתמלאים כמו סוף השבוע, זה ₪68,400 נוספים.');
  const narrow = model({ split: { weekend: totals({ sessions: 10, occupancy: 0.72 }), weekday: totals({ sessions: 10, capacity: 1000, occupancy: 0.63 }) } });
  assert.deepEqual(insights(narrow), []);
});

test('undersupply from a 35% sell-out share; weak level below 50%; both need 20 sessions', () => {
  const list = insights(model({
    levels: [
      level('bay-kids', { soldOutShare: 0.35 }),
      level('L5', { soldOutShare: 0.34 }),
      level('L1', { occupancy: 0.49, emptyValue: 40000 }),
      level('L2', { occupancy: 0.5 }),
      level('L3', { occupancy: 0.3, sessions: 19 }),
    ],
  }));
  assert.deepEqual(rules(list), ['weak-level', 'undersupply']);
  assert.equal(list[0].text, 'L1 מתמלא רק ב־49%: ₪40,000 במקומות ריקים בתקופה.');
  assert.equal(list[1].text, 'Bay ילדים נמכר עד המקום האחרון ב־35% מהסשנים: הביקוש גבוה מההיצע, כדאי לשקול עוד סשנים.');
});

test('weak hours: the three Sunday–Thursday cells under 50% with the most empty value', () => {
  const cell = (occupancy, emptyValue, sessions = 12) => totals({ sessions, occupancy, emptyValue });
  const heat = [
    { hour: '09', cells: [cell(0.4, 900), cell(0.34, 1200), null, cell(0.4, 1000), cell(0.45, 100), cell(0.1, 9999), null] },
    { hour: '15', cells: [cell(0.3, 5000, 9), cell(0.6, 5000), null, null, null, null, null] },
  ];
  const [i] = insights(model({ heat }));
  assert.equal(i.text, 'השעות החלשות: ב׳ 09:00 (34%), ד׳ 09:00 (40%), א׳ 09:00 (40%). יחד ₪3,100 במקומות ריקים.');
});

test('at-risk sessions, singular and plural', () => {
  const risk = n => insights(model({ upcoming: { atRisk: Array.from({ length: n }, () => ({ emptyValue: 1000 })) } }))[0].text;
  assert.equal(risk(1), 'סשן אחד ב־48 השעות הקרובות מלא בפחות מ־40%: ₪1,000 פתוחים למכירה.');
  assert.equal(risk(17), '17 סשנים ב־48 השעות הקרובות מלאים בפחות מ־40%: ₪17,000 פתוחים למכירה.');
});

test('fill-speed rules need a ready pace model and come after the priced insights', () => {
  const ready = { ready: true, sellOutLeadDays: { L5: 4.2, L2: 1 }, last24Share: 0.45 };
  const list = insights(model({ pace: ready, upcoming: { atRisk: [{ emptyValue: 10 }] } }));
  assert.deepEqual(rules(list), ['at-risk', 'early-sellout', 'late-demand']);
  assert.equal(list[1].text, 'L5 נמכר עד הסוף בדרך כלל 4 ימים מראש.');
  assert.equal(list[2].text, '45% מההזמנות מגיעות ב־24 השעות האחרונות.');
  assert.deepEqual(insights(model({ pace: { ...ready, ready: false } })), []);
});

test('at most six insights, the largest impact first', () => {
  const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'bay-adult'].map((key, i) => level(key, { occupancy: 0.4, emptyValue: (i + 1) * 1000 }));
  const list = insights(model({ levels }));
  assert.equal(list.length, 6);
  assert.deepEqual(list.map(i => i.impact), [7000, 6000, 5000, 4000, 3000, 2000]);
});
