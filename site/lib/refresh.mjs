// The refresh button's flow (spec section 8): start the update workflow through the GitHub API,
// follow its run, then read the new schedule.json straight from the API (GitHub Pages' CDN
// caches for 10 minutes and ignores ?t= query strings, so reading from Pages would be stale).

export const API = 'https://api.github.com';

/** kind: 'unauthorized' | 'forbidden' | 'network' | 'failed' | 'timeout'. `url` links to the run when known. */
export class RefreshError extends Error {
  constructor(kind, message, url = null) {
    super(message);
    this.name = 'RefreshError';
    this.kind = kind;
    this.url = url;
  }
}

const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs one refresh. Resolves with { schedule, extras }: the fresh schedule, and each of `extraPaths`
 * (repo paths such as the history files) parsed, or null if that one file couldn't be read.
 * onStatus({ phase: 'starting' | 'queued' | 'running', elapsedMs, url }) reports progress.
 */
export async function refresh({
  token,
  config,
  fetchImpl = (...args) => fetch(...args),
  sleep = wait,
  now = () => Date.now(),
  onStatus = () => {},
  pollMs = 5000,
  lookupMs = 30000,
  timeoutMs = 600000,
  extraPaths = [],
}) {
  const repo = `${API}/repos/${config.owner}/${config.repo}`;
  const call = async (url, init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        cache: 'no-store', // GitHub API responses carry Cache-Control: max-age=60; we need the latest state every call
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...init.headers,
        },
      });
    } catch {
      throw new RefreshError('network', 'אין חיבור ל־GitHub');
    }
    if (res.status === 401) throw new RefreshError('unauthorized', 'הטוקן פג תוקף או לא תקין');
    if (res.status === 403 || res.status === 404) throw new RefreshError('forbidden', 'לטוקן אין גישה');
    if (!res.ok) throw new RefreshError('network', `GitHub ענה ${res.status}`);
    return res;
  };

  const startedAt = now();
  onStatus({ phase: 'starting', elapsedMs: 0, url: null });

  const dispatched = await call(`${repo}/actions/workflows/${config.workflow}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: config.branch, return_run_details: true }),
  });
  // With return_run_details: true, GitHub answers 200 with the run id; without it, 204 with no body.
  let runId = dispatched.status === 200 ? (await dispatched.json().catch(() => null))?.workflow_run_id ?? null : null;

  while (!runId) {
    if (now() - startedAt > lookupMs) throw new RefreshError('failed', 'העדכון לא נמצא ב־GitHub');
    await sleep(3000);
    const list = await (await call(`${repo}/actions/workflows/${config.workflow}/runs?event=workflow_dispatch&per_page=5`)).json();
    const mine = (list.workflow_runs ?? [])
      .filter(r => Date.parse(r.created_at) >= startedAt - 60000) // allow for clock differences
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    runId = mine[0]?.id ?? null;
  }

  for (;;) {
    const run = await (await call(`${repo}/actions/runs/${runId}`)).json();
    if (run.status === 'completed') {
      if (run.conclusion === 'cancelled') throw new RefreshError('failed', 'העדכון בוטל כי התחיל עדכון אחר', run.html_url);
      if (run.conclusion !== 'success') throw new RefreshError('failed', 'העדכון נכשל', run.html_url);
      break;
    }
    const elapsedMs = now() - startedAt;
    if (elapsedMs > timeoutMs) throw new RefreshError('timeout', 'העדכון עדיין רץ', run.html_url);
    onStatus({ phase: QUEUED.has(run.status) ? 'queued' : 'running', elapsedMs, url: run.html_url });
    await sleep(pollMs);
  }

  const read = async path =>
    (await call(`${repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json' } })).json();
  const schedule = await read(config.dataPath);
  const extras = {};
  await Promise.all(extraPaths.map(async path => {
    try {
      extras[path] = await read(path);
    } catch {
      extras[path] = null; // the schedule refreshed; the page keeps its older copy of this file
    }
  }));
  return { schedule, extras };
}
