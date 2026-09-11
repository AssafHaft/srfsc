// CLI: records the fresh site/data/schedule.json into the monthly history files, and takes the
// park's final counts for the last 3 days (analysis spec section 4.3). Runs after scrape.mjs.
// Usage: node scraper/update-history.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addDays, israelToday, monthsBetween } from '../site/lib/time.mjs';
import { fetchWindow } from './fetch.mjs';
import { applyFinal, earliestDate, finalizeStale, formatMonth, nextIndex, parseMonth, upsertUpcoming } from './history.mjs';
import { DATA_FILE } from './scrape.mjs';

export const HISTORY_DIR = fileURLToPath(new URL('../site/data/history/', import.meta.url));

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** The month files for `months`, keyed by month; missing files start empty. */
export async function readMonths(dir, months) {
  const store = {};
  for (const month of months) {
    const text = await readText(join(dir, `${month}.json`));
    store[month] = text ? parseMonth(text) : { month, closed: [], sessions: [] };
  }
  return store;
}

/** Writes every month that has sessions or closed days. Returns the months written. */
export async function writeMonths(dir, store) {
  await mkdir(dir, { recursive: true });
  const written = [];
  for (const m of Object.values(store)) {
    if (!m.sessions.length && !m.closed.length) continue;
    await writeFile(join(dir, `${m.month}.json`), formatMonth(m));
    written.push(m.month);
  }
  return written;
}

export async function readIndex(dir) {
  const text = await readText(join(dir, 'index.json'));
  return text ? JSON.parse(text) : null;
}

export const writeIndex = (dir, index) => writeFile(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

/** One history update. A failed past-window fetch only skips the final counts. */
export async function updateHistory({ dir = HISTORY_DIR, scheduleFile = DATA_FILE, now = new Date(), log = console.log, ...fetchOptions } = {}) {
  const schedule = JSON.parse(await readFile(scheduleFile, 'utf8'));
  const today = israelToday(now);
  const from = addDays(today, -3);
  const to = addDays(today, -1);
  const store = await readMonths(dir, monthsBetween(addDays(today, -31), schedule.publishedThrough ?? today));
  upsertUpcoming(store, schedule);
  try {
    applyFinal(store, await fetchWindow(from, { log, ...fetchOptions }), { from, to });
  } catch (err) {
    log(`warning: final counts for ${from}..${to} skipped: ${err.message}`);
  }
  finalizeStale(store, today);
  const months = await writeMonths(dir, store);
  const index = nextIndex(await readIndex(dir), { months, updatedAt: schedule.fetchedAt, first: earliestDate(store), snapshot: true });
  await writeIndex(dir, index);
  log(`history: wrote ${months.join(', ')}; ${index.snapshots} snapshots since ${index.snapshotsSince}`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateHistory().catch(err => {
    console.error(`history update failed: ${err.message}`);
    process.exitCode = 1;
  });
}
