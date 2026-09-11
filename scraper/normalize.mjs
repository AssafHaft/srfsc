// Raw park API windows → the schedule model in site/data/schedule.json (spec sections 2–3).
// Side and spots rules mirror the park's own computeBox() so our numbers match its site.
import { addDays } from '../site/lib/time.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{2}):(\d{2})(?::\d{2})?$/;
const AREA_ORDER = { reef: 0, bay: 1 };
const SIDE_ORDER = { right: 0, left: 1 };

/** "right" | "left" | null. Bay rows may name pools 1–6; 1–3 are right, 4–6 left (right wins). */
export function sideOf(row) {
  const raw = String(row.area_number ?? '').trim();
  let side = raw === 'left' ? 'left' : raw === 'right' ? 'right' : null;
  if (row.area === 'bay') {
    const pools = raw.split(',').map(p => p.trim());
    if (pools.some(p => ['4', '5', '6'].includes(p))) side = 'left';
    if (pools.some(p => ['1', '2', '3'].includes(p))) side = 'right';
  }
  return side;
}

const isDisabled = v => v === true || v === 1 || v === '1' || v === 'true';
const count = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const hhmm = t => {
  const m = TIME.exec(String(t));
  return m ? `${m[1]}:${m[2]}` : null;
};

/** One raw scheduler row → { date, session } or { skip: reason }. */
export function normalizeRow(row) {
  const side = sideOf(row);
  if (!side) return { skip: `unknown side "${row.area_number}"` };
  if (!DATE.test(String(row.date))) return { skip: `bad date "${row.date}"` };
  const start = hhmm(row.startTime);
  const end = hhmm(row.endTime);
  if (!start || !end || end <= start) return { skip: `bad times "${row.startTime}"-"${row.endTime}"` };
  const capacity = count(row[`${side}_max_users`]);
  const booked = count(row[`${side}_count_users`]);
  if (capacity === null || booked === null) return { skip: 'bad capacity or booked count' };
  const area = row.area === 'bay' ? 'bay' : 'reef';
  const level = area === 'bay' ? 0 : count(row.wave_level);
  if (area === 'reef' && !level) return { skip: `bad wave level "${row.wave_level}"` };
  const spotsLeft = isDisabled(row.disabled) ? 0 : Math.max(0, capacity - booked);
  return {
    date: row.date,
    session: {
      id: row.scheduler_id,
      start,
      end,
      name: String(row.name ?? '').trim(),
      level,
      area,
      side,
      capacity,
      booked,
      spotsLeft,
      available: spotsLeft > 0,
    },
  };
}

const compareSessions = (a, b) =>
  a.start.localeCompare(b.start) ||
  AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
  SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
  a.id - b.id;

/** Raw windows → { schedule, warnings }. Days run from `today` through the last published date. */
export function normalize(windows, { today, fetchedAt }) {
  const warnings = [];
  const byDate = new Map();
  const closed = new Map();
  const seen = new Set();
  for (const w of windows) {
    for (const c of w.close_days ?? []) {
      if (DATE.test(String(c.date)) && c.date >= today) closed.set(c.date, String(c.text ?? '').trim() || 'סגור');
    }
    for (const row of w.scheduler ?? []) {
      if (seen.has(row.scheduler_id)) continue;
      seen.add(row.scheduler_id);
      const result = normalizeRow(row);
      if (result.skip) {
        warnings.push(`skipped row ${row.scheduler_id}: ${result.skip}`);
        continue;
      }
      if (result.date < today) continue;
      if (!byDate.has(result.date)) byDate.set(result.date, []);
      byDate.get(result.date).push(result.session);
    }
  }

  const dates = [...byDate.keys(), ...closed.keys()].sort();
  const publishedThrough = dates.at(-1) ?? null;
  const days = [];
  for (let date = today; publishedThrough && date <= publishedThrough; date = addDays(date, 1)) {
    const sessions = (byDate.get(date) ?? []).sort(compareSessions);
    days.push({
      date,
      open: sessions.length ? sessions[0].start : null,
      close: sessions.reduce((latest, s) => (latest === null || s.end > latest ? s.end : latest), null),
      closed: closed.get(date) ?? null,
      sessions,
    });
  }
  return { schedule: { fetchedAt, publishedThrough, days }, warnings };
}
