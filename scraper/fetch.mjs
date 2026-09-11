// Fetches the park's schedule, one 3-day window at a time (spec section 4).
import { addDays, toParkDate } from '../site/lib/time.mjs';

export const PARK_URL = 'https://www.srfparktlv.co.il/products/sessions-react/';
export const RETRY_WAITS_MS = [2000, 4000, 8000];
export const REQUEST_TIMEOUT_MS = 20000;

// Without X-Requested-With the park answers with a redirect to an "abuse" page.
const HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const windowUrl = fromIso => `${PARK_URL}?ajax=1&from_date=${encodeURIComponent(toParkDate(fromIso))}`;

async function fetchOnce(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`not JSON (starts with ${JSON.stringify(text.slice(0, 40))})`);
  }
  if (body?.success !== true || !Array.isArray(body.scheduler)) throw new Error('no success:true with a scheduler list');
  return body;
}

/** One window starting at `fromIso`, retried 3 times (2 s, 4 s, 8 s) before giving up. */
export async function fetchWindow(fromIso, { fetchImpl = fetch, sleep = wait, log = () => {} } = {}) {
  const url = windowUrl(fromIso);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url, fetchImpl);
    } catch (err) {
      if (attempt >= RETRY_WAITS_MS.length) throw new Error(`window ${fromIso}: ${err.message} (after ${attempt + 1} attempts)`);
      log(`window ${fromIso}: ${err.message}; retrying in ${RETRY_WAITS_MS[attempt] / 1000}s`);
      await sleep(RETRY_WAITS_MS[attempt]);
    }
  }
}

/** Consecutive windows from `today` until 2 in a row have no sessions and no close days (max 12). */
export async function fetchHorizon(today, { maxWindows = 12, ...options } = {}) {
  const windows = [];
  let emptyInARow = 0;
  for (let from = today; windows.length < maxWindows && emptyInARow < 2; from = addDays(from, 3)) {
    const w = await fetchWindow(from, options);
    windows.push(w);
    const hasData = w.scheduler.length > 0 || (w.close_days ?? []).length > 0;
    emptyInARow = hasData ? 0 : emptyInARow + 1;
  }
  return windows;
}
