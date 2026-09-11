// Pure view logic over the schedule model (spec section 6). No DOM here.
import { addDays, dayOfWeek, daysBetween, minutes, HE_MONTHS } from './time.mjs';

const AREA_ORDER = { reef: 0, bay: 1 };

/** Sessions sharing start, end and area form one block. Sorted by start, reef before Bay. */
export function groupBlocks(sessions) {
  const blocks = [];
  for (const s of sessions) {
    let block = blocks.find(b => b.start === s.start && b.end === s.end && b.area === s.area);
    if (!block) blocks.push((block = { start: s.start, end: s.end, area: s.area, sessions: [] }));
    block.sessions.push(s);
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start) || AREA_ORDER[a.area] - AREA_ORDER[b.area]);
}

/**
 * Calendar overlap layout. Adds x0/x1 (percent of the column width, measured from the
 * inline start, i.e. the right edge in RTL). A block that overlaps nothing spans 0–100.
 * In a cluster of overlapping blocks, reef gets 0–64 and Bay 64–100 when both are present,
 * and same-area blocks that overlap split their share side by side. Touching isn't overlapping.
 */
export function layoutBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start) || AREA_ORDER[a.area] - AREA_ORDER[b.area]);
  const out = [];
  let cluster = [];
  let clusterEnd = '';
  const flush = () => {
    const lanes = { reef: [], bay: [] };
    const sub = new Map();
    for (const b of cluster) {
      const ends = lanes[b.area];
      let i = ends.findIndex(end => end <= b.start);
      if (i < 0) {
        i = ends.length;
        ends.push(b.end);
      } else {
        ends[i] = b.end;
      }
      sub.set(b, i);
    }
    const both = lanes.reef.length > 0 && lanes.bay.length > 0;
    for (const b of cluster) {
      const [a0, a1] = !both ? [0, 100] : b.area === 'reef' ? [0, 64] : [64, 100];
      const width = (a1 - a0) / lanes[b.area].length;
      const x0 = a0 + sub.get(b) * width;
      out.push({ ...b, x0, x1: x0 + width });
    }
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    clusterEnd = cluster.length && clusterEnd > b.end ? clusterEnd : b.end;
    cluster.push(b);
  }
  if (cluster.length) flush();
  return out;
}

/** A reef block's two sides. `shared` = one session on both sides (or only one side exists). */
export function reefSides(block) {
  const right = block.sessions.find(s => s.side === 'right') ?? null;
  const left = block.sessions.find(s => s.side === 'left') ?? null;
  const shared = !right || !left || (right.name === left.name && right.level === left.level);
  return { right, left, shared };
}

/** The 7 dates of the week view, starting today. */
export const weekDates = today => Array.from({ length: 7 }, (_, i) => addDays(today, i));

/** Whole hours covering every session of the given days: { from, to }. Defaults to 6–22. */
export function hourRange(days) {
  const sessions = days.flatMap(d => d?.sessions ?? []);
  if (!sessions.length) return { from: 6, to: 22 };
  return {
    from: Math.floor(Math.min(...sessions.map(s => minutes(s.start))) / 60),
    to: Math.ceil(Math.max(...sessions.map(s => minutes(s.end))) / 60),
  };
}

/** Month view: from this week's Sunday through the week holding `publishedThrough`, plus one week. */
export function monthDates(today, publishedThrough) {
  const start = addDays(today, -dayOfWeek(today));
  const weeks = Math.floor(daysBetween(start, publishedThrough ?? today) / 7) + 2;
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** "ספטמבר 2026" or "ספטמבר–אוקטובר 2026" for a list of dates. */
export function monthTitle(dates) {
  const first = dates[0];
  const last = dates.at(-1);
  const y1 = first.slice(0, 4);
  const y2 = last.slice(0, 4);
  const m1 = HE_MONTHS[Number(first.slice(5, 7)) - 1];
  const m2 = HE_MONTHS[Number(last.slice(5, 7)) - 1];
  if (m1 === m2) return `${m1} ${y2}`;
  return y1 === y2 ? `${m1}–${m2} ${y2}` : `${m1} ${y1}–${m2} ${y2}`;
}

/** Finished today (`now` is Israel "HH:MM"). */
export const isPast = (session, date, today, now) => date === today && session.end <= now;

/** Running right now. */
export const isNow = (session, date, today, now) => date === today && session.start <= now && now < session.end;

/** For month cells: total spots left and the reef levels in time order (one per reef block). */
export function daySummary(day) {
  const sessions = day?.sessions ?? [];
  return {
    freeSpots: sessions.reduce((n, s) => n + s.spotsLeft, 0),
    levels: groupBlocks(sessions).filter(b => b.area === 'reef').map(b => b.sessions[0].level),
  };
}

/**
 * Day-view rows: a reef pair running one session is one row (right + left); different sessions
 * on the two sides are two rows; each Bay lesson is its own row. { start, end, area, main, right, left }.
 */
export function dayRows(sessions) {
  const rows = [];
  for (const block of groupBlocks(sessions)) {
    const { start, end, area } = block;
    if (area === 'bay') {
      for (const s of block.sessions) rows.push({ start, end, area, main: s, right: null, left: null });
      continue;
    }
    const { right, left, shared } = reefSides(block);
    if (shared) {
      rows.push({ start, end, area, main: right ?? left, right, left });
    } else {
      rows.push({ start, end, area, main: right, right, left: null });
      rows.push({ start, end, area, main: left, right: null, left });
    }
  }
  return rows;
}

/** Park name → { title, note }: drop the level prefix; "כולל גלשן סופט…" and Bay age groups become the note. */
export function displayName(name) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.includes('Bay')) return { title: 'שיעור מתחילים ב־Bay', note: clean.split(' - ').at(-1) };
  return {
    title: clean.replace(/\s*-\s*כולל.*$/, '').replace(/^L\d\s*[-–]?\s*/, '').trim(),
    note: clean.includes('כולל גלשן סופט') ? 'כולל גלשן סופט' : '',
  };
}
