// CLI: fetch the park's schedule and write site/data/schedule.json (spec section 4).
// Usage: node scraper/scrape.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { israelIso, israelToday } from '../site/lib/time.mjs';
import { fetchHorizon } from './fetch.mjs';
import { normalize } from './normalize.mjs';

export const DATA_FILE = fileURLToPath(new URL('../site/data/schedule.json', import.meta.url));

/** Sessions on days from `fromDate` on (any schedule shape, including null). */
export const countSessions = (schedule, fromDate) =>
  (schedule?.days ?? []).filter(d => d.date >= fromDate).reduce((n, d) => n + d.sessions.length, 0);

/** Fetch + normalize. Throws instead of replacing upcoming sessions with nothing. */
export async function scrape({ now = new Date(), existing = null, log = console.log, ...fetchOptions } = {}) {
  const today = israelToday(now);
  const windows = await fetchHorizon(today, { log, ...fetchOptions });
  const { schedule, warnings } = normalize(windows, { today, fetchedAt: israelIso(now) });
  for (const w of warnings) log(`warning: ${w}`);
  if (countSessions(schedule, today) === 0 && !schedule.days.some(d => d.closed) && countSessions(existing, today) > 0) {
    throw new Error('the park returned no sessions but the current file has upcoming ones (blocked?); keeping the current file');
  }
  return schedule;
}

async function readExisting(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Scrape and write `file` (2-space JSON, trailing newline). */
export async function main({ file = DATA_FILE, log = console.log, ...scrapeOptions } = {}) {
  const existing = await readExisting(file);
  const schedule = await scrape({ existing, log, ...scrapeOptions });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(schedule, null, 2)}\n`);
  log(`wrote ${schedule.days.length} days, ${countSessions(schedule, '')} sessions, published through ${schedule.publishedThrough}`);
  return schedule;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`scrape failed: ${err.message}`);
    process.exitCode = 1;
  });
}
