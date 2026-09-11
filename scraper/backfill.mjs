// CLI: one-time import of every past session the park still serves into site/data/history/
// (analysis spec section 4.4). Safe to re-run: it merges and keeps existing pace entries.
// Usage: node scraper/backfill.mjs   (about 180 windows, 1.5 s apart: 5 minutes)
import { pathToFileURL } from 'node:url';
import { addDays, israelIso, israelToday, monthsBetween } from '../site/lib/time.mjs';
import { fetchWindow } from './fetch.mjs';
import { applyFinal, earliestDate, nextIndex } from './history.mjs';
import { HISTORY_DIR, readIndex, readMonths, writeIndex, writeMonths } from './update-history.mjs';

export const FIRST_WINDOW = '2025-04-01'; // the park's first sessions are on 2.4.2025
export const PAUSE_MS = 1500;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function backfill({ dir = HISTORY_DIR, start = FIRST_WINDOW, now = new Date(), sleep = wait, log = console.log, ...fetchOptions } = {}) {
  const yesterday = addDays(israelToday(now), -1);
  const store = await readMonths(dir, monthsBetween(start, yesterday));
  let windows = 0;
  for (let from = start; from <= yesterday; from = addDays(from, 3)) {
    const to = addDays(from, 2) < yesterday ? addDays(from, 2) : yesterday;
    applyFinal(store, await fetchWindow(from, { sleep, log, ...fetchOptions }), { from, to });
    windows += 1;
    if (windows % 20 === 0) log(`backfill: through ${to}`);
    await sleep(PAUSE_MS);
  }
  const months = await writeMonths(dir, store);
  const index = nextIndex(await readIndex(dir), { months, updatedAt: israelIso(now), first: earliestDate(store), snapshot: false });
  await writeIndex(dir, index);
  const sessions = Object.values(store).reduce((n, m) => n + m.sessions.length, 0);
  log(`backfill: ${windows} windows, ${sessions} sessions in ${months.length} months`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfill().catch(err => {
    console.error(`backfill failed: ${err.message}`);
    process.exitCode = 1;
  });
}
