import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refresh, RefreshError, API } from '../../site/lib/refresh.mjs';

const config = { owner: 'AssafHaft', repo: 'srfsc', workflow: 'update.yml', branch: 'main', dataPath: 'site/data/schedule.json' };
const REPO = `${API}/repos/AssafHaft/srfsc`;
const SCHEDULE = { fetchedAt: '2026-09-10T16:30:00+03:00', publishedThrough: '2026-09-24', days: [] };

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake clock: sleep() moves time forward instantly. */
function clock(start = Date.parse('2026-09-10T13:30:00Z')) {
  let t = start;
  return { now: () => t, sleep: async ms => { t += ms; } };
}

/**
 * Fake GitHub API. `runs` is the sequence of run states returned by GET /actions/runs/:id
 * (the last one repeats). `dispatch` is the dispatch response.
 */
function fakeGitHub({ dispatch = json({ workflow_run_id: 42, run_url: 'x', html_url: 'https://github.com/run/42' }), runs, lists = [], content = json(SCHEDULE) }) {
  const calls = [];
  let runPoll = 0;
  let listPoll = 0;
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/dispatches')) return dispatch;
    if (url.includes('/runs?')) return json(lists[Math.min(listPoll++, lists.length - 1)]);
    if (url.startsWith(`${REPO}/actions/runs/`)) return json(runs[Math.min(runPoll++, runs.length - 1)]);
    if (url.startsWith(`${REPO}/contents/`)) return content;
    throw new Error(`unexpected ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const run = (status, conclusion = null) => ({ id: 42, status, conclusion, html_url: 'https://github.com/run/42' });

test('follows the returned run id, reports progress, then reads the file from the API', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('queued'), run('in_progress'), run('completed', 'success')] });
  const phases = [];
  const result = await refresh({ token: 'tok', config, fetchImpl, ...clock(), onStatus: s => phases.push(s.phase) });

  assert.deepEqual(result, SCHEDULE);
  assert.deepEqual(phases, ['starting', 'queued', 'running']);
  const [dispatch] = fetchImpl.calls;
  assert.equal(dispatch.url, `${REPO}/actions/workflows/update.yml/dispatches`);
  assert.equal(dispatch.init.method, 'POST');
  assert.equal(dispatch.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' });
  const read = fetchImpl.calls.at(-1);
  assert.equal(read.url, `${REPO}/contents/site/data/schedule.json?ref=main`);
  assert.equal(read.init.headers.Accept, 'application/vnd.github.raw+json');
});

test('with a 204 dispatch, finds the new run in the run list', async () => {
  const c = clock();
  const created = new Date(c.now() + 2000).toISOString();
  const fetchImpl = fakeGitHub({
    dispatch: json(null, 204),
    lists: [{ workflow_runs: [] }, { workflow_runs: [{ id: 41, created_at: '2026-09-10T10:00:00Z' }, { id: 42, created_at: created }] }],
    runs: [run('completed', 'success')],
  });
  await refresh({ token: 'tok', config, fetchImpl, ...c });
  assert.ok(fetchImpl.calls.some(x => x.url === `${REPO}/actions/runs/42`));
});

test('gives up looking for the run after 30 seconds', async () => {
  const fetchImpl = fakeGitHub({ dispatch: json(null, 204), lists: [{ workflow_runs: [] }], runs: [] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => e.kind === 'failed');
});

test('a failed run links to its log', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('in_progress'), run('completed', 'failure')] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => {
    assert.ok(e instanceof RefreshError);
    assert.equal(e.kind, 'failed');
    assert.equal(e.url, 'https://github.com/run/42');
    return true;
  });
});

test('stops waiting after 10 minutes', async () => {
  const fetchImpl = fakeGitHub({ runs: [run('in_progress')] });
  await assert.rejects(refresh({ token: 'tok', config, fetchImpl, ...clock() }), e => e.kind === 'timeout' && e.url === 'https://github.com/run/42');
});

test('token and network problems have their own kinds', async () => {
  const c = clock();
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 401), runs: [] }), ...c }), e => e.kind === 'unauthorized');
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 404), runs: [] }), ...c }), e => e.kind === 'forbidden');
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: fakeGitHub({ dispatch: json({}, 403), runs: [] }), ...c }), e => e.kind === 'forbidden');
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(refresh({ token: 'x', config, fetchImpl: offline, ...c }), e => e.kind === 'network');
});
