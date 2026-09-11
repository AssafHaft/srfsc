import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../scraper/normalize.mjs';
import { fixtureWindow } from '../../scraper/test-support/fake-park.mjs';
import { groupBlocks, weekDates } from '../../site/lib/schedule.mjs';
import { escapeHtml, renderWeek, renderMonth, renderDay, renderLevelChips } from '../../site/lib/render.mjs';

const DATES = ['2026-09-10', '2026-09-13', '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28'];
const { schedule } = normalize(DATES.map(fixtureWindow), { today: '2026-09-10', fetchedAt: '2026-09-10T16:17:00+03:00' });
const ctx = (over = {}) => ({ today: '2026-09-10', now: '16:20', levels: new Set(), showPast: false, ...over });
const count = (html, needle) => html.split(needle).length - 1;
/** The HTML of the week block whose title starts with `titleStart`. */
const blockHtml = (html, titleStart) => {
  const at = html.indexOf(`title="${titleStart}`);
  assert.ok(at > 0, `no block titled ${titleStart}`);
  const from = html.lastIndexOf('<div class="blk', at);
  return html.slice(from, html.indexOf('</div></div>', at) + 12);
};

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('week: 7 day headers from today, full opening hours, hour labels', () => {
  const html = renderWeek(schedule, ctx());
  assert.equal(count(html, 'data-day="'), 7);
  assert.ok(html.includes('<button class="dh is-today" data-day="2026-09-10"><span class="dn">היום</span>'));
  assert.ok(html.includes('פתוח <span class="ltr num">06:00–14:00</span>')); // Friday 11.9
  assert.ok(html.includes('<div class="num">06:00</div>'));
  assert.ok(html.includes('<div class="num">22:00</div>')); // 14.9 ends at 23:00
});

test('week: one block per start/end/area with its time on top, and a now line on today', () => {
  const html = renderWeek(schedule, ctx());
  const expected = weekDates('2026-09-10').reduce((n, date) => n + groupBlocks(schedule.days.find(d => d.date === date)?.sessions ?? []).length, 0);
  assert.equal(count(html, '<div class="blk'), expected);
  assert.ok(html.includes('<span class="bt"><span class="ltr num">17:30–19:00</span></span>'));
  assert.equal(count(html, '<div class="now"'), 1);
  assert.match(blockHtml(html, '06:00–07:00 L6 Pro'), /class="blk past"/);
  assert.doesNotMatch(blockHtml(html, '16:00–17:00 L2'), /past/);
});

test('week: different sessions on the two reef sides share one line with a chip each', () => {
  const block = blockHtml(renderWeek(schedule, ctx()), '20:00–21:00 ריטריט');
  assert.equal(count(block, 'class="chip'), 2);
  assert.ok(block.includes('<span class="spot full">מלא</span>')); // the retreat is disabled
});

test('week: the level filter fades other levels', () => {
  const html = renderWeek(schedule, ctx({ levels: new Set([6]) }));
  assert.doesNotMatch(blockHtml(html, '06:00–07:00 L6 Pro'), /\boff\b/);
  assert.match(blockHtml(html, '16:00–17:00 L2'), /\boff\b/);
});

test('month: rolling weeks with closed, empty, unpublished and past days', () => {
  const html = renderMonth(schedule, ctx());
  assert.ok(html.includes('<h2 class="month-title">ספטמבר–אוקטובר 2026</h2>'));
  assert.equal(count(html, 'class="mc"') + count(html, 'class="mc '), 28); // cells, not the inner "mc-top"
  assert.equal(count(html, 'mc is-past'), 4); // 6–9.9
  assert.ok(html.includes('<button class="mc is-today" data-day="2026-09-10">'));
  assert.ok(html.includes('<span class="closed">סגור</span><span class="meta">יום כיפור</span>'));
  assert.equal(count(html, 'mc is-empty'), 1); // 20.9
  assert.equal(count(html, 'טרם פורסם'), 9); // 25.9–3.10
  assert.ok(html.includes('<span class="dd num">1.10</span>'));
  assert.ok(html.includes('<span class="hrs"><span class="ltr num">06:00–22:00</span></span>'));
});

test('day: today opens at now, with finished sessions behind a toggle', () => {
  const html = renderDay(schedule, '2026-09-10', ctx());
  assert.equal(count(html, '<span class="st num">'), 8);
  assert.ok(html.includes('הצגת 10 סשנים שכבר הסתיימו'));
  assert.equal(count(html, 'class="now-tag"'), 1);
  assert.ok(html.includes('<div class="open">פתוח <span class="ltr num">06:00–22:00</span></div>'));

  const all = renderDay(schedule, '2026-09-10', ctx({ showPast: true }));
  assert.equal(count(all, '<span class="st num">'), 18);
  assert.ok(all.includes('הסתרת 10 סשנים שכבר הסתיימו'));
});

test('day: other days show everything; closed and unpublished days explain themselves', () => {
  assert.doesNotMatch(renderDay(schedule, '2026-09-11', ctx()), /סשנים שכבר הסתיימו/);
  const closed = renderDay(schedule, '2026-09-21', ctx());
  assert.ok(closed.includes('סגור: יום כיפור') && closed.includes('הפארק סגור ביום הזה.'));
  assert.ok(renderDay(schedule, '2026-09-30', ctx()).includes('הלוח ליום הזה עוד לא פורסם.'));
});

test('park text never becomes markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const tiny = {
    fetchedAt: 'x', publishedThrough: '2026-09-10',
    days: [{ date: '2026-09-10', open: '08:00', close: '09:00', closed: null, sessions: [
      { id: 1, start: '08:00', end: '09:00', name: evil, level: 3, area: 'reef', side: 'right', capacity: 10, booked: 1, spotsLeft: 9, available: true },
    ] }],
  };
  for (const html of [renderWeek(tiny, ctx({ now: '07:00' })), renderDay(tiny, '2026-09-10', ctx({ now: '07:00' }))]) {
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  }
});

test('level chips show the saved filter', () => {
  const html = renderLevelChips(new Set([2]));
  assert.ok(html.includes('data-level="2" aria-pressed="true"'));
  assert.ok(html.includes('data-level="0" aria-pressed="false" aria-label="Bay"'));
});

test('month: the level filter fades other levels in the day strips', () => {
  const html = renderMonth(schedule, ctx({ levels: new Set([6]) }));
  assert.ok(html.includes('<i class="lv6"></i>'));
  assert.ok(html.includes('<i class="lv5 off"></i>'));
  assert.doesNotMatch(renderMonth(schedule, ctx()), /\boff\b/);
});

test('week: simultaneous Bay groups share one wrapping row of numbers', () => {
  const lesson = (id, side, spotsLeft, name) => ({ id, start: '18:30', end: '20:00', name, level: 0, area: 'bay', side, capacity: 24, booked: 24 - spotsLeft, spotsLeft, available: spotsLeft > 0 });
  const tiny = {
    fetchedAt: 'x', publishedThrough: '2026-09-10',
    days: [{ date: '2026-09-10', open: '18:30', close: '20:00', closed: null, sessions: [
      lesson(1, 'right', 10, 'שיעור גלישה למתחילים ב Bay - ילדים 11-16'),
      lesson(2, 'left', 11, 'שיעור גלישה למתחילים ב Bay - ילדים 7-10'),
      lesson(3, 'right', 24, 'שיעור גלישה למתחילים ב Bay - בוגרים מעל גיל 16'),
    ] }],
  };
  const html = renderWeek(tiny, ctx({ now: '07:00' }));
  assert.equal(count(html, 'class="bay-spots"'), 1);
  assert.ok(html.includes('<div class="bay-spots"><div class="sess"><span class="spot num">10</span></div><div class="sess"><span class="spot num">11</span></div><div class="sess"><span class="spot num">24</span></div></div>'));
});
