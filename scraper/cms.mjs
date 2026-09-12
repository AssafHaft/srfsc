// The one-time import of the park's CMS "wave demand" export (CMS import spec section 4).
// Pure functions: .xlsx bytes → rows → merged history. The CLI is scraper/import-cms.mjs.
import { inflateRawSync } from 'node:zlib';
import { HIDDEN_CATEGORIES, isKids } from '../site/lib/history.mjs';
import { monthOf } from './history.mjs';

// ---------- .xlsx reading (no dependencies) ----------

/** Zip entries by name → contents, read through the central directory. */
function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not an .xlsx file (no zip directory)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('not an .xlsx file (broken zip directory)');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const skip = nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression ${method} in ${name}`);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + skip;
  }
  return entries;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => (e[0] !== '#'
  ? ENTITIES[e] ?? all
  : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], unescapeXml(m[2])]));
/** All <t> text inside an element, joined (rich text runs included). */
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
/** "C12" → 2. */
const column = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first sheet of an .xlsx file as rows of cell strings; missing cells are ''. */
export function readXlsx(buffer) {
  const entries = unzip(buffer);
  const text = name => entries.get(name)?.toString('utf8') ?? null;
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('not an .xlsx file (no workbook)');
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook);
  if (!firstSheet) throw new Error('the workbook has no sheets');
  const id = attrs(firstSheet[0])['r:id'];
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).find(r => r.Id === id)?.Target;
  const sheet = target && text(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!sheet) throw new Error('the first sheet is missing');
  const strings = text('xl/sharedStrings.xml');
  const shared = strings ? [...strings.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];

  const rows = [];
  for (const [, body = ''] of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    for (const [, a, inner = ''] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { r, t } = attrs(a);
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value = t === 'inlineStr' ? texts(inner) : t === 's' ? shared[Number(v)] ?? '' : v === undefined ? '' : unescapeXml(v);
      cells[r ? column(r) : cells.length] = value;
    }
    rows.push(Array.from(cells, c => c ?? ''));
  }
  return rows;
}

// ---------- parsing ----------

export const EXPORT_HEADER = ['תאריך', 'יום', 'שעה', 'איזור', 'שם', 'סוג', 'צד', "מס' משתתפים מקסימלי", "מס' נרשמים"];
const AREAS = { 'ריף': 'reef', 'ביי': 'bay' };
const COUNT = /^\d+$/;
const collapse = s => String(s).replace(/\s+/g, ' ').trim();

/** Sheet rows → { rows, skipped: { reason: count } }. Throws unless the header is the CMS export's. */
export function parseExport(sheet) {
  const header = (sheet[0] ?? []).map(c => String(c).trim());
  EXPORT_HEADER.forEach((name, i) => {
    if (header[i] !== name) throw new Error(`column ${i + 1} is "${header[i] ?? ''}", expected "${name}"`);
  });
  const rows = [];
  const skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const cells of sheet.slice(1)) {
    const [date, , hour, area, name, type, side, capacity, booked] = EXPORT_HEADER.map((_, i) => String(cells[i] ?? '').trim());
    if (!cells.some(c => String(c).trim())) continue; // a blank line
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) skip('bad date');
    else if (!/^\d{2}:\d{2}$/.test(hour)) skip('bad hour');
    else if (!AREAS[area]) skip('bad area');
    else if (!/ימין|שמאל/.test(side)) skip('bad side');
    else if (!COUNT.test(capacity) || !COUNT.test(booked)) skip('bad number');
    else {
      const level = /L(\d)/.exec(type);
      rows.push({
        date, hour, area: AREAS[area], side: side.includes('ימין') ? 'right' : 'left', name: collapse(name),
        level: level ? Number(level[1]) : null, capacity: Number(capacity), booked: Number(booked),
      });
    }
  }
  return { rows, skipped };
}

// ---------- categories ----------

// First match wins (CMS import spec section 3); anything else is a group or organisation.
const CATEGORY_RULES = [
  [/צוות|מדריכ|מציל|שותפים|תחזוק|SRF(?! ?KAMP)|בדיק|צילומ|שמור|שמירת|שריון|חסום|סגור/i, 'שימוש פנימי ושריונים'],
  [/קייטנ|CAMP|KAMP|Surf n.? ?Slice/i, 'קייטנות'],
  [/קורס/, 'קורסי Bay'],
  [/חוג/, 'חוגים'],
  [/אירוע|יום הולדת|מצו|גיבוש|כנס|השקה|event/i, 'אירועים'],
  [/פרטי|פרטית|הדרכה|זוגי/, 'שיעורים פרטיים'],
  [/שיעור גלישה|מפגש היכרות|לימוד גלישה/, 'שיעורי Bay קבוצתיים'],
];
const GROUP = HIDDEN_CATEGORIES[0];

/** The category label a hidden booking is stored under; its original name is never stored. */
export const categoryOf = name => CATEGORY_RULES.find(([rule]) => rule.test(name))?.[1] ?? GROUP;

// ---------- pairing and merging ----------

const nextHour = hhmm => `${String(Number(hhmm.slice(0, 2)) + 1).padStart(2, '0')}:00`;

/** A history start as the export's whole hour: "14:30" → "15:00", "14:00" → "14:00". */
export const slotOf = start => (start.endsWith(':00') ? start : nextHour(start));

/**
 * Pairs export rows with history rows of the same date, area, side and slot. Inside a slot the
 * same name pairs first, then the same reef level, then the closest capacity and booked count.
 */
export function pairExport(historyRows, exportRows) {
  const buckets = new Map();
  const bucket = key => {
    if (!buckets.has(key)) buckets.set(key, { ours: [], theirs: [] });
    return buckets.get(key);
  };
  for (const r of historyRows) bucket(`${r.date}|${r.area}|${r.side}|${slotOf(r.start)}`).ours.push(r);
  for (const e of exportRows) bucket(`${e.date}|${e.area}|${e.side}|${e.hour}`).theirs.push(e);

  const pairs = [];
  for (const { ours, theirs } of buckets.values()) {
    const candidates = [];
    ours.forEach((r, a) => theirs.forEach((e, b) => {
      const score = collapse(e.name) === collapse(r.name) ? 0 : r.area === 'reef' && e.level === r.level ? 1 : 2;
      candidates.push({ score, distance: Math.abs(e.capacity - r.capacity) + Math.abs(e.booked - r.booked), a, b });
    }));
    candidates.sort((x, y) => x.score - y.score || x.distance - y.distance || x.a - y.a || x.b - y.b);
    const usedOurs = new Set();
    const usedTheirs = new Set();
    for (const { a, b } of candidates) {
      if (usedOurs.has(a) || usedTheirs.has(b)) continue;
      usedOurs.add(a);
      usedTheirs.add(b);
      pairs.push([ours[a], theirs[b]]);
    }
  }
  const pairedOurs = new Set(pairs.map(([r]) => r));
  const pairedTheirs = new Set(pairs.map(([, e]) => e));
  return {
    pairs,
    unpairedExport: exportRows.filter(e => !pairedTheirs.has(e)),
    unpairedHistory: historyRows.filter(r => !pairedOurs.has(r)),
  };
}

/**
 * The one-time merge (CMS import spec section 4.5), mutating `store`. History rows dated inside the
 * export pair with its rows. Paired rows take the export's booked count and keep everything else.
 * Unpaired export rows become kind "hidden" rows named by category, with ids -1, -2, …
 */
export function mergeExport(store, exportRows) {
  const dates = exportRows.map(e => e.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  const history = Object.values(store).flatMap(m => m.sessions).filter(r => r.date >= from && r.date <= to);
  const { pairs, unpairedExport, unpairedHistory } = pairExport(history, exportRows);

  let changed = 0;
  let netPeople = 0;
  for (const [r, e] of pairs) {
    if (r.booked === e.booked) continue;
    changed += 1;
    netPeople += e.booked - r.booked;
    r.booked = e.booked;
  }

  const categories = {};
  unpairedExport.forEach((e, i) => {
    const name = categoryOf(e.name);
    const month = monthOf(e.date);
    store[month] ??= { month, closed: [], sessions: [] };
    store[month].sessions.push({
      id: -(i + 1), date: e.date, start: e.hour, end: e.hour === '23:00' ? '23:59' : nextHour(e.hour),
      level: 0, area: e.area, side: e.side, kids: isKids(e.name), name, kind: 'hidden',
      capacity: e.capacity, booked: e.booked, final: true, pace: [],
    });
    categories[name] ??= { rows: 0, people: 0 };
    categories[name].rows += 1;
    categories[name].people += e.booked;
  });

  const hiddenPeople = unpairedExport.reduce((n, e) => n + e.booked, 0);
  return {
    store, from, to,
    summary: { pairs: pairs.length, changed, netPeople, notInExport: unpairedHistory.length, hidden: unpairedExport.length, hiddenPeople, categories },
  };
}
