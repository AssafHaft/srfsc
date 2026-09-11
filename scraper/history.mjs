// History files (analysis spec section 4): site/data/history/YYYY-MM.json, one per month of the
// session date, written one session per line so each run's git diff shows only what changed.
// A "store" is { "2026-09": { month, closed: [{ date, text }], sessions: [row] } } with names as strings.
import { addDays, israelInstant } from '../site/lib/time.mjs';
import { classify, expandMonth, isKids } from '../site/lib/history.mjs';
import { normalizeRow } from './normalize.mjs';

const AREA_ORDER = { reef: 0, bay: 1 };
const SIDE_ORDER = { right: 0, left: 1 };

export const monthOf = date => date.slice(0, 7);

export const compareRows = (a, b) =>
  a.date.localeCompare(b.date) ||
  a.start.localeCompare(b.start) ||
  AREA_ORDER[a.area] - AREA_ORDER[b.area] ||
  SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
  a.id - b.id;

/** A normalized session on `date` → a history row (not final, no pace yet). */
export function toRow(date, s) {
  return {
    id: s.id,
    date,
    start: s.start,
    end: s.end,
    level: s.level,
    area: s.area,
    side: s.side,
    kids: s.area === 'bay' && isKids(s.name),
    name: s.name,
    kind: classify(s),
    capacity: s.capacity,
    booked: s.booked,
    final: false,
    pace: [],
  };
}

/** Whole minutes from `fetchedAt` (ISO timestamp) until the session starts, in Israel time. */
export const minutesBefore = (date, start, fetchedAt) =>
  Math.round((israelInstant(date, start) - Date.parse(fetchedAt)) / 60000);

const monthIn = (store, month) => (store[month] ??= { month, closed: [], sessions: [] });

function addClosed(store, date, text) {
  const m = monthIn(store, monthOf(date));
  m.closed = [...m.closed.filter(c => c.date !== date), { date, text }].sort((a, b) => a.date.localeCompare(b.date));
}

/** Records a fresh schedule: upserts every session and appends a pace entry when its booked count changed. */
export function upsertUpcoming(store, schedule) {
  for (const day of schedule.days) {
    if (day.closed) addClosed(store, day.date, day.closed);
    for (const s of day.sessions) {
      const m = monthIn(store, monthOf(day.date));
      const i = m.sessions.findIndex(r => r.id === s.id);
      const old = i >= 0 ? m.sessions[i] : null;
      if (old?.final === true) continue; // the park's final count wins over any snapshot
      const row = toRow(day.date, s);
      row.pace = old ? old.pace : [];
      const before = minutesBefore(day.date, s.start, schedule.fetchedAt);
      if (before >= 0 && row.pace.at(-1)?.[1] !== s.booked) row.pace.push([before, s.booked]);
      if (old) m.sessions[i] = row;
      else m.sessions.push(row);
    }
  }
  return store;
}

/**
 * Final counts from one past park window: its rows dated from..to take the park's numbers and
 * final: true (keeping their pace). Rows we hold for those dates that the park no longer lists
 * become kind "removed".
 */
export function applyFinal(store, window, { from, to }) {
  const listed = new Set();
  for (const raw of window.scheduler ?? []) {
    listed.add(raw.scheduler_id);
    const n = normalizeRow(raw);
    if (n.skip || n.date < from || n.date > to) continue;
    const m = monthIn(store, monthOf(n.date));
    const row = { ...toRow(n.date, n.session), final: true };
    const i = m.sessions.findIndex(r => r.id === row.id);
    if (i >= 0) {
      row.pace = m.sessions[i].pace;
      m.sessions[i] = row;
    } else {
      m.sessions.push(row);
    }
  }
  for (const c of window.close_days ?? []) {
    if (c.date >= from && c.date <= to) addClosed(store, c.date, String(c.text ?? '').replace(/\s+/g, ' ').trim() || 'סגור');
  }
  for (const m of Object.values(store)) {
    for (const r of m.sessions) {
      if (r.date >= from && r.date <= to && !listed.has(r.id)) {
        r.kind = 'removed';
        r.final = true;
      }
    }
  }
  return store;
}

/** Rows more than 3 days old that never got the park's final count keep their last snapshot as final. */
export function finalizeStale(store, today) {
  const cutoff = addDays(today, -3);
  for (const m of Object.values(store)) {
    for (const r of m.sessions) if (r.final === false && r.date < cutoff) r.final = 'snapshot';
  }
  return store;
}

/** A month → its file text: names by index, closed days, then one session per line. */
export function formatMonth(m) {
  const names = [];
  const index = new Map();
  const line = r => {
    if (!index.has(r.name)) {
      index.set(r.name, names.length);
      names.push(r.name);
    }
    const { id, date, start, end, level, area, side, kids, kind, capacity, booked, final, pace } = r;
    return `    ${JSON.stringify({ id, date, start, end, level, area, side, kids, name: index.get(r.name), kind, capacity, booked, final, pace })}`;
  };
  const lines = [...m.sessions].sort(compareRows).map(line);
  const closed = [...m.closed].sort((a, b) => a.date.localeCompare(b.date));
  const sessions = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n  "month": ${JSON.stringify(m.month)},\n  "names": ${JSON.stringify(names)},\n  "closed": ${JSON.stringify(closed)},\n  "sessions": ${sessions}\n}\n`;
}

/** File text → month with names as strings. */
export const parseMonth = text => expandMonth(JSON.parse(text));

/** The first session date held in a store, or null. */
export const earliestDate = store =>
  Object.values(store).flatMap(m => m.sessions.map(r => r.date)).sort()[0] ?? null;

/** index.json after an update. `snapshot` is true when this update recorded a live schedule. */
export function nextIndex(prev, { months, updatedAt, first, snapshot }) {
  return {
    updatedAt,
    first: [prev?.first, first].filter(Boolean).sort()[0] ?? null,
    months: [...new Set([...(prev?.months ?? []), ...months])].sort(),
    snapshots: (prev?.snapshots ?? 0) + (snapshot ? 1 : 0),
    snapshotsSince: prev?.snapshotsSince ?? (snapshot ? updatedAt.slice(0, 10) : null),
  };
}
