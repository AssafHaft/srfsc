// Page glue: loads the data, keeps UI state, renders the schedule and analysis tabs, runs the refresh button.
import { CONFIG, PRICES } from './config.js';
import { HE_DAYS, addDays, dayOfWeek, formatAge, israelTime, israelToday, monthsBetween, shortDate } from './lib/time.mjs';
import { isStale } from './lib/stale.mjs';
import { RefreshError, refresh } from './lib/refresh.mjs';
import { renderDay, renderLevelChips, renderMonth, renderWeek } from './lib/render.mjs';
import { DEFAULT_PERIOD, PERIODS, expandMonth, monthsNeeded, periodRange } from './lib/history.mjs';
import { analyse } from './lib/analytics.mjs';
import { insights } from './lib/insights.mjs';
import { compareNote, renderAnalysis, renderPeriods } from './lib/render-analysis.mjs';

const TOKEN_KEY = 'srfsc.githubToken';
const LEVELS_KEY = 'srfsc.levels';
const PERIOD_KEY = 'srfsc.period';
const VIEWS = ['day', 'week', 'month'];
const ANALYSIS = 'analysis';
const HISTORY_URL = 'data/history/';
const $ = selector => document.querySelector(selector);

// localStorage can throw (private mode, blocked storage); the page must still work.
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* ignore */ }
  },
};

function initialView() {
  const fromHash = location.hash.slice(1);
  if (VIEWS.includes(fromHash)) return fromHash;
  return window.matchMedia('(max-width: 719px)').matches ? 'day' : 'week';
}

function savedLevels() {
  try {
    return new Set(JSON.parse(store.get(LEVELS_KEY) ?? '[]').map(Number));
  } catch {
    return new Set();
  }
}

function savedPeriod() {
  const period = store.get(PERIOD_KEY);
  return period && Object.hasOwn(PERIODS, period) ? period : DEFAULT_PERIOD;
}

const state = {
  schedule: null,
  tab: location.hash === `#${ANALYSIS}` ? ANALYSIS : 'schedule',
  view: initialView(),
  day: null,
  levels: savedLevels(),
  showPast: false,
  refreshing: false,
  period: savedPeriod(),
  heatMetric: 'occupancy',
  trendMetric: 'occupancy',
  history: { index: null, months: new Map(), status: 'idle' }, // status: idle | loading | ready | error
};

function context() {
  const now = new Date();
  return { today: israelToday(now), now: israelTime(now), levels: state.levels, showPast: state.showPast };
}

function renderFreshness() {
  const { fetchedAt, publishedThrough } = state.schedule;
  $('#fresh-main').textContent = `עודכן ${formatAge(fetchedAt)}`;
  $('#fresh-sub').textContent = publishedThrough
    ? `הלוח פורסם עד יום ${HE_DAYS[dayOfWeek(publishedThrough)]}, ${shortDate(publishedThrough)}`
    : 'הפארק עוד לא פרסם סשנים';
  $('#stale').hidden = !isStale(fetchedAt);
}

// ---------- analysis tab ----------

const currentRange = () => periodRange(state.period, israelToday(), state.history.index?.first ?? null);

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Month files the current period needs that the history has and we haven't loaded. */
function missingMonths() {
  const { index, months } = state.history;
  if (!index) return null;
  return monthsNeeded(currentRange()).filter(m => index.months.includes(m) && !months.has(m));
}

async function loadHistory() {
  const h = state.history;
  h.status = 'loading';
  try {
    h.index ??= await fetchJson(`${HISTORY_URL}index.json`);
    const missing = missingMonths();
    const files = await Promise.all(missing.map(m => fetchJson(`${HISTORY_URL}${m}.json`)));
    files.forEach((file, i) => h.months.set(missing[i], expandMonth(file)));
    h.status = 'ready';
  } catch {
    h.status = 'error';
  }
  render();
}

function renderAnalysisTab() {
  $('#compare-note').textContent = '';
  const h = state.history;
  $('#history-error').hidden = h.status !== 'error';
  if (h.status === 'error') {
    $('#view').innerHTML = '';
    return;
  }
  const missing = missingMonths();
  if (missing === null || missing.length) {
    $('#view').innerHTML = '<p class="empty">טוען היסטוריה…</p>';
    if (h.status !== 'loading') loadHistory();
    return;
  }
  const range = currentRange();
  const months = [...h.months.values()];
  const model = analyse({
    rows: months.flatMap(m => m.sessions),
    closed: months.flatMap(m => m.closed),
    range,
    levels: state.levels,
    prices: PRICES,
    schedule: state.schedule,
    now: new Date(),
    index: h.index,
  });
  $('#compare-note').innerHTML = compareNote(range);
  $('#view').innerHTML = renderAnalysis(model, insights(model), { heatMetric: state.heatMetric, trendMetric: state.trendMetric });
}

/** History files the refresh button re-reads: the index and the months holding the last 3 days' final counts. */
function historyPaths() {
  const today = israelToday();
  const months = monthsBetween(addDays(today, -3), addDays(today, -1));
  return [`${CONFIG.historyPath}/index.json`, ...months.map(m => `${CONFIG.historyPath}/${m}.json`)];
}

/** Takes the history files a refresh brought back. Returns false if any of them failed. */
function takeHistory(extras) {
  const h = state.history;
  let ok = true;
  for (const [path, file] of Object.entries(extras)) {
    if (file === null) ok = false;
    else if (path.endsWith('/index.json')) h.index = file;
    else h.months.set(file.month, expandMonth(file));
  }
  return ok;
}

// ---------- rendering ----------

function render() {
  if (!state.schedule) return;
  const ctx = context();
  if (!state.day || state.day < ctx.today) state.day = ctx.today;
  const analysis = state.tab === ANALYSIS;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#view-seg').hidden = analysis;
  $('#period-seg').hidden = !analysis;
  $('#compare-note').hidden = !analysis;
  $('#period-seg').innerHTML = renderPeriods(state.period);
  $('#levels').innerHTML = renderLevelChips(state.levels);
  if (analysis) {
    renderAnalysisTab();
  } else {
    $('#history-error').hidden = true;
    $('#view').innerHTML = state.view === 'week' ? renderWeek(state.schedule, ctx)
      : state.view === 'month' ? renderMonth(state.schedule, ctx)
        : renderDay(state.schedule, state.day, ctx);
  }
  renderFreshness();
}

async function load() {
  try {
    const res = await fetch('data/schedule.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.schedule = await res.json();
    $('#load-error').hidden = true;
    render();
  } catch {
    $('#load-error').hidden = false;
    $('#view').innerHTML = '';
  }
}

function setView(view) {
  state.view = view;
  state.tab = 'schedule';
  history.replaceState(null, '', `#${view}`);
}

function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab === ANALYSIS ? ANALYSIS : state.view}`);
}

// ---------- refresh button ----------

const clockText = ms => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function setButton(label, busy) {
  const button = $('#refresh');
  button.classList.toggle('is-busy', busy);
  button.querySelector('span').textContent = label;
}

function showMessage(text, url = null) {
  const box = $('#refresh-msg');
  box.replaceChildren(text);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'לפרטים ב־GitHub';
    box.append(' ', link);
  }
  box.hidden = !text;
}

const HINTS = {
  forbidden: 'בדקו שהטוקן מוגבל למאגר srfsc עם ההרשאות Actions: Read and write ו־Contents: Read-only.',
  network: 'נסו שוב בעוד רגע.',
  timeout: 'אפשר ללחוץ שוב על ״עדכון עכשיו״ בעוד כמה דקות.',
};

async function startRefresh() {
  if (state.refreshing) return;
  const token = store.get(TOKEN_KEY);
  if (!token) {
    openTokenPanel();
    return;
  }
  state.refreshing = true;
  showMessage('');
  setButton('מתחיל…', true);
  try {
    const { schedule, extras } = await refresh({
      token,
      config: CONFIG,
      extraPaths: historyPaths(),
      onStatus: ({ phase, elapsedMs }) =>
        setButton(phase === 'queued' ? 'ממתין בתור' : phase === 'running' ? `מעדכן… ${clockText(elapsedMs)}` : 'מתחיל…', true),
    });
    state.schedule = schedule;
    if (!takeHistory(extras)) showMessage('הלוח עודכן, הניתוח לא. נסו שוב בעוד כמה דקות.');
    $('#load-error').hidden = true;
    render();
  } catch (err) {
    if (err instanceof RefreshError && err.kind === 'unauthorized') {
      store.set(TOKEN_KEY, null);
      openTokenPanel('הטוקן פג תוקף או לא תקין. צרו טוקן חדש והדביקו אותו כאן.');
    } else if (err instanceof RefreshError) {
      showMessage(`${err.message}. ${HINTS[err.kind] ?? ''}`.trim(), err.url);
    } else {
      showMessage('העדכון נכשל מסיבה לא צפויה. נסו שוב.');
    }
  } finally {
    state.refreshing = false;
    setButton('עדכון עכשיו', false);
  }
}

function openTokenPanel(error = '') {
  $('#token-error').textContent = error;
  $('#token-error').hidden = !error;
  $('#token-input').value = '';
  $('#token-panel').showModal();
}

function saveToken() {
  const token = $('#token-input').value.trim();
  if (!token) {
    $('#token-error').textContent = 'הדביקו את הטוקן לפני השמירה.';
    $('#token-error').hidden = false;
    return;
  }
  store.set(TOKEN_KEY, token);
  $('#token-panel').close();
  startRefresh();
}

// ---------- events ----------

document.addEventListener('click', event => {
  const el = event.target.closest('[data-tab],[data-view],[data-day],[data-level],[data-step],[data-toggle-past],[data-period],[data-heat-metric],[data-trend-metric],[data-jump],[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'refresh') return startRefresh();
  if (d.action === 'reload') return load();
  if (d.action === 'save-token') return saveToken();
  if (d.action === 'close-token') return $('#token-panel').close();
  if (d.jump) return document.getElementById(`a-${d.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!state.schedule) return;
  if (d.action === 'reload-history') {
    state.history.status = 'idle';
  } else if (d.tab) {
    setTab(d.tab);
  } else if (d.view) {
    setView(d.view);
  } else if (d.day) {
    state.day = d.day;
    state.showPast = false;
    setView('day');
  } else if (d.level !== undefined) {
    const level = Number(d.level);
    if (state.levels.has(level)) state.levels.delete(level);
    else state.levels.add(level);
    store.set(LEVELS_KEY, JSON.stringify([...state.levels]));
  } else if (d.step) {
    const next = addDays(state.day, Number(d.step));
    const last = state.schedule.publishedThrough ?? context().today;
    if (next < context().today || next > last) return;
    state.day = next;
    state.showPast = false;
  } else if ('togglePast' in d) {
    state.showPast = !state.showPast;
  } else if (d.period) {
    state.period = d.period;
    store.set(PERIOD_KEY, d.period);
  } else if (d.heatMetric) {
    state.heatMetric = d.heatMetric;
  } else if (d.trendMetric) {
    state.trendMetric = d.trendMetric;
  }
  render();
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  if (hash === ANALYSIS && state.tab !== ANALYSIS) {
    state.tab = ANALYSIS;
    render();
  } else if (VIEWS.includes(hash) && (hash !== state.view || state.tab !== 'schedule')) {
    state.view = hash;
    state.tab = 'schedule';
    render();
  }
});

function tick() {
  if (!state.schedule) return;
  if (state.tab === ANALYSIS) return renderFreshness(); // the analysis doesn't change by the minute; keep the page still
  const scrollLeft = document.querySelector('.week-scroll')?.scrollLeft;
  render();
  const scroller = document.querySelector('.week-scroll');
  if (scrollLeft !== undefined && scroller) scroller.scrollLeft = scrollLeft;
}

setInterval(tick, 60000); // keeps "now", finished sessions and "updated N minutes ago" current
load();
