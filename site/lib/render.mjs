// HTML for the week, month and day views (spec sections 6–7). Pure functions returning strings.
// Everything that comes from the park is escaped before it reaches the HTML.
import { HE_DAYS, HE_DAYS_SHORT, dayOfWeek, minutes, shortDate } from './time.mjs';
import {
  dayRows, daySummary, displayName, groupBlocks, hourRange, isNow, isPast,
  layoutBlocks, monthDates, monthTitle, reefSides, weekDates,
} from './schedule.mjs';

export const HOUR_PX = 56;
export const LEVELS = [0, 1, 2, 3, 4, 5, 6];

export const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cls = (...names) => names.filter(Boolean).join(' ');
const range = (a, b) => `<span class="ltr num">${a}–${b}</span>`;
const dayOf = (schedule, date) => schedule.days.find(d => d.date === date);
const unpublished = (schedule, date) => !schedule.publishedThrough || date > schedule.publishedThrough;
const filteredOut = (sessions, levels) => levels.size > 0 && sessions.every(s => !levels.has(s.level));

export const chip = level => `<span class="chip lv${level}">${level === 0 ? 'Bay' : `L${level}`}</span>`;

export function spot(spotsLeft) {
  if (spotsLeft === null || spotsLeft === undefined) return '<span class="spot none">–</span>';
  if (spotsLeft === 0) return '<span class="spot full">מלא</span>';
  return `<span class="spot num${spotsLeft <= 3 ? ' few' : ''}">${spotsLeft}</span>`;
}

const pier = (right, left) => `<span class="pier">${spot(right)}<i class="pier-line"></i>${spot(left)}</span>`;

const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

/** The level filter buttons (Bay, L1–L6). */
export function renderLevelChips(levels) {
  const buttons = LEVELS.map(l =>
    `<button class="lv-toggle" data-level="${l}" aria-pressed="${levels.has(l)}" aria-label="${l ? `רמה ${l}` : 'Bay'}">${chip(l)}</button>`);
  return `<span class="levels-label">סינון לפי רמה</span>${buttons.join('')}`;
}

function openLine(schedule, date) {
  const day = dayOf(schedule, date);
  if (day?.closed) return 'סגור';
  if (day?.open) return `פתוח ${range(day.open, day.close)}`;
  return unpublished(schedule, date) ? 'טרם פורסם' : 'אין סשנים';
}

// ---------- week ----------

function weekBlock(block, date, fromHour, ctx) {
  const top = ((minutes(block.start) - fromHour * 60) / 60) * HOUR_PX + 2;
  const height = ((minutes(block.end) - minutes(block.start)) / 60) * HOUR_PX - 4;
  const position = `inset-inline-start:calc(${block.x0}% + 3px);inset-inline-end:calc(${100 - block.x1}% + 3px)`;
  let lines;
  if (block.area === 'bay') {
    lines = `<div class="bay-spots">${block.sessions.map(s => `<div class="sess">${spot(s.spotsLeft)}</div>`).join('')}</div>`;
  } else {
    const { right, left, shared } = reefSides(block);
    lines = shared
      ? `<div class="sess">${chip((right ?? left).level)}${pier(right?.spotsLeft, left?.spotsLeft)}</div>`
      : `<div class="sess">${chip(right.level)}${spot(right.spotsLeft)}<i class="pier-line"></i>${chip(left.level)}${spot(left.spotsLeft)}</div>`;
  }
  const past = block.sessions.every(s => isPast(s, date, ctx.today, ctx.now));
  const title = `${block.start}–${block.end} ${block.sessions.map(s => s.name).join(' / ')}`;
  const classes = cls('blk', block.area === 'bay' && 'bay', past && 'past', filteredOut(block.sessions, ctx.levels) && 'off');
  return `<div class="${classes}" style="top:${top}px;height:${height}px;${position}" title="${escapeHtml(title)}"><span class="bt">${range(block.start, block.end)}</span>${lines}</div>`;
}

function legend() {
  return `<div class="legend">
    <span><span class="sess">${chip(5)}${pier(8, 6)}</span>מקומות פנויים בריף ימין ובריף שמאל</span>
    <span>${spot(2)}נותרו מקומות אחרונים</span>
    <span>${spot(0)}אין מקומות פנויים</span>
    <span><i class="bay-swatch"></i>בלוק חולי הוא שיעור ב־Bay</span>
    <span>גובה הבלוק הוא משך הסשן</span>
  </div>`;
}

/** ctx: { today: "YYYY-MM-DD", now: "HH:MM", levels: Set<number>, showPast: boolean } */
export function renderWeek(schedule, ctx) {
  const dates = weekDates(ctx.today);
  const days = dates.map(d => dayOf(schedule, d));
  const { from, to } = hourRange(days);
  const hours = to - from;
  let html = '<div class="week-scroll"><div class="week"><div class="corner"></div>';
  for (const date of dates) {
    const today = date === ctx.today;
    html += `<button class="${cls('dh', today && 'is-today')}" data-day="${date}"><span class="dn">${today ? 'היום' : HE_DAYS[dayOfWeek(date)]}</span><span class="dd num">${shortDate(date)}</span><span class="hrs">${openLine(schedule, date)}</span></button>`;
  }
  html += `<div class="hours">${Array.from({ length: hours }, (_, i) => `<div class="num">${String(from + i).padStart(2, '0')}:00</div>`).join('')}</div>`;
  dates.forEach((date, i) => {
    const today = date === ctx.today;
    let column = Array.from({ length: hours }, (_, h) => `<i class="gl" style="top:${h * HOUR_PX}px"></i>`).join('');
    column += layoutBlocks(groupBlocks(days[i]?.sessions ?? [])).map(b => weekBlock(b, date, from, ctx)).join('');
    const nowMinutes = minutes(ctx.now);
    if (today && nowMinutes >= from * 60 && nowMinutes <= to * 60) {
      column += `<div class="now" style="top:${((nowMinutes - from * 60) / 60) * HOUR_PX}px"><span>עכשיו</span></div>`;
    }
    html += `<div class="${cls('col', today && 'is-today')}" style="height:${hours * HOUR_PX}px">${column}</div>`;
  });
  return `${html}</div></div>${legend()}`;
}

// ---------- month ----------

export function renderMonth(schedule, ctx) {
  const dates = monthDates(ctx.today, schedule.publishedThrough);
  let html = `<h2 class="month-title">${monthTitle(dates)}</h2><div class="month">`;
  html += HE_DAYS.map((name, i) => `<div class="mh"><span class="l">${name}</span><span class="s">${HE_DAYS_SHORT[i]}</span></div>`).join('');
  for (const date of dates) {
    const day = dayOf(schedule, date);
    const today = date === ctx.today;
    const hasSessions = (day?.sessions.length ?? 0) > 0;
    let kind = '';
    let body = '';
    if (date < ctx.today) {
      kind = 'is-past';
    } else if (day?.closed) {
      kind = 'is-closed';
      body = `<span class="closed">סגור</span><span class="meta">${escapeHtml(day.closed)}</span>`;
    } else if (unpublished(schedule, date)) {
      kind = 'is-unpub';
      body = '<span class="meta">טרם פורסם</span>';
    } else if (hasSessions) {
      const { freeSpots, levels } = daySummary(day);
      body = `<span class="hrs">${range(day.open, day.close)}</span><span class="strip">${levels.map(l => `<i class="${cls(`lv${l}`, ctx.levels.size > 0 && !ctx.levels.has(l) && 'off')}"></i>`).join('')}</span><span class="free num">${freeSpots} פנויים</span>`;
    } else {
      kind = 'is-empty';
      body = '<span class="meta">אין סשנים</span>';
    }
    const label = date.endsWith('-01') ? shortDate(date) : String(Number(date.slice(8)));
    const top = `<span class="mc-top"><span class="dd num">${label}</span>${today ? '<span class="tag">היום</span>' : ''}</span>`;
    const classes = cls('mc', kind, today && 'is-today');
    html += date >= ctx.today && hasSessions
      ? `<button class="${classes}" data-day="${date}">${top}${body}</button>`
      : `<div class="${classes}">${top}${body}</div>`;
  }
  return `${html}</div>`;
}

// ---------- day ----------

function sideCell(session, label) {
  if (!session) return `<span class="side"><span class="side-l">${label}</span><span class="spot none">–</span></span>`;
  const used = session.capacity ? Math.round(((session.capacity - session.spotsLeft) / session.capacity) * 100) : 100;
  return `<span class="side"><span class="side-l">${label}</span><span class="bar"><i class="lv${session.level}" style="width:${Math.max(0, Math.min(100, used))}%"></i></span>${spot(session.spotsLeft)}</span>`;
}

function dayRow(row, date, ctx) {
  const name = displayName(row.main.name);
  const now = isNow(row, date, ctx.today, ctx.now);
  const sessions = row.area === 'bay' ? [row.main] : [row.right, row.left].filter(Boolean);
  const sides = row.area === 'bay'
    ? `<span class="sides bay">${sideCell(row.main, 'Bay')}</span>`
    : `<span class="sides">${sideCell(row.right, 'ימין')}${sideCell(row.left, 'שמאל')}</span>`;
  const classes = cls('row', isPast(row, date, ctx.today, ctx.now) && 'past', now && 'is-now', filteredOut(sessions, ctx.levels) && 'off');
  return `<div class="${classes}"><span class="time"><span class="st num">${row.start}</span><span class="en">עד <span class="num">${row.end}</span></span>${now ? '<span class="now-tag">עכשיו</span>' : ''}</span>${chip(row.main.level)}<span class="name">${escapeHtml(name.title)}${name.note ? `<small>${escapeHtml(name.note)}</small>` : ''}</span>${sides}</div>`;
}

export function renderDay(schedule, date, ctx) {
  const day = dayOf(schedule, date);
  const today = date === ctx.today;
  const rows = dayRows(day?.sessions ?? []);
  const past = rows.filter(r => isPast(r, date, ctx.today, ctx.now));
  const shown = ctx.showPast ? rows : rows.filter(r => !past.includes(r));

  const open = day?.closed ? `סגור: ${escapeHtml(day.closed)}`
    : day?.open ? `פתוח ${range(day.open, day.close)}`
      : unpublished(schedule, date) ? 'הלוח עוד לא פורסם' : 'אין סשנים ביום הזה';
  const free = rows.length ? `<div class="sub num">${daySummary(day).freeSpots} מקומות פנויים</div>` : '';
  const toggle = past.length
    ? `<button class="past-toggle" data-toggle-past>${ctx.showPast ? 'הסתרת' : 'הצגת'} ${past.length} סשנים שכבר הסתיימו</button>`
    : '';
  let html = `<div class="day-head"><div>${today ? '<div class="kicker">היום</div>' : ''}<h2 class="dd">${HE_DAYS[dayOfWeek(date)]} <span class="num">${shortDate(date)}</span></h2><div class="open">${open}</div>${free}${toggle}</div>`
    + `<div class="nav"><button data-step="-1" aria-label="היום הקודם">${CHEVRON_RIGHT}</button><button data-step="1" aria-label="היום הבא">${CHEVRON_LEFT}</button></div></div>`;

  if (!rows.length) {
    const why = day?.closed ? 'הפארק סגור ביום הזה.' : unpublished(schedule, date) ? 'הלוח ליום הזה עוד לא פורסם.' : 'אין סשנים ביום הזה.';
    return `${html}<p class="empty">${why}</p>`;
  }
  html += '<div class="list"><div class="row head" aria-hidden="true"><span></span><span></span><span></span><span class="sides"><span>ריף ימין</span><span>ריף שמאל</span></span></div>';
  html += shown.map(r => dayRow(r, date, ctx)).join('');
  return `${html}</div>`;
}
