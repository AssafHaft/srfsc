// "מה בולט": fixed rules over an analyse() model (analysis spec section 6.9, CMS import spec 6.4). Each rule fires only
// under its condition; fired insights are sorted by impact in ₪, rules without a ₪ value last.
import { HE_DAYS_SHORT } from './time.mjs';

export const MAX_INSIGHTS = 6;
const MIN_SESSIONS = 20;

const points = x => Math.round(x * 100);
const shekels = n => `₪${Math.round(n).toLocaleString('en-US')}`;
export const levelLabel = key => (key === 'bay-adult' ? 'Bay מבוגרים' : key === 'bay-kids' ? 'Bay ילדים' : key);
const against = compare => (compare?.kind === 'lastYear' ? 'מאשתקד' : 'מהתקופה הקודמת');
const change = (a, b) => (b ? a / b - 1 : 0);

export function insights(model, max = MAX_INSIGHTS) {
  const { kpis, levels, split, heat, upcoming, pace, range } = model;
  const { cur, cmp } = kpis;
  const avgPrice = cur.people ? cur.revenue / cur.people : 0;
  const out = [];

  if (cmp && cmp.sessions >= 100 && cur.occupancy !== null && cmp.occupancy !== null) {
    const d = points(cur.occupancy) - points(cmp.occupancy);
    if (Math.abs(d) >= 3) {
      const dCap = points(change(cur.capacity, cmp.capacity));
      const dBook = points(change(cur.spotsSold, cmp.spotsSold));
      const bookings = Math.abs(dBook) <= 2 ? 'כמעט לא השתנו' : dBook > 0 ? `גדלו ב־${dBook}%` : `ירדו ב־${-dBook}%`;
      const supply = Math.abs(dCap) <= 2 ? 'כמעט לא השתנה' : dCap > 0 ? `גדל ב־${dCap}%` : `קטן ב־${-dCap}%`;
      const why = Math.abs(dCap - dBook) >= 5 ? ` ההיצע ${supply} וההזמנות ${bookings}.` : '';
      out.push({
        rule: 'trend', tone: d < 0 ? 'bad' : 'good', link: 'trend',
        impact: Math.abs(cur.occupancy - cmp.occupancy) * cur.capacity * avgPrice,
        text: `התפוסה ${d < 0 ? 'ירדה' : 'עלתה'} ב־${Math.abs(d)} נקודות ${against(range.compare)}, מ־${points(cmp.occupancy)}% ל־${points(cur.occupancy)}%.${why}`,
      });
    }
  }

  const movers = levels
    .filter(l => l.cmp && l.sessions >= MIN_SESSIONS && l.cmp.sessions >= MIN_SESSIONS)
    .map(l => ({ ...l, d: points(l.occupancy) - points(l.cmp.occupancy) }));
  const moved = (list, tone, title) => {
    if (!list.length) return;
    out.push({
      rule: tone === 'bad' ? 'level-drop' : 'level-gain', tone, link: 'levels',
      impact: list.reduce((n, l) => n + Math.abs(l.revenue - l.cmp.revenue), 0),
      text: `${title} ${against(range.compare)}: ${list.map(l => `${levelLabel(l.key)} מ־${points(l.cmp.occupancy)}% ל־${points(l.occupancy)}%`).join(', ')}.`,
    });
  };
  const drops = movers.filter(l => l.d <= -10).sort((a, b) => a.d - b.d).slice(0, 2);
  const gains = movers.filter(l => l.d >= 10).sort((a, b) => b.d - a.d).slice(0, 2);
  moved(drops, 'bad', drops.length > 1 ? 'הירידות הגדולות' : 'הירידה הגדולה');
  moved(gains, 'good', 'עלייה');

  const { weekend, weekday } = split;
  if (weekend.sessions && weekday.sessions && points(weekend.occupancy) - points(weekday.occupancy) >= 10) {
    const extra = (weekend.occupancy - weekday.occupancy) * weekday.capacity * avgPrice;
    out.push({
      rule: 'weekend', tone: 'info', link: 'heat', impact: extra,
      text: `שישי־שבת מלאים ב־${points(weekend.occupancy)}%, ימי חול ב־${points(weekday.occupancy)}%. אם ימי החול היו מתמלאים כמו סוף השבוע, זה ${shekels(extra)} נוספים.`,
    });
  }

  for (const l of levels) {
    if (l.sessions >= MIN_SESSIONS && l.soldOutShare >= 0.35) {
      out.push({
        rule: 'undersupply', tone: 'good', link: 'levels', impact: l.revenue * l.soldOutShare,
        text: `${levelLabel(l.key)} נמכר עד המקום האחרון ב־${points(l.soldOutShare)}% מהסשנים: הביקוש גבוה מההיצע, כדאי לשקול עוד סשנים.`,
      });
    }
    if (l.sessions >= MIN_SESSIONS && l.occupancy < 0.5) {
      out.push({
        rule: 'weak-level', tone: 'bad', link: 'levels', impact: l.emptyValue,
        text: `${levelLabel(l.key)} מתמלא רק ב־${points(l.occupancy)}%: ${shekels(l.emptyValue)} במקומות ריקים בתקופה.`,
      });
    }
  }

  const weak = heat
    .flatMap(row => row.cells.slice(0, 5).map((c, d) => (c && c.sessions >= 10 && c.occupancy < 0.5 ? { ...c, d, hour: row.hour } : null)))
    .filter(Boolean)
    .sort((a, b) => b.emptyValue - a.emptyValue)
    .slice(0, 3);
  if (weak.length) {
    const total = weak.reduce((n, c) => n + c.emptyValue, 0);
    out.push({
      rule: 'weak-hours', tone: 'bad', link: 'heat', impact: total,
      text: `השעות החלשות: ${weak.map(c => `${HE_DAYS_SHORT[c.d]} ${c.hour}:00 (${points(c.occupancy)}%)`).join(', ')}. יחד ${shekels(total)} במקומות ריקים.`,
    });
  }

  const risk = upcoming.atRisk;
  if (risk.length) {
    const open = risk.reduce((n, s) => n + s.emptyValue, 0);
    out.push({
      rule: 'at-risk', tone: 'bad', link: 'upcoming', impact: open,
      text: risk.length === 1
        ? `סשן אחד ב־48 השעות הקרובות מלא בפחות מ־40%: ${shekels(open)} פתוחים למכירה.`
        : `${risk.length} סשנים ב־48 השעות הקרובות מלאים בפחות מ־40%: ${shekels(open)} פתוחים למכירה.`,
    });
  }

  if (pace.ready) {
    for (const [key, days] of Object.entries(pace.sellOutLeadDays)) {
      if (days >= 3) {
        out.push({ rule: 'early-sellout', tone: 'good', link: 'pace', impact: null, text: `${levelLabel(key)} נמכר עד הסוף בדרך כלל ${Math.round(days)} ימים מראש.` });
      }
    }
    if (pace.last24Share >= 0.4) {
      out.push({ rule: 'late-demand', tone: 'info', link: 'pace', impact: null, text: `${points(pace.last24Share)}% מההזמנות מגיעות ב־24 השעות האחרונות.` });
    }
  }

  const hid = model.hidden;
  if (hid?.window && hid.sessions >= MIN_SESSIONS && hid.share >= 0.1 && hid.categories.length) {
    const top = hid.categories[0];
    out.push({
      rule: 'hidden-share', tone: 'info', link: 'hidden', impact: null,
      text: `${points(hid.share)}% מההזמנות בתקופה לא עברו בלוח הציבורי, בעיקר ${top.label} (${points(top.share)}%).`,
    });
  }

  return out.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1)).slice(0, max);
}
