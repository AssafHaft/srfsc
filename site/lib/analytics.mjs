// The analysis tab's numbers (analysis spec sections 3 and 6). Pure functions over history rows
// { id, date, start, end, level, area, side, kids, name, kind, capacity, booked, final, pace }.
import { addDays, dayOfWeek, daysBetween, israelInstant, israelToday, monthsBetween } from './time.mjs';
import { classify, isKids } from './history.mjs';

export const LEVEL_KEYS = ['bay-adult', 'bay-kids', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
export const HEAT_MIN_SESSIONS = 4;
export const SLOT_MIN_DATES = 4;
export const WEEKLY_MAX_DAYS = 92;
export const PACE = { minSessions: 30, minLeadMinutes: 7 * 1440, leadDays: [14, 10, 7, 5, 3, 2, 1, 0], minGroup: 5, minSoldOut: 3 };
export const AT_RISK = { hours: 48, below: 0.4 };

export const levelKey = r => (r.area === 'bay' ? (r.kids ? 'bay-kids' : 'bay-adult') : `L${r.level}`);
export const isCounted = r => r.kind === 'surf' || r.kind === 'lesson';
export const isWeekend = date => dayOfWeek(date) >= 5; // Friday, Saturday
export const priceOf = (r, prices) =>
  r.area === 'bay' ? (r.kids ? prices.bayKids : prices.bayAdult) : r.level >= 5 ? prices.reefHigh : prices.reef;
/** The level filter: an empty set means every level; 0 selects both Bay groups. */
export const matchesLevels = (r, levels) => levels.size === 0 || levels.has(r.area === 'bay' ? 0 : r.level);
const inRange = (r, from, to) => r.date >= from && r.date <= to;
const share = (part, whole) => (whole ? part / whole : 0);
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const median = values => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
};

/** Totals over sessions. Occupancy caps overbooking at capacity; revenue counts every person. */
export function aggregate(rows, prices) {
  let capacity = 0, spotsSold = 0, people = 0, soldOut = 0, revenue = 0, emptyValue = 0;
  for (const r of rows) {
    const price = priceOf(r, prices);
    capacity += r.capacity;
    spotsSold += Math.min(r.booked, r.capacity);
    people += r.booked;
    if (r.booked >= r.capacity) soldOut += 1;
    revenue += r.booked * price;
    emptyValue += Math.max(0, r.capacity - r.booked) * price;
  }
  return {
    sessions: rows.length, capacity, spotsSold, people, revenue, emptyValue,
    occupancy: capacity ? spotsSold / capacity : null,
    soldOutShare: rows.length ? soldOut / rows.length : null,
  };
}

/** Counted sessions in a date range that pass the level filter. */
export const selectRows = (rows, { from, to }, levels) =>
  rows.filter(r => isCounted(r) && inRange(r, from, to) && matchesLevels(r, levels));

export function kpis(cur, cmp, { range, closed, prices }) {
  const block = (rows, from, to) => ({
    ...aggregate(rows, prices),
    daysOpen: new Set(rows.map(r => r.date)).size,
    closedDays: closed.filter(c => inRange(c, from, to)).length,
  });
  return {
    cur: block(cur, range.from, range.to),
    cmp: range.compare ? block(cmp, range.compare.from, range.compare.to) : null,
  };
}

/** Friday–Saturday against Sunday–Thursday. */
export const weekSplit = (rows, prices) => ({
  weekend: aggregate(rows.filter(r => isWeekend(r.date)), prices),
  weekday: aggregate(rows.filter(r => !isWeekend(r.date)), prices),
});

/** Start hour × weekday (0 = Sunday). A cell with fewer than 4 sessions is null. */
export function heatmap(rows, prices) {
  const groups = groupBy(rows, r => `${r.start.slice(0, 2)}|${dayOfWeek(r.date)}`);
  const hours = [...new Set(rows.map(r => r.start.slice(0, 2)))].sort();
  return hours.map(hour => ({
    hour,
    cells: [0, 1, 2, 3, 4, 5, 6].map(d => {
      const g = groups.get(`${hour}|${d}`) ?? [];
      return g.length >= HEAT_MIN_SESSIONS ? aggregate(g, prices) : null;
    }),
  }));
}

/** One row per level key that ran, with its share of capacity, bookings and revenue. */
export function levelTable(cur, cmp, prices) {
  const total = aggregate(cur, prices);
  return LEVEL_KEYS.flatMap(key => {
    const a = aggregate(cur.filter(r => levelKey(r) === key), prices);
    if (!a.sessions) return [];
    const b = cmp ? aggregate(cmp.filter(r => levelKey(r) === key), prices) : null;
    return [{
      key, ...a,
      capacityShare: share(a.capacity, total.capacity),
      bookingShare: share(a.spotsSold, total.spotsSold),
      revenueShare: share(a.revenue, total.revenue),
      cmp: b?.sessions ? b : null,
    }];
  });
}

/** Recurring slots (weekday + start + level key) that ran on at least 4 dates: strongest and weakest. */
export function slotRanking(rows, prices, size = 10) {
  const slots = [...groupBy(rows, r => `${dayOfWeek(r.date)}|${r.start}|${levelKey(r)}`)]
    .map(([k, g]) => {
      const [weekday, start, level] = k.split('|');
      return { weekday: Number(weekday), start, level, dates: new Set(g.map(r => r.date)).size, ...aggregate(g, prices) };
    })
    .filter(s => s.dates >= SLOT_MIN_DATES)
    .sort((a, b) => b.occupancy - a.occupancy || b.soldOutShare - a.soldOutShare || a.weekday - b.weekday || a.start.localeCompare(b.start));
  return {
    count: slots.length,
    top: slots.slice(0, size),
    bottom: slots.slice(Math.max(size, slots.length - size)).reverse(),
  };
}

const monthEnd = month => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

/** The same calendar date a year earlier; 29 February becomes 28 February. */
const yearEarlier = iso => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`.replace(/-02-29$/, '-02-28');

/** Weekly buckets up to 92 days, calendar months above, clipped to from..to. */
function periodBuckets(from, to) {
  const weekly = daysBetween(from, to) + 1 <= WEEKLY_MAX_DAYS;
  const buckets = [];
  if (weekly) {
    for (let f = from; f <= to; f = addDays(f, 7)) {
      const end = addDays(f, 6);
      buckets.push({ from: f, to: end < to ? end : to });
    }
  } else {
    for (const m of monthsBetween(from, to)) {
      const end = monthEnd(m);
      buckets.push({ from: `${m}-01` > from ? `${m}-01` : from, to: end < to ? end : to });
    }
  }
  return { unit: weekly ? 'week' : 'month', buckets };
}

/** Weekly buckets up to 92 days, monthly above; each with the comparison range's matching bucket. */
export function trend(cur, cmp, range, closed, prices) {
  const { unit, buckets } = periodBuckets(range.from, range.to);
  const weekly = unit === 'week';
  // weekly: the comparison's day offset (−364 for last year keeps weekdays aligned);
  // monthly: the same calendar month a year earlier (spec 6.6), whole months stay whole across 29 February
  const offset = range.compare ? daysBetween(range.compare.from, range.from) : 0;
  const back = (from, to) => (weekly
    ? [addDays(from, -offset), addDays(to, -offset)]
    : [yearEarlier(from), to === monthEnd(to.slice(0, 7)) ? monthEnd(yearEarlier(to).slice(0, 7)) : yearEarlier(to)]);
  return {
    unit: weekly ? 'week' : 'month',
    buckets: buckets.map(({ from, to }) => {
      const a = aggregate(cur.filter(r => inRange(r, from, to)), prices);
      const [cmpFrom, cmpTo] = back(from, to);
      const c = range.compare ? aggregate(cmp.filter(r => inRange(r, cmpFrom, cmpTo)), prices) : null;
      return {
        from, to,
        occupancy: a.occupancy, revenue: a.revenue,
        cmpOccupancy: c?.occupancy ?? null, cmpRevenue: c?.sessions ? c.revenue : null,
        closedDays: closed.filter(x => inRange(x, from, to)).length,
      };
    }),
  };
}

/** Booked as of `leadMinutes` before start: the last pace entry recorded at least that early, or null. */
export function bookedAt(pace, leadMinutes) {
  let booked = null;
  for (const [minutesBefore, count] of pace) {
    if (minutesBefore < leadMinutes) break;
    booked = count;
  }
  return booked;
}

/** A fill curve's value `days` before start, interpolated between the curve's lead points. */
export function curveAt(curve, days) {
  const leads = PACE.leadDays;
  if (!curve) return null;
  if (days >= leads[0]) return curve[0];
  for (let i = 0; i < leads.length - 1; i++) {
    const [hi, lo] = [leads[i], leads[i + 1]];
    if (days <= hi && days >= lo) {
      const [a, b] = [curve[i], curve[i + 1]];
      if (a === null || b === null) return a ?? b;
      return b + ((a - b) * (days - lo)) / (hi - lo);
    }
  }
  return curve.at(-1);
}

/** Fill speed from our snapshots (spec 6.7). Ready once 30 sessions were seen at least 7 days ahead. */
export function pace(rows) {
  const tracked = rows.filter(r => r.pace?.length);
  const deep = tracked.filter(r => r.pace[0][0] >= PACE.minLeadMinutes);
  const result = { ready: deep.length >= PACE.minSessions, tracked: tracked.length, deep: deep.length };
  if (!result.ready) return result;

  const curve = group => PACE.leadDays.map(d => {
    const values = group
      .map(r => {
        const b = bookedAt(r.pace, d * 1440);
        return b === null ? null : Math.min(b, r.capacity) / r.capacity;
      })
      .filter(v => v !== null);
    return values.length ? mean(values) : null;
  });
  const curves = {};
  const sellOutLeadDays = {};
  for (const [key, group] of groupBy(tracked, levelKey)) {
    if (group.length >= PACE.minGroup) curves[key] = curve(group);
    const leads = group.map(r => r.pace.find(([, b]) => b >= r.capacity)?.[0]).filter(m => m !== undefined);
    if (leads.length >= PACE.minSoldOut) sellOutLeadDays[key] = median(leads) / 1440;
  }
  const at24 = tracked.map(r => [r, bookedAt(r.pace, 1440)]).filter(([, b]) => b !== null);
  const lateSum = at24.reduce((n, [r, b]) => n + Math.max(0, r.booked - b), 0);
  const released = tracked.reduce((n, r) => {
    let drops = 0;
    for (let i = 1; i < r.pace.length; i++) drops += Math.max(0, r.pace[i - 1][1] - r.pace[i][1]);
    return n + drops + Math.max(0, r.pace.at(-1)[1] - r.booked);
  }, 0);
  return {
    ...result,
    curves,
    weekday: curve(tracked.filter(r => !isWeekend(r.date))),
    weekend: curve(tracked.filter(r => isWeekend(r.date))),
    sellOutLeadDays,
    last24Share: share(lateSum, at24.reduce((n, [r]) => n + r.booked, 0)),
    released,
  };
}

/** The published schedule ahead (spec 6.8): booked share per day, and sessions at risk. */
export function upcoming(schedule, { now, prices, levels, paceModel = null }) {
  const nowMs = now.getTime();
  const rows = schedule.days
    .flatMap(d => d.sessions.map(s => ({ ...s, date: d.date, kids: s.area === 'bay' && isKids(s.name), kind: classify(s) })))
    .filter(r => isCounted(r) && matchesLevels(r, levels) && israelInstant(r.date, r.end) > nowMs);
  const today = israelToday(now);
  const days = [...groupBy(rows, r => r.date)].sort(([a], [b]) => a.localeCompare(b)).map(([date, g]) => {
    const a = aggregate(g, prices);
    const curve = paceModel?.ready ? (isWeekend(date) ? paceModel.weekend : paceModel.weekday) : null;
    const usual = curve ? curveAt(curve, daysBetween(today, date)) : null;
    return { date, occupancy: a.occupancy, capacity: a.capacity, spotsSold: a.spotsSold, usual };
  });
  const startsIn = r => (israelInstant(r.date, r.start) - nowMs) / 3600000;
  const risky = rows.filter(r => startsIn(r) > 0 && startsIn(r) <= AT_RISK.hours && Math.min(r.booked, r.capacity) / r.capacity < AT_RISK.below);
  const atRisk = [...groupBy(risky, r => `${r.date}|${r.start}|${levelKey(r)}`)]
    .map(([k, g]) => {
      const [date, start, level] = k.split('|');
      return {
        date, start, level, name: g[0].name,
        booked: g.reduce((n, r) => n + r.booked, 0),
        capacity: g.reduce((n, r) => n + r.capacity, 0),
        hours: Math.round(startsIn(g[0])),
        emptyValue: aggregate(g, prices).emptyValue,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { days, atRisk };
}

/** Capacity that wasn't for sale, and schedule changes, in a range (all kinds). */
export function operations(rows, closed, range, levels) {
  const inPeriod = rows.filter(r => inRange(r, range.from, range.to) && matchesLevels(r, levels));
  const ofKind = kind => inPeriod.filter(r => r.kind === kind);
  const counted = inPeriod.filter(isCounted);
  const names = [...groupBy(ofKind('blocked'), r => r.name)]
    .map(([name, g]) => ({ name, count: g.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    closed: closed.filter(c => inRange(c, range.from, range.to)),
    blocked: ofKind('blocked').length,
    blockedNames: names.slice(0, 3),
    cancelled: ofKind('cancelled').length,
    removed: ofKind('removed').length,
    events: ofKind('event').length,
    overbooked: counted.filter(r => r.booked > r.capacity).length,
    overbookedPeople: counted.reduce((n, r) => n + Math.max(0, r.booked - r.capacity), 0),
  };
}

const REEF_TIME = new Set(['surf', 'event', 'blocked', 'hidden']);
/** A reef side and hour: date, side and start rounded up to the whole hour (hidden rows start on the hour). */
const sideHour = r => `${r.date}|${r.side}|${r.start.endsWith(':00') ? r.start.slice(0, 2) : String(Number(r.start.slice(0, 2)) + 1).padStart(2, '0')}`;
const peopleOf = rows => rows.reduce((n, r) => n + r.booked, 0);

/**
 * Bookings the public schedule never showed, from the one-time CMS import (CMS import spec 6.2).
 * Only the part of the range inside the import's coverage counts; the level filter doesn't apply.
 */
export function hidden(rows, range, cms) {
  if (!cms) return { window: null };
  const from = range.from > cms.from ? range.from : cms.from;
  const to = range.to < cms.to ? range.to : cms.to;
  if (from > to) return { window: null };
  const offset = range.compare ? daysBetween(range.compare.from, range.from) : null;
  const compare = offset !== null && addDays(from, -offset) >= cms.from ? { from: addDays(from, -offset), to: addDays(to, -offset) } : null;
  const measure = (a, b) => {
    const inWindow = rows.filter(r => inRange(r, a, b));
    const list = inWindow.filter(r => r.kind === 'hidden');
    const people = peopleOf(list);
    const reef = inWindow.filter(r => r.area === 'reef' && REEF_TIME.has(r.kind));
    const onSale = new Set(reef.filter(isCounted).map(sideHour));
    const taken = new Set(reef.filter(r => r.kind === 'hidden').map(sideHour).filter(k => !onSale.has(k)));
    return {
      list,
      totals: {
        people, sessions: list.length,
        share: share(people, people + peopleOf(inWindow.filter(isCounted))),
        reefShare: share(taken.size, new Set(reef.map(sideHour)).size),
      },
    };
  };
  const cur = measure(from, to);
  const cmp = compare ? measure(compare.from, compare.to) : null;
  const cmpByLabel = cmp ? groupBy(cmp.list, r => r.name) : new Map();
  const categories = [...groupBy(cur.list, r => r.name)]
    .map(([label, g]) => {
      const people = peopleOf(g);
      return {
        label, people, sessions: g.length, share: share(people, cur.totals.people), avgSize: people / g.length,
        bayShare: share(peopleOf(g.filter(r => r.area === 'bay')), people),
        cmpPeople: cmp ? peopleOf(cmpByLabel.get(label) ?? []) : null,
      };
    })
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));
  const { unit, buckets } = periodBuckets(from, to);
  const hours = [...new Set(cur.list.map(r => r.start.slice(0, 2)))].sort();
  return {
    window: { from, to }, compare, partial: from > range.from || to < range.to,
    ...cur.totals, cmp: cmp ? cmp.totals : null, categories, unit,
    buckets: buckets.map(b => ({ ...b, people: peopleOf(cur.list.filter(r => inRange(r, b.from, b.to))) })),
    grid: hours.map(hour => ({
      hour,
      cells: [0, 1, 2, 3, 4, 5, 6].map(d => peopleOf(cur.list.filter(r => r.start.slice(0, 2) === hour && dayOfWeek(r.date) === d))),
    })),
  };
}

/** Everything the analysis tab shows, for one period and level filter. */
export function analyse({ rows, closed, range, levels, prices, schedule, now, index = null }) {
  const cur = selectRows(rows, range, levels);
  const cmp = range.compare ? selectRows(rows, range.compare, levels) : [];
  const paceModel = pace(cur);
  return {
    range,
    prices,
    kpis: kpis(cur, cmp, { range, closed, prices }),
    split: weekSplit(cur, prices),
    heat: heatmap(cur, prices),
    levels: levelTable(cur, range.compare ? cmp : null, prices),
    slots: slotRanking(cur, prices),
    trend: trend(cur, cmp, range, closed, prices),
    pace: paceModel,
    upcoming: upcoming(schedule, { now, prices, levels, paceModel }),
    ops: operations(rows, closed, range, levels),
    hidden: hidden(rows, range, index?.cms ?? null),
    coverage: { first: index?.first ?? null, sessions: cur.length, snapshots: index?.snapshots ?? 0, snapshotsSince: index?.snapshotsSince ?? null, updatedAt: index?.updatedAt ?? null, cms: index?.cms ?? null },
  };
}
