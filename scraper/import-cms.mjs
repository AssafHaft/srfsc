// CLI: the one-time import of the park's CMS "wave demand" export into site/data/history/
// (CMS import spec section 4). It refuses to run twice; --dry-run only prints the summary.
// Writes index.json before the month files to mark the import, so a failure mid-write is safe.
// Usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { israelIso, monthsBetween } from '../site/lib/time.mjs';
import { mergeExport, parseExport, readXlsx } from './cms.mjs';
import { HISTORY_DIR, readIndex, readMonths, writeIndex, writeMonths } from './update-history.mjs';

export async function importCms({ file, dir = HISTORY_DIR, dryRun = false, now = new Date(), log = console.log }) {
  const index = await readIndex(dir);
  if (index?.cms) throw new Error(`already imported on ${index.cms.importedAt.slice(0, 10)}`);
  const { rows, skipped } = parseExport(readXlsx(await readFile(file)));
  if (!rows.length) throw new Error('the export has no usable rows');
  const dates = rows.map(r => r.date).sort();
  const store = await readMonths(dir, monthsBetween(dates[0], dates.at(-1)));
  const { from, to, summary } = mergeExport(store, rows);

  log(`read ${rows.length} rows ${from}..${to}; skipped ${JSON.stringify(skipped)}`);
  log(`paired ${summary.pairs}; booked changed on ${summary.changed} (${summary.netPeople > 0 ? '+' : ''}${summary.netPeople} people); ${summary.notInExport} of ours not in the export`);
  log(`hidden: ${summary.hidden} rows, ${summary.hiddenPeople} bookings`);
  for (const [label, c] of Object.entries(summary.categories).sort((a, b) => b[1].people - a[1].people)) {
    log(`  ${label}: ${c.rows} rows, ${c.people} bookings`);
  }
  if (dryRun) {
    log('dry run: nothing written');
    return summary;
  }
  // Compute which months will be written (those with sessions or closed days)
  const toWrite = Object.values(store).filter(m => m.sessions.length || m.closed.length).map(m => m.month);
  // Union with existing months and sort
  const allMonths = [...new Set([...(index?.months ?? []), ...toWrite])].sort();
  // Write index first to mark the import, so a failure after this point is refused on retry
  await writeIndex(dir, { ...index, months: allMonths, cms: { from, to, importedAt: israelIso(now) } });
  // Write the month files; if this fails, the index already marks the import
  try {
    await writeMonths(dir, store);
  } catch (err) {
    throw new Error(`${err.message} — index.json already marks the import; restore site/data/history with git before running it again`);
  }
  log(`wrote ${toWrite.length} months and index.json`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]');
    process.exitCode = 1;
  } else {
    importCms({ file, dryRun: args.includes('--dry-run') }).catch(err => {
      console.error(`CMS import failed: ${err.message}`);
      process.exitCode = 1;
    });
  }
}
