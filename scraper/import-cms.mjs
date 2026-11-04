// CLI: imports the park's CMS "wave demand" export into site/data/history/ (CMS import spec sections
// 4 and 11). The first export set the coverage; each later one must start on or before the day after
// it ends, and may overlap it: days already imported pair with the rows we hold, hidden ones included,
// so nothing is counted twice. An export the coverage already holds is refused. --dry-run only prints
// the summary. Writes index.json before the month files to mark the import, so a failure mid-write is safe.
// Usage: node scraper/import-cms.mjs <file.xlsx> [--dry-run]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { addDays, israelIso, israelToday, monthsBetween } from '../site/lib/time.mjs';
import { mergeExport, parseExport, readXlsx } from './cms.mjs';
import { HISTORY_DIR, readIndex, readMonths, writeIndex, writeMonths } from './update-history.mjs';

/** How many negative ids earlier imports used: hidden rows are numbered -1, -2, … across imports. */
async function usedHiddenIds(dir, months) {
  const store = await readMonths(dir, months);
  return Object.values(store).flatMap(m => m.sessions).reduce((n, r) => Math.max(n, -r.id), 0);
}

/** The imports index.cms has recorded; an index from before follow-up imports holds just one. */
const importsOf = cms => cms?.imports ?? (cms ? [{ from: cms.from, to: cms.to, importedAt: cms.importedAt }] : []);

export async function importCms({ file, dir = HISTORY_DIR, dryRun = false, now = new Date(), log = console.log }) {
  const index = await readIndex(dir);
  const { rows, skipped } = parseExport(readXlsx(await readFile(file)));
  if (!rows.length) throw new Error('the export has no usable rows');
  const dates = rows.map(r => r.date).sort();
  const [first, last] = [dates[0], dates.at(-1)];
  const today = israelToday(now);
  if (last >= today) throw new Error(`the export runs to ${last}, which isn't over yet; export up to yesterday`);
  const prev = index?.cms ?? null;
  if (prev && first >= prev.from && last <= prev.to) {
    throw new Error(`already imported: ${first}..${last} is inside the imported ${prev.from}..${prev.to}`);
  }
  if (prev && (first > addDays(prev.to, 1) || last < addDays(prev.from, -1))) {
    throw new Error(`${first}..${last} leaves a gap next to the imported ${prev.from}..${prev.to}; export from ${addDays(prev.to, 1)} or earlier`);
  }

  const store = await readMonths(dir, monthsBetween(first, last));
  const usedIds = await usedHiddenIds(dir, index?.months ?? []);
  const { from, to, summary } = mergeExport(store, rows, { usedIds });
  const overlap = prev ? [from > prev.from ? from : prev.from, to < prev.to ? to : prev.to] : null;

  log(`read ${rows.length} rows ${from}..${to}; skipped ${JSON.stringify(skipped)}`);
  if (overlap && overlap[0] <= overlap[1]) log(`overlaps the imported ${prev.from}..${prev.to} on ${overlap[0]}..${overlap[1]}: those days are re-paired, not added`);
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
  const importedAt = israelIso(now);
  const cms = {
    from: prev && prev.from < from ? prev.from : from,
    to: prev && prev.to > to ? prev.to : to,
    importedAt,
    imports: [...importsOf(prev), { from, to, importedAt }],
  };
  // Write index first to mark the import, so a failure after this point is refused on retry
  await writeIndex(dir, { ...index, months: allMonths, cms });
  // Write the month files; if this fails, the index already marks the import
  try {
    await writeMonths(dir, store);
  } catch (err) {
    throw new Error(`${err.message} — index.json already marks the import; restore site/data/history with git before running it again`);
  }
  log(`wrote ${toWrite.length} months and index.json; CMS data now covers ${cms.from}..${cms.to}`);
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
