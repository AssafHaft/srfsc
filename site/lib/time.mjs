// Israel-time and date helpers. Shared by the page (site/) and the scraper (scraper/).
// Dates are ISO strings ("2026-09-10"), times are "HH:MM", all in Asia/Jerusalem.

export const TZ = 'Asia/Jerusalem';

export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const HE_DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** Wall-clock parts in Israel for an instant: { date, time, seconds, offset }. */
export function israelParts(now = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, seconds: p.second, offset };
}

/** Today's date in Israel, e.g. "2026-09-10". */
export const israelToday = (now = new Date()) => israelParts(now).date;

/** Current Israel wall-clock time, e.g. "16:20". */
export const israelTime = (now = new Date()) => israelParts(now).time;

/** ISO timestamp with the Israel offset, e.g. "2026-09-10T16:17:05+03:00". */
export function israelIso(now = new Date()) {
  const p = israelParts(now);
  return `${p.date}T${p.time}:${p.seconds}${p.offset}`;
}

/** Calendar arithmetic on ISO dates (noon UTC avoids any DST edge). */
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Whole days from a to b (b later → positive). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** The park API's date format: "10/09/26". */
export const toParkDate = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

/** Short display date: "10.9", "1.10". */
export const shortDate = iso => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

/** "17:30" → 1050. */
export const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** How long ago, in Hebrew: "עכשיו", "לפני 12 דקות", "לפני שעתיים", "לפני 3 ימים". */
export function formatAge(fromIso, now = new Date()) {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
  if (mins < 1) return 'עכשיו';
  if (mins === 1) return 'לפני דקה';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'לפני שעה';
  if (hours === 2) return 'לפני שעתיים';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'לפני יום';
  if (days === 2) return 'לפני יומיים';
  return `לפני ${days} ימים`;
}

/** Every month touched by from..to: monthsBetween("2025-11-20", "2026-01-03") → ["2025-11", "2025-12", "2026-01"]. */
export function monthsBetween(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return months;
}

/** Epoch milliseconds of an Israel wall-clock date and time, e.g. ("2026-09-10", "16:17"). */
export function israelInstant(date, hhmm) {
  const at = offset => Date.parse(`${date}T${hhmm}:00${offset}`);
  const guess = israelParts(new Date(Date.parse(`${date}T${hhmm}:00Z`))).offset;
  const exact = israelParts(new Date(at(guess))).offset; // the guess can be off by an hour next to a DST change
  return at(exact);
}
