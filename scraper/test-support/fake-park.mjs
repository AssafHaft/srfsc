// Test helpers: a fetch() stand-in that serves the park windows saved in scraper/test/fixtures/.
// Lives outside scraper/test/ so `node --test` doesn't run it as a test file.
import { existsSync, readFileSync } from 'node:fs';

const FIXTURES = new URL('../test/fixtures/', import.meta.url);
export const EMPTY_WINDOW = { success: true, scheduler: [], close_days: [], dateArray: [] };

/** Minimal Response stand-in. `body` may be an object (sent as JSON) or a raw string. */
export const response = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** "…from_date=10%2F09%2F26" → "2026-09-10". */
export function isoFromUrl(url) {
  const [d, m, y] = new URL(url).searchParams.get('from_date').split('/');
  return `20${y}-${m}-${d}`;
}

/** The saved window starting at `iso` (e.g. "2026-09-10"), parsed. */
export const fixtureWindow = iso => JSON.parse(readFileSync(new URL(`window-${iso}.json`, FIXTURES), 'utf8'));

/** fetch() serving saved windows; dates without a fixture get an empty window. Records calls. */
export function fixtureFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const file = new URL(`window-${isoFromUrl(url)}.json`, FIXTURES);
    return response(existsSync(file) ? readFileSync(file, 'utf8') : EMPTY_WINDOW);
  };
  impl.calls = calls;
  return impl;
}

/** fetch() that answers each call with the next item of `replies` (a response or an Error to throw). */
export function scriptedFetch(replies) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

/** sleep() stand-in that records the requested waits instead of waiting. */
export function recordingSleep() {
  const waits = [];
  const impl = async ms => { waits.push(ms); };
  impl.waits = waits;
  return impl;
}
