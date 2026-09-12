// HTML for the analysis tab (analysis spec section 7). Pure functions returning strings.
// Park text (session names, closure reasons) is escaped before it reaches the HTML.
import { HE_DAYS, HE_DAYS_SHORT, addDays, dayOfWeek, formatAge, shortDate } from './time.mjs';
import { PERIODS } from './history.mjs';
import { PACE } from './analytics.mjs';
import { escapeHtml } from './render.mjs';

const PERIOD_LABELS = { '30d': '30 יום', '90d': '90 יום', '12m': '12 חודשים', all: 'הכול' };
const HEAT_STEPS = { occupancy: [0.4, 0.55, 0.7, 0.85, 0.95], soldOutShare: [0.1, 0.25, 0.4, 0.6, 0.8], revenue: [0.2, 0.4, 0.6, 0.8, 0.95] };
const AT_RISK_SHOWN = 7;
const LINKS = { trend: 'למגמה', levels: 'לטבלת הרמות', heat: 'למפת העומס', upcoming: 'לימים הקרובים', pace: 'לקצב ההזמנות', hidden: 'לפעילות הסגורה' };

export const pct = x => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const int = n => Math.round(n).toLocaleString('en-US');
/** ₪12.6M, ₪318K or ₪8,500, in a left-to-right isolate. */
export const money = n =>
  `<span class="ltr num">${n >= 1e6 ? `₪${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `₪${Math.round(n / 1e3)}K` : `₪${int(n)}`}</span>`;
const fullDate = iso => `${shortDate(iso)}.${iso.slice(0, 4)}`;
const dates = (from, to) => `<span class="ltr num">${fullDate(from)}–${fullDate(to)}</span>`;
const levelChip = key => (key.startsWith('bay') ? '<span class="chip lv0">Bay</span>' : `<span class="chip lv${key.slice(1)}">${key}</span>`);
const levelNote = key => (key === 'bay-adult' ? 'מבוגרים' : key === 'bay-kids' ? 'ילדים' : '');
const levelCell = key => `<span class="lvcell">${levelChip(key)}<small>${levelNote(key)}</small></span>`;
const empty = text => `<p class="empty">${text}</p>`;
const section = (id, title, sub, body, tools = '') =>
  `<section class="sec" id="a-${id}"><div class="sec-head"><div><h2>${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>${tools}</div>${body}</section>`;
const seg = (attr, options, current) =>
  `<div class="seg sm">${options.map(([value, label]) => `<button data-${attr}="${value}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`;

const HEAT_HEAD = `<div></div>${HE_DAYS.map((_, i) => `<div class="hd"><b>${HE_DAYS_SHORT[i]}</b>${i >= 5 ? 'סופ״ש' : ''}</div>`).join('')}`;
/** A chart bucket's axis label: "13.6" for a week, "6.26" for a month. */
const bucketLabel = (b, unit) => (unit === 'week' ? shortDate(b.from) : `${Number(b.from.slice(5, 7))}.${b.from.slice(2, 4)}`);

/** The period switch buttons. */
export const renderPeriods = current =>
  Object.keys(PERIODS).map(p => `<button data-period="${p}" aria-pressed="${p === current}">${PERIOD_LABELS[p]}</button>`).join('');

/** The line under the filters naming the period and what it's compared with. */
export function compareNote(range) {
  const shown = `מציג <b>${dates(range.from, range.to)}</b> (עד אתמול)`;
  if (!range.compare) return `${shown}. אין להיסטוריה תקופה קודמת להשוואה.`;
  const what = range.compare.kind === 'lastYear' ? 'אותם שבועות אשתקד' : 'התקופה הקודמת';
  return `${shown} בהשוואה ל־<b>${what}</b>, ${dates(range.compare.from, range.compare.to)}`;
}

// ---------- 1. KPIs ----------

function delta(cur, cmp, { ratio, lowerIsBetter = false, format, label }) {
  if (cmp === null || cmp === undefined || cur === null) return `<div class="d"><span class="ly">אין נתון להשוואה</span></div>`;
  const diff = ratio ? Math.round(cur * 100) - Math.round(cmp * 100) : cmp ? Math.round((cur / cmp - 1) * 100) : 0;
  const bad = diff !== 0 && (lowerIsBetter ? diff > 0 : diff < 0);
  const arrow = diff === 0 ? '=' : diff > 0 ? '▲' : '▼';
  return `<div class="d${bad ? ' bad' : ''}"><span class="ar">${arrow} ${Math.abs(diff)}${ratio ? ' נק׳' : '%'}</span> <span class="ly">· ${label} ${format(cmp)}</span></div>`;
}

function kpiSection(model) {
  const { cur, cmp } = model.kpis;
  const p = model.prices;
  const label = model.range.compare?.kind === 'lastYear' ? 'אשתקד' : 'בתקופה הקודמת';
  const d = (key, opts) => delta(cur[key], cmp ? cmp[key] : null, { label, ...opts });
  const tiles = [
    ['lead', 'תפוסה', `<span class="v num">${pct(cur.occupancy)}</span>`, d('occupancy', { ratio: true, format: pct })],
    ['', 'מקומות שנמכרו', `<span class="v num">${int(cur.spotsSold)}</span>`, d('spotsSold', { format: int })],
    ['', 'הכנסה משוערת', `<span class="v">${money(cur.revenue)}</span>`, d('revenue', { format: money })],
    ['', 'סשנים שנמכרו עד הסוף', `<span class="v num">${pct(cur.soldOutShare)}</span>`, d('soldOutShare', { ratio: true, format: pct })],
    ['', 'שווי מקומות ריקים', `<span class="v">${money(cur.emptyValue)}</span>`, d('emptyValue', { lowerIsBetter: true, format: money })],
    ['', 'ימי פעילות', `<span class="v num">${cur.daysOpen}</span>`,
      `<div class="d"><span class="ly">${cur.closedDays ? `${cur.closedDays} ימים סגורים` : 'בלי ימים סגורים'} · ${int(cur.capacity)} מקומות</span></div>`],
  ];
  const body = `<div class="kpis">${tiles.map(([cls, k, v, dd]) => `<div class="card kpi${cls ? ` ${cls}` : ''}"><span class="k">${k}</span>${v}${dd}</div>`).join('')}</div>`
    + `<p class="foot">הכנסה ושווי מקומות ריקים הם הערכה לפי מחירון (ריף L1–L4 ${p.reef} ₪, L5–L6 ${p.reefHigh} ₪, Bay מבוגרים ${p.bayAdult} ₪, Bay ילדים ${p.bayKids} ₪), בלי כרטיסיות, מנויים והנחות. התפוסה והמקומות כוללים רק את הלוח הציבורי, בלי סשנים שבוטלו. הזמנות שלא עברו בלוח מופיעות ב״מה לא בלוח הציבורי״.</p>`;
  return `<section class="sec" id="a-kpis">${body}</section>`;
}

// ---------- 2. insights ----------

function insightSection(list) {
  const body = list.length
    ? `<ol class="ins">${list.map((i, n) => `<li class="card ${i.tone}"><span class="n num">${n + 1}</span><span class="t">${escapeHtml(i.text)}</span><span class="m">${i.impact === null ? '' : `<span>השפעה: ${money(i.impact)}</span>`}<button data-jump="${i.link}">${LINKS[i.link]} ←</button></span></li>`).join('')}</ol>`
    : empty('אין מסקנות בולטות בתקופה הזו.');
  return section('insights', 'מה בולט', 'מסקנות אוטומטיות מהתקופה שנבחרה, מהחשובה ביותר. כל אחת מבוססת על לפחות 20 סשנים.', body);
}

// ---------- 3. heatmap ----------

function heatSection(model, metric) {
  const heat = model.heat;
  const tools = seg('heat-metric', [['occupancy', 'תפוסה'], ['soldOutShare', 'נמכרו עד הסוף'], ['revenue', 'הכנסה']], metric);
  const sub = 'כל משבצת: כל הסשנים שהתחילו באותו יום ושעה בתקופה. משבצת ריקה: פחות מ־4 סשנים.';
  if (!heat.length) return section('heat', 'מתי עמוס', sub, empty('אין מספיק נתונים בתקופה.'), tools);
  const max = Math.max(...heat.flatMap(r => r.cells.filter(Boolean).map(c => c.revenue)), 1);
  const value = c => (metric === 'revenue' ? c.revenue / max : c[metric]);
  const step = c => HEAT_STEPS[metric].filter(t => value(c) >= t).length;
  const label = c => (metric === 'revenue' ? (c.revenue >= 1000 ? `${Math.round(c.revenue / 1000)}K` : int(c.revenue)) : pct(c[metric]));
  const head = HEAT_HEAD;
  const rows = heat.map(r => `<div class="hr num">${r.hour}:00</div>${r.cells.map((c, d) => (c
    ? `<div class="c s${step(c)} num" title="${HE_DAYS[d]} ${r.hour}:00 · ${c.sessions} סשנים · תפוסה ${pct(c.occupancy)} · נמכרו עד הסוף ${pct(c.soldOutShare)}">${label(c)}</div>`
    : '<div class="c x" title="פחות מ־4 סשנים"></div>')).join('')}`).join('');
  const scale = `<div class="scale"><span>נמוך</span>${[0, 1, 2, 3, 4, 5].map(s => `<i class="c s${s}"></i>`).join('')}<span>גבוה</span></div>`;
  return section('heat', 'מתי עמוס', sub, `<div class="card heat-wrap"><div class="heat">${head}${rows}</div>${scale}</div>`, tools);
}

// ---------- 4. levels ----------

function levelSection(model) {
  const sub = 'לפי רמה. הקו הכתום על פס התפוסה הוא התפוסה בתקופת ההשוואה.';
  if (!model.levels.length) return section('levels', 'מה נמכר', sub, empty('אין סשנים בתקופה.'));
  const rows = model.levels.map(l => {
    const d = l.cmp ? Math.round(l.occupancy * 100) - Math.round(l.cmp.occupancy * 100) : null;
    const tick = l.cmp ? `<u style="inset-inline-start:${Math.round(l.cmp.occupancy * 100)}%" title="השוואה ${pct(l.cmp.occupancy)}"></u>` : '';
    return `<tr><td>${levelCell(l.key)}</td><td class="num">${int(l.sessions)}</td>`
      + `<td><div class="occ"><div class="bar"><i style="width:${Math.round(l.occupancy * 100)}%"></i>${tick}</div><span class="num">${pct(l.occupancy)}</span></div></td>`
      + `<td class="dlt num${d !== null && d <= -10 ? ' bad' : ''}">${d === null ? '–' : `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} נק׳`}</td>`
      + `<td class="num">${pct(l.soldOutShare)}</td><td>${money(l.revenue)} <small class="num">(${pct(l.revenueShare)})</small></td>`
      + `<td><div class="sd" title="חלק מהמקומות ${pct(l.capacityShare)} · חלק מההזמנות ${pct(l.bookingShare)}"><div class="cap" style="width:${Math.min(100, Math.round(l.capacityShare * 300))}%"></div><div class="bk" style="width:${Math.min(100, Math.round(l.bookingShare * 300))}%"></div></div></td></tr>`;
  }).join('');
  const table = `<div class="card tbl-scroll"><table class="tbl"><thead><tr><th>רמה</th><th>סשנים</th><th>תפוסה</th><th>שינוי</th><th>נמכרו עד הסוף</th><th>הכנסה משוערת</th><th>היצע מול ביקוש</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return section('levels', 'מה נמכר', sub, `${table}<p class="foot">״היצע מול ביקוש״: הפס האפור הוא החלק של הרמה מכל המקומות בפארק, והכהה הוא החלק שלה מכל ההזמנות. כהה ארוך מאפור: הרמה מבוקשת יותר ממה שמוקצה לה.</p>`);
}

// ---------- 4b. hidden bookings (CMS import) ----------

function countChart(buckets, unit) {
  const W = 700, H = 180, L = 44, R = 8, T = 12, B = 34;
  const top = Math.max(1, ...buckets.map(b => b.people));
  const bw = (W - L - R) / buckets.length;
  const y = v => T + (1 - v / top) * (H - T - B);
  const x = i => W - R - (i + 1) * bw; // time runs right to left, like the trend chart
  const every = Math.ceil(buckets.length / 7);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="הזמנות סגורות לפי ${unit === 'week' ? 'שבוע' : 'חודש'}">`;
  for (const g of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g * top)}" y2="${y(g * top)}" class="grid"/><text x="${L - 6}" y="${y(g * top) + 4}" text-anchor="end">${int(g * top)}</text>`;
  buckets.forEach((b, i) => {
    if (b.people) s += `<rect x="${x(i) + 3}" y="${y(b.people)}" width="${Math.max(1, bw - 6)}" height="${y(0) - y(b.people)}" rx="3" class="bar-cur"><title>${fullDate(b.from)}: ${int(b.people)}</title></rect>`;
    if (i % every === 0) s += `<text x="${x(i) + bw / 2}" y="${H - 12}" text-anchor="middle">${bucketLabel(b, unit)}</text>`;
  });
  return `${s}</svg>`;
}

function hiddenGrid(grid) {
  const max = Math.max(1, ...grid.flatMap(r => r.cells));
  const step = v => HEAT_STEPS.revenue.filter(t => v / max >= t).length; // relative to the busiest cell
  const rows = grid.map(r => `<div class="hr num">${r.hour}:00</div>${r.cells.map((v, d) => (v
    ? `<div class="c s${step(v)} num" title="${HE_DAYS[d]} ${r.hour}:00 · ${int(v)} הזמנות">${int(v)}</div>`
    : '<div class="c"></div>')).join('')}`).join('');
  return `<div class="heat">${HEAT_HEAD}${rows}</div>`;
}

const categoryChange = c => {
  if (c.cmpPeople === null) return '–';
  if (!c.cmpPeople) return 'חדש';
  const diff = Math.round((c.people / c.cmpPeople - 1) * 100);
  return `${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${Math.abs(diff)}%`;
};

function hiddenSection(model) {
  const h = model.hidden;
  const cov = model.coverage.cms;
  const title = 'מה לא בלוח הציבורי';
  if (!h?.window) {
    return section('hidden', title, '', empty(cov
      ? `אין נתוני מערכת ניהול לתקופה הזו – הייצוא מכסה ${dates(cov.from, cov.to)}. בחרו ״הכול״ כדי לראות אותם.`
      : 'אין נתוני מערכת ניהול.'));
  }
  const sub = `הזמנות שלא הופיעו בלוח הציבורי: קבוצות, קייטנות, אירועים, פרטיים וחוגים. לפי ייצוא מערכת הניהול, ${dates(cov.from, cov.to)}. סינון הרמות לא חל כאן.`
    + (h.partial ? ` בתקופה שנבחרה הנתונים מכסים רק את ${dates(h.window.from, h.window.to)}.` : '');
  const label = model.range.compare?.kind === 'lastYear' ? 'אשתקד' : 'בתקופה הקודמת';
  const d = (key, opts) => delta(h[key], h.cmp ? h.cmp[key] : null, { label, ...opts });
  const tiles = [
    ['הזמנות סגורות', `<span class="v num">${int(h.people)}</span>`, d('people', { format: int })],
    ['חלק מכל ההזמנות', `<span class="v num">${pct(h.share)}</span>`, d('share', { ratio: true, format: pct })],
    ['משבצות ריף שלא היו למכירה', `<span class="v num">${pct(h.reefShare)}</span>`, d('reefShare', { ratio: true, format: pct })],
  ].map(([k, v, dd]) => `<div class="card kpi"><span class="k">${k}</span>${v}${dd}</div>`).join('');
  const kpis = `<div class="kpis hid">${tiles}</div>`;
  if (!h.sessions) return section('hidden', title, sub, kpis + empty('אין הזמנות סגורות בתקופה.'));
  const rows = h.categories.map(c => `<tr><td>${escapeHtml(c.label)}</td><td class="num">${int(c.people)}</td><td class="num">${pct(c.share)}</td>`
    + `<td class="num">${int(c.sessions)}</td><td class="num">${c.avgSize.toFixed(1)}</td><td class="num">${pct(c.bayShare)}</td><td class="dlt num">${categoryChange(c)}</td></tr>`).join('');
  const table = `<div class="card tbl-scroll"><table class="tbl"><thead><tr><th>קטגוריה</th><th>הזמנות</th><th>חלק</th><th>סשנים</th><th>ממוצע לסשן</th><th>ב־Bay</th><th>שינוי</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const chart = `<div class="card trend">${countChart(h.buckets, h.unit)}<p class="foot">${h.unit === 'week' ? 'לפי שבוע' : 'לפי חודש'}. הזמן זורם מימין לשמאל.</p></div>`;
  const grid = `<div class="card heat-wrap">${hiddenGrid(h.grid)}<p class="foot">כמה הזמנות סגורות היו בכל יום ושעה בתקופה.</p></div>`;
  return section('hidden', title, sub, `${kpis}${table}<div class="hid-when">${chart}${grid}</div>`);
}

// ---------- 5. slots ----------

function slotRows(list) {
  return list.map((s, i) => `<div class="slot"><span class="rk num">${i + 1}</span><span class="wh">${HE_DAYS[s.weekday]} <span class="ltr num">${s.start}</span></span>${levelCell(s.level)}`
    + `<div class="occ"><div class="bar"><i style="width:${Math.round(s.occupancy * 100)}%"></i></div><span class="num">${pct(s.occupancy)}</span></div>`
    + `<span class="v">${s.soldOutShare >= 0.5 ? `מלא ב־${pct(s.soldOutShare)}` : `${money(s.emptyValue)} ריק`}</span></div>`).join('');
}

function slotSection(model) {
  const { count, top, bottom } = model.slots;
  const sub = 'סשנים קבועים (יום, שעה ורמה) שרצו לפחות 4 פעמים בתקופה.';
  if (!count) return section('slots', 'הסשנים הכי חזקים והכי חלשים', sub, empty('אין סשנים קבועים שרצו לפחות 4 פעמים בתקופה.'));
  const weakest = bottom.length ? `<div class="card"><h3>הכי חלשים<small>מועמדים לשינוי רמה, שעה או מבצע</small></h3>${slotRows(bottom)}</div>` : '';
  return section('slots', 'הסשנים הכי חזקים והכי חלשים', sub,
    `<div class="slots"><div class="card"><h3>הכי מבוקשים<small>מועמדים להוספת סשן</small></h3>${slotRows(top)}</div>${weakest}</div>`);
}

// ---------- 6. trend ----------

function trendChart(buckets, unit, metric) {
  const W = 700, H = 210, L = 44, R = 8, T = 12, B = 34;
  const cur = b => (metric === 'revenue' ? b.revenue : b.occupancy);
  const cmp = b => (metric === 'revenue' ? b.cmpRevenue : b.cmpOccupancy);
  const top = metric === 'revenue' ? Math.max(1, ...buckets.map(b => Math.max(cur(b) ?? 0, cmp(b) ?? 0))) : 1;
  const bw = (W - L - R) / buckets.length;
  const y = v => T + (1 - v / top) * (H - T - B);
  const x = i => W - R - (i + 1) * bw; // time runs right to left, like the week view
  const tickLabel = v => (metric === 'revenue' ? (v >= 1e6 ? `₪${(v / 1e6).toFixed(1)}M` : `₪${Math.round(v / 1e3)}K`) : `${Math.round(v * 100)}%`);
  const every = Math.ceil(buckets.length / 7);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'revenue' ? 'הכנסה' : 'תפוסה'} לפי ${unit === 'week' ? 'שבוע' : 'חודש'}">`;
  for (const g of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g * top)}" y2="${y(g * top)}" class="grid"/><text x="${L - 6}" y="${y(g * top) + 4}" text-anchor="end">${tickLabel(g * top)}</text>`;
  buckets.forEach((b, i) => {
    const v = cur(b);
    if (v !== null) s += `<rect x="${x(i) + 3}" y="${y(v)}" width="${Math.max(1, bw - 6)}" height="${y(0) - y(v)}" rx="3" class="bar-cur"><title>${fullDate(b.from)}: ${metric === 'revenue' ? tickLabel(v) : pct(v)}</title></rect>`;
    if (b.closedDays) s += `<line x1="${x(i) + 3}" x2="${x(i) + bw - 3}" y1="${H - B + 5}" y2="${H - B + 5}" class="closed-mark"/>`;
    if (i % every === 0) s += `<text x="${x(i) + bw / 2}" y="${H - 12}" text-anchor="middle">${bucketLabel(b, unit)}</text>`;
  });
  const line = buckets.map((b, i) => (cmp(b) === null ? null : `${x(i) + bw / 2},${y(cmp(b))}`)).filter(Boolean);
  if (line.length > 1) s += `<polyline points="${line.join(' ')}" class="line-cmp"/>`;
  buckets.forEach((b, i) => { if (cmp(b) !== null) s += `<circle cx="${x(i) + bw / 2}" cy="${y(cmp(b))}" r="3" class="dot-cmp"/>`; });
  return `${s}</svg>`;
}

function trendSection(model, metric) {
  const { unit, buckets } = model.trend;
  const tools = seg('trend-metric', [['occupancy', 'תפוסה'], ['revenue', 'הכנסה']], metric);
  const sub = `${unit === 'week' ? 'לפי שבוע' : 'לפי חודש'}. הזמן זורם מימין לשמאל, כמו בלוח.`;
  if (buckets.every(b => b.occupancy === null)) return section('trend', 'מגמה', sub, empty('אין מספיק נתונים בתקופה.'), tools);
  const legend = `<div class="lg"><span><i class="sw-cur"></i>התקופה</span>${model.range.compare ? `<span><i class="sw-cmp"></i>${model.range.compare.kind === 'lastYear' ? 'אותו זמן אשתקד' : 'התקופה הקודמת'}</span>` : ''}<span><i class="sw-closed"></i>היו ימים סגורים</span></div>`;
  return section('trend', 'מגמה', sub, `<div class="card trend">${trendChart(buckets, unit, metric)}${legend}</div>`, tools);
}

// ---------- 7. pace ----------

function paceChart(p) {
  const W = 460, H = 200, L = 34, R = 34, T = 14, B = 30;
  const leads = PACE.leadDays;
  const xs = i => L + (i / (leads.length - 1)) * (W - L - R);
  const y = v => T + (1 - v) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="עקומות מילוי לפי רמה">`;
  for (const g of [0, 0.5, 1]) s += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end">${g * 100}%</text>`;
  leads.forEach((d, i) => { s += `<text x="${xs(i)}" y="${H - 10}" text-anchor="middle">${d === 0 ? 'ביום' : d}</text>`; });
  for (const [key, curve] of Object.entries(p.curves)) {
    const color = key.startsWith('bay') ? 'var(--l0)' : `var(--l${key.slice(1)})`;
    const points = curve.map((v, i) => (v === null ? null : `${xs(i)},${y(v)}`)).filter(Boolean);
    if (points.length > 1) s += `<polyline points="${points.join(' ')}" style="fill:none;stroke:${color};stroke-width:2.5"${key === 'bay-kids' ? ' stroke-dasharray="5 4"' : ''}/>`;
    const last = curve.at(-1);
    if (last !== null) s += `<text x="${W - R + 4}" y="${y(last) + 4}" style="fill:${color}">${key.startsWith('bay') ? 'Bay' : key}</text>`;
  }
  return `${s}</svg>`;
}

function paceSection(model) {
  const p = model.pace;
  const { snapshots, snapshotsSince } = model.coverage;
  const sub = 'מבוסס על צילומי מצב של הלוח שנאספים מכאן והלאה. הפארק לא שומר מתי הוזמן כל מקום.';
  if (!p.ready) {
    const when = snapshotsSince ? `, בערך ב־${shortDate(addDays(snapshotsSince, 14))}` : '';
    const body = `<div class="card collect"><span class="k">אוספים נתונים</span><span class="big num">${snapshots} צילומי מצב</span>`
      + `<div class="meter"><i style="width:${Math.min(100, Math.round((p.deep / PACE.minSessions) * 100))}%"></i></div>`
      + `<span>${snapshotsSince ? `מאז ${shortDate(snapshotsSince)}. ` : ''}הגרפים יופיעו כשיהיו לפחות ${PACE.minSessions} סשנים שנצפו לפחות 7 ימים לפני תחילתם (כרגע ${p.deep})${when}.</span>`
      + '<ul><li>עקומת מילוי ממוצעת לכל רמה</li><li>כמה ימים מראש סשן נמכר עד הסוף</li><li>איזה חלק מההזמנות מגיע ב־24 השעות האחרונות</li><li>כמה מקומות מתפנים בביטולים</li></ul></div>';
    return section('pace', 'כמה מהר מתמלא', sub, body);
  }
  const leads = Object.entries(p.sellOutLeadDays).map(([k, d]) => `<li>${levelCell(k)} נמכר עד הסוף בדרך כלל <b class="num">${d < 1 ? `${Math.round(d * 24)} שעות` : `${d.toFixed(1)} ימים`}</b> מראש</li>`).join('');
  const facts = `<div class="card collect"><span class="k">עובדות</span><ul class="facts"><li><b class="num">${pct(p.last24Share)}</b> מההזמנות מגיעות ב־24 השעות האחרונות</li><li><b class="num">${int(p.released)}</b> מקומות התפנו בביטולים</li>${leads}</ul><span class="foot">מבוסס על ${int(p.tracked)} סשנים שנצפו בתקופה.</span></div>`;
  const chart = `<div class="card example">${paceChart(p)}<p class="foot">ציר אופקי: ימים לפני תחילת הסשן. ציר אנכי: כמה מהסשן כבר הוזמן.</p></div>`;
  return section('pace', 'כמה מהר מתמלא', sub, `<div class="pace">${facts}${chart}</div>`);
}

// ---------- 8. upcoming ----------

const startsIn = hours => (hours < 1 ? 'מתחיל בקרוב' : hours === 1 ? 'בעוד שעה' : hours === 2 ? 'בעוד שעתיים' : `בעוד ${hours} שעות`);

function riskRow(r) {
  return `<div class="rrow"><span class="when"><b>${HE_DAYS_SHORT[dayOfWeek(r.date)]} <span class="ltr num">${r.start}</span></b><span>${startsIn(r.hours)}</span></span>${levelChip(r.level)}`
    + `<span class="nm">${escapeHtml(r.name)}</span><span class="fill num">${r.booked}/${r.capacity}<small>${money(r.emptyValue)} פתוח</small></span></div>`;
}

function upcomingSection(model) {
  const { days, atRisk } = model.upcoming;
  const sub = 'מהלוח שפורסם עכשיו. כשיהיו מספיק צילומי מצב, כל יום יושווה לקצב הרגיל באותו מרחק זמן.';
  if (!days.length) return section('upcoming', 'הימים הקרובים', sub, empty('אין סשנים מפורסמים קדימה.'));
  const bars = days.map(d => {
    const usual = d.usual === null ? '' : `<u style="bottom:${Math.round(d.usual * 100)}%" title="בדרך כלל ${pct(d.usual)}"></u>`;
    const vs = d.usual === null ? '' : `<small class="${d.occupancy < d.usual ? 'behind' : ''}">${Math.round((d.occupancy - d.usual) * 100) > 0 ? '+' : ''}${Math.round((d.occupancy - d.usual) * 100)}</small>`;
    return `<div class="b"><em class="num">${pct(d.occupancy)}</em>${vs}<span class="col"><i style="height:${Math.max(2, Math.round(d.occupancy * 100))}%"></i>${usual}</span></div>`;
  }).join('');
  const labels = days.map(d => `<span><b>${HE_DAYS_SHORT[dayOfWeek(d.date)]}</b>${shortDate(d.date)}</span>`).join('');
  const dayCard = `<div class="card days"><div class="bars">${bars}</div><div class="lbl">${labels}</div><p class="foot">כמה מכל יום כבר הוזמן. רוב ההזמנות מגיעות ביומיים האחרונים, לכן ימים רחוקים נראים ריקים.${days.some(d => d.usual !== null) ? ' הקו: כמה בדרך כלל כבר הוזמן באותו מרחק זמן.' : ''}</p></div>`;
  const more = atRisk.length > AT_RISK_SHOWN
    ? `<details class="more"><summary>ועוד ${atRisk.length - AT_RISK_SHOWN} סשנים</summary>${atRisk.slice(AT_RISK_SHOWN).map(riskRow).join('')}</details>`
    : '';
  const riskCard = `<div class="card risk"><h3>סשנים בסיכון<small>פחות מ־40% מלא, מתחילים ב־48 השעות הקרובות</small></h3>${atRisk.length ? atRisk.slice(0, AT_RISK_SHOWN).map(riskRow).join('') + more : empty('אין כרגע סשנים בסיכון.')}</div>`;
  return section('upcoming', 'הימים הקרובים', sub, `<div class="up">${dayCard}${riskCard}</div>`);
}

// ---------- 9. operations ----------

function opsSection(model) {
  const o = model.ops;
  const c = model.coverage;
  const card = (value, title, text) => `<div class="card op"><span class="v num">${value}</span><span class="k">${title}</span><p>${text}</p></div>`;
  const cards = [
    card(o.closed.length, 'ימים סגורים', o.closed.length ? o.closed.map(x => `${shortDate(x.date)} ${escapeHtml(x.text)}`).join(' · ') : 'אין בתקופה.'),
    card(o.blocked, 'סשנים חסומים לאירועים', o.blockedNames.length ? o.blockedNames.map(n => `${escapeHtml(n.name)} ×${n.count}`).join(' · ') : 'אין בתקופה.'),
    card(o.cancelled + o.removed, 'סשנים שבוטלו', `${o.cancelled} עם קיבולת 0 בלוח, ${o.removed} שהוסרו מהלוח לפני שהתקיימו.`),
    card(o.overbooked, 'צדדים עם הזמנת יתר', `${o.overbookedPeople} גולשים מעבר לקיבולת, בדרך כלל אחרי שהקיבולת הוקטנה.`),
  ].join('');
  const coverage = `היסטוריה ${c.first ? `מ־${fullDate(c.first)}` : 'עוד לא נטענה'} · ${int(c.sessions)} סשנים בתקופה · ${c.snapshotsSince ? `${c.snapshots} צילומי מצב מאז ${shortDate(c.snapshotsSince)}` : 'צילומי המצב יתחילו בעדכון הבא'}${c.updatedAt ? ` · ההיסטוריה עודכנה ${formatAge(c.updatedAt)}` : ''}${c.cms ? ` · נתוני מערכת הניהול ${dates(c.cms.from, c.cms.to)}` : ''} · מתעדכן בכל ריענון`;
  return section('ops', 'תפעול', 'קיבולת שלא הייתה למכירה, ושינויים בלוח.', `<div class="ops">${cards}</div><p class="coverage">${coverage}</p>`);
}

/** The whole tab. ui: { heatMetric: 'occupancy' | 'soldOutShare' | 'revenue', trendMetric: 'occupancy' | 'revenue' } */
export function renderAnalysis(model, insightList, ui) {
  return kpiSection(model) + insightSection(insightList) + heatSection(model, ui.heatMetric) + levelSection(model) + hiddenSection(model)
    + slotSection(model) + trendSection(model, ui.trendMetric) + paceSection(model) + upcomingSection(model) + opsSection(model);
}
