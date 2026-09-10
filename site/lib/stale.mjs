// When to warn that the data is old (spec section 8).
import { israelTime } from './time.mjs';

const HOUR = 3600000;

/**
 * Stale if older than 12 hours at any time, or older than 3 hours while the park is
 * normally being scraped (07:00–23:30 Israel time; the overnight pause doesn't count).
 */
export function isStale(fetchedAtIso, now = new Date()) {
  const age = now.getTime() - Date.parse(fetchedAtIso);
  if (!Number.isFinite(age)) return true;
  if (age > 12 * HOUR) return true;
  const time = israelTime(now);
  return time >= '07:00' && time <= '23:30' && age > 3 * HOUR;
}
