// History rules shared by the scraper and the page (analysis spec sections 3, 4.1 and 6.1).
import { addDays, daysBetween, monthsBetween } from './time.mjs';

/** Bay groups for kids. The park's age field says "all" on most kids' groups; the name is reliable. */
export const isKids = name => /ילדים|גילאי/.test(String(name));

/** A session's kind, first match wins. ("removed" is only ever set by the history update.) */
export function classify({ area, level, capacity, blocked }) {
  if (capacity === 0) return 'cancelled';
  if (blocked) return 'blocked';
  if (level === 7) return 'event';
  return area === 'bay' ? 'lesson' : 'surf';
}

/** A stored month file (names by index) → { month, closed, sessions } with names as strings. */
export function expandMonth(file) {
  return {
    month: file.month,
    closed: file.closed ?? [],
    sessions: (file.sessions ?? []).map(s => ({ ...s, name: file.names?.[s.name] ?? '' })),
  };
}

export const PERIODS = { '30d': 30, '90d': 90, '12m': 365, all: null };
export const DEFAULT_PERIOD = '90d';

/**
 * The range a period preset covers, always ending yesterday (today isn't final), and what it's
 * compared with: the same range 364 days back (weekday-aligned) if history covers it, otherwise
 * the previous range of equal length if history covers that, otherwise nothing.
 * `first` is the first date in the history.
 */
export function periodRange(preset, today, first) {
  const to = addDays(today, -1);
  const length = Object.hasOwn(PERIODS, preset) ? PERIODS[preset] : PERIODS[DEFAULT_PERIOD];
  if (length === null) return { preset, from: first ?? to, to, compare: null };
  let from = addDays(today, -length);
  if (first && from < first) from = first;
  const days = daysBetween(from, to) + 1;
  const lastYear = { kind: 'lastYear', from: addDays(from, -364), to: addDays(to, -364) };
  const previous = { kind: 'previous', from: addDays(from, -days), to: addDays(from, -1) };
  const compare = !first ? null : lastYear.from >= first ? lastYear : previous.from >= first ? previous : null;
  return { preset, from, to, compare };
}

/** Month files a range and its comparison need. */
export function monthsNeeded(range) {
  const months = new Set(monthsBetween(range.from, range.to));
  if (range.compare) for (const m of monthsBetween(range.compare.from, range.compare.to)) months.add(m);
  return [...months].sort();
}
