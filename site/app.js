// Page glue: loads the data, keeps UI state, renders the views and runs the refresh button.
import { CONFIG } from './config.js';
import { HE_DAYS, addDays, dayOfWeek, formatAge, israelTime, israelToday, shortDate } from './lib/time.mjs';
import { isStale } from './lib/stale.mjs';
import { RefreshError, refresh } from './lib/refresh.mjs';
import { renderDay, renderLevelChips, renderMonth, renderWeek } from './lib/render.mjs';

const TOKEN_KEY = 'srfsc.githubToken';
const LEVELS_KEY = 'srfsc.levels';
const VIEWS = ['day', 'week', 'month'];
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
  return window.matchMedia('(max-width: 720px)').matches ? 'day' : 'week';
}

function savedLevels() {
  try {
    return new Set(JSON.parse(store.get(LEVELS_KEY) ?? '[]').map(Number));
  } catch {
    return new Set();
  }
}

const state = { schedule: null, view: initialView(), day: null, levels: savedLevels(), showPast: false, refreshing: false };

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

function render() {
  if (!state.schedule) return;
  const ctx = context();
  if (!state.day || state.day < ctx.today) state.day = ctx.today;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#levels').innerHTML = renderLevelChips(state.levels);
  $('#view').innerHTML = state.view === 'week' ? renderWeek(state.schedule, ctx)
    : state.view === 'month' ? renderMonth(state.schedule, ctx)
      : renderDay(state.schedule, state.day, ctx);
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
  history.replaceState(null, '', `#${view}`);
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
  timeout: 'הלוח יתעדכן כשהריצה תסתיים.',
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
    state.schedule = await refresh({
      token,
      config: CONFIG,
      onStatus: ({ phase, elapsedMs }) =>
        setButton(phase === 'queued' ? 'ממתין בתור' : phase === 'running' ? `מעדכן… ${clockText(elapsedMs)}` : 'מתחיל…', true),
    });
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
  const el = event.target.closest('[data-view],[data-day],[data-level],[data-step],[data-toggle-past],[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'refresh') return startRefresh();
  if (d.action === 'reload') return load();
  if (d.action === 'save-token') return saveToken();
  if (d.action === 'close-token') return $('#token-panel').close();
  if (!state.schedule) return;
  if (d.view) {
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
  }
  render();
});

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (VIEWS.includes(view) && view !== state.view) {
    state.view = view;
    render();
  }
});

setInterval(render, 60000); // keeps "now", finished sessions and "updated N minutes ago" current
load();
