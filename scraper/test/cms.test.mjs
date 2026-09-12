import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_HEADER, categoryOf, mergeExport, pairExport, parseExport, readXlsx, slotOf } from '../cms.mjs';
import { HIDDEN_CATEGORIES } from '../../site/lib/history.mjs';
import { RELS, WORKBOOK, xlsxOf, zip } from '../test-support/xlsx.mjs';

test('readXlsx reads inline strings from the first sheet, stored or deflated', () => {
  const rows = [EXPORT_HEADER, ['2025-05-01', 'Thursday', '07:00', 'ריף', 'סשן <L6> & co', '', ' שמאל', '15', '15']];
  const read = readXlsx(xlsxOf(rows));
  assert.deepEqual(read, rows);
});

test('readXlsx reads shared strings, plain values, gaps and empty rows', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="C1"><v>18</v></c><c r="D1" s="2"/></row>'
    + '<row r="2"/><row r="3"><c r="B3" t="inlineStr"><is><r><t>א &amp; </t></r><r><t xml:space="preserve">ב</t></r></is></c></row></sheetData></worksheet>';
  const strings = '<sst><si><t>zero</t></si><si><t>ריף</t></si></sst>';
  const buf = zip([
    ['xl/workbook.xml', WORKBOOK, false], ['xl/_rels/workbook.xml.rels', RELS, true],
    ['xl/sharedStrings.xml', strings, true], ['xl/worksheets/sheet1.xml', sheet, false],
  ]);
  assert.deepEqual(readXlsx(buf), [['ריף', '', '18', ''], [], ['', 'א & ב']]);
});

test('readXlsx reads formula-string cells, and values whose tag keeps its spaces (the CMS export shape)', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>2025-05-01</v></c>'
    + '<c r="G1" t="str"><v xml:space="preserve"> שמאל</v></c><c r="H1"><v>15</v></c><c r="I1" t="str"><v>15</v></c></row></sheetData></worksheet>';
  const buf = zip([['xl/workbook.xml', WORKBOOK, false], ['xl/_rels/workbook.xml.rels', RELS, false], ['xl/worksheets/sheet1.xml', sheet, false]]);
  assert.deepEqual(readXlsx(buf), [['2025-05-01', '', '', '', '', '', ' שמאל', '15', '15']]);
});

test('readXlsx rejects a file that is not a zip', () => {
  assert.throws(() => readXlsx(Buffer.from('תאריך,יום\n')), /not an \.xlsx file/);
});

test('parseExport checks the header and turns rows into sessions, skipping bad ones by reason', () => {
  assert.throws(() => parseExport([['תאריך', 'יום', 'שעה']]), /column 4 is "", expected "איזור"/);
  const { rows, skipped } = parseExport([
    EXPORT_HEADER,
    ['2025-05-01', 'Thursday', '07:00', 'ריף', ' סשן  L6 ', 'L6 - Pro Surfers', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '09:00', 'ביי', 'פרטי - לקוחה', '', ' ימין 1', '1', '1'],
    ['', '', '', '', '', '', '', '', ''],
    ['01/05/2025', 'Thursday', '07:00', 'ריף', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '7', 'ריף', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ים', 'x', '', ' שמאל', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ריף', 'x', '', ' מרכז', '15', '15'],
    ['2025-05-01', 'Thursday', '07:00', 'ריף', 'x', '', ' שמאל', '15', '-1'],
  ]);
  assert.deepEqual(rows, [
    { date: '2025-05-01', hour: '07:00', area: 'reef', side: 'left', name: 'סשן L6', level: 6, capacity: 15, booked: 15 },
    { date: '2025-05-01', hour: '09:00', area: 'bay', side: 'right', name: 'פרטי - לקוחה', level: null, capacity: 1, booked: 1 },
  ]);
  assert.deepEqual(skipped, { 'bad date': 1, 'bad hour': 1, 'bad area': 1, 'bad side': 1, 'bad number': 1 });
});

// A history row and an export row in the same slot; override fields per test.
const ours = (over = {}) => ({
  id: 1, date: '2025-07-07', start: '08:00', end: '09:00', level: 4, area: 'reef', side: 'right', kids: false,
  name: 'סשן L4', kind: 'surf', capacity: 18, booked: 10, final: true, pace: [[600, 4]], ...over,
});
const theirs = (over = {}) => ({
  date: '2025-07-07', hour: '08:00', area: 'reef', side: 'right', name: 'סשן L4', level: 4, capacity: 18, booked: 10, ...over,
});

test('categoryOf: first matching rule wins; anything else is a group', () => {
  const cases = [
    ['שמור ל SRF KAMP', 'שימוש פנימי ושריונים'], ['ערב צוות- מדריכים/מצילים', 'שימוש פנימי ושריונים'], ['אירוע SRF', 'שימוש פנימי ושריונים'],
    ['SUMMER CAMP (5 days) גילאי 11-13', 'קייטנות'], ["Summer Surf n' Slice", 'קייטנות'],
    ['קורס מפגש אחד BAY- מעל גיל 16', 'קורסי Bay'], ['חוג ילדים Beginners', 'חוגים'],
    ['אירוע פרטי - משפחה', 'אירועים'], ['בת מצווה - 60 אורחים', 'אירועים'],
    ['פרטי - לקוח לדוגמה', 'שיעורים פרטיים'], ['זוגי - שני גולשים', 'שיעורים פרטיים'], ['הדרכה פרטית', 'שיעורים פרטיים'],
    ['שיעור גלישה קבוצתי - בוגרים מעל גיל 16', 'שיעורי Bay קבוצתיים'],
    ['קבוצת נוער מהשכונה', 'קבוצות וארגונים'], ['חברת הייטק - 20', 'קבוצות וארגונים'],
  ];
  for (const [name, label] of cases) assert.equal(categoryOf(name), label, name);
  assert.deepEqual([...new Set(cases.map(([name]) => categoryOf(name)))].sort(), [...HIDDEN_CATEGORIES].sort());
});

test('pairExport: same slot only; the same name beats the same level, which beats the closest counts', () => {
  const a = ours({ id: 1, name: 'T-Time Mega Turns', level: 5, capacity: 15, booked: 15 });
  const b = ours({ id: 2 });
  const x = theirs({ name: 'סשן L5', level: 5, capacity: 15, booked: 14 }); // pairs with a by level
  const y = theirs({ booked: 9 }); // pairs with b by name
  const z = theirs({ name: 'פרטי - לקוחה', level: null, capacity: 1, booked: 1 }); // nothing left for it
  const lonely = ours({ id: 3, start: '12:00', end: '13:00' });
  const { pairs, unpairedExport, unpairedHistory } = pairExport([a, b, lonely], [z, x, y]);
  assert.deepEqual(pairs.map(([r, e]) => [r.id, e.name]).sort(), [[1, 'סשן L5'], [2, 'סשן L4']]);
  assert.deepEqual(unpairedExport, [z]);
  assert.deepEqual(unpairedHistory, [lonely]);
});

test('pairExport: a 14:30 session pairs with the 15:00 row; Bay rows never pair by level; closest counts break ties', () => {
  assert.deepEqual([slotOf('14:30'), slotOf('09:00'), slotOf('09:15')], ['15:00', '09:00', '10:00']);
  const r = ours({ area: 'bay', level: 0, start: '14:30', end: '16:00', name: 'שיעור גלישה', capacity: 14, booked: 2 });
  const far = theirs({ area: 'bay', hour: '15:00', name: 'קורס', level: 0, capacity: 18, booked: 2 });
  const near = theirs({ area: 'bay', hour: '15:00', name: 'אחר', level: 4, capacity: 14, booked: 3 });
  const early = theirs({ area: 'bay', hour: '14:00', name: 'שיעור גלישה', level: 0, capacity: 14, booked: 2 }); // other slot
  const { pairs, unpairedExport } = pairExport([r], [far, near, early]);
  assert.deepEqual(pairs, [[r, near]]); // distance 1 beats 4
  assert.deepEqual(unpairedExport, [far, early]);
});

test('mergeExport: paired rows take only the export count; the rest become hidden rows named by category', () => {
  const cancelled = ours({ id: 7, kind: 'cancelled', capacity: 0, booked: 0 });
  const paired = ours({ id: 8, start: '10:00', end: '11:00' });
  const lonely = ours({ id: 10, start: '12:00', end: '13:00' });
  const before = ours({ id: 9, date: '2025-06-30' }); // before the export's first date: untouched
  const store = {
    '2025-06': { month: '2025-06', closed: [], sessions: [before] },
    '2025-07': { month: '2025-07', closed: [], sessions: [cancelled, paired, lonely] },
  };
  const exportRows = [
    theirs({ booked: 0 }), // pairs with the cancelled row, which stays cancelled with capacity 0
    theirs({ hour: '10:00', booked: 7 }),
    theirs({ date: '2025-07-08', hour: '23:00', area: 'bay', side: 'left', name: 'SUMMER CAMP גילאי 7-10', level: 4, capacity: 12, booked: 9 }),
    theirs({ date: '2025-08-01', hour: '09:00', area: 'bay', name: 'פרטי - לקוח לדוגמה', level: null, capacity: 1, booked: 1 }),
  ];
  const { summary, from, to } = mergeExport(store, exportRows);

  assert.deepEqual([from, to], ['2025-07-07', '2025-08-01']);
  assert.deepEqual(cancelled, ours({ id: 7, kind: 'cancelled', capacity: 0, booked: 0 }));
  assert.deepEqual(paired, ours({ id: 8, start: '10:00', end: '11:00', booked: 7 })); // pace, capacity, kind kept
  assert.deepEqual(before, ours({ id: 9, date: '2025-06-30' }));
  assert.deepEqual(store['2025-07'].sessions.at(-1), {
    id: -1, date: '2025-07-08', start: '23:00', end: '23:59', level: 0, area: 'bay', side: 'left', kids: true,
    name: 'קייטנות', kind: 'hidden', capacity: 12, booked: 9, final: true, pace: [],
  });
  assert.deepEqual(store['2025-08'].sessions, [{
    id: -2, date: '2025-08-01', start: '09:00', end: '10:00', level: 0, area: 'bay', side: 'right', kids: false,
    name: 'שיעורים פרטיים', kind: 'hidden', capacity: 1, booked: 1, final: true, pace: [],
  }]);
  assert.deepEqual(summary, {
    pairs: 2, changed: 1, netPeople: -3, notInExport: 1, hidden: 2, hiddenPeople: 10,
    categories: { 'קייטנות': { rows: 1, people: 9 }, 'שיעורים פרטיים': { rows: 1, people: 1 } },
  });
  const text = JSON.stringify(store);
  assert.ok(!text.includes('לדוגמה') && !text.includes('SUMMER'), 'no original name of a hidden row is stored');
  const hidden = Object.values(store).flatMap(m => m.sessions).filter(r => r.kind === 'hidden');
  assert.ok(hidden.every(r => HIDDEN_CATEGORIES.includes(r.name)));
});
