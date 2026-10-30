// admin-stats-model.js — ההיגיון של מסך "סטטיסטיקות", בלי DOM (נבדק ב-Node).
//
// הנתונים מגיעים מ-GET /stats/usage: שורה לכל יום שיש בו פעילות, עם מונים בלבד
// (ראו receiveUsageBeacon ו-recordUsage ב-Worker). כאן הם מושלמים לכל יום בטווח
// (יום בלי פעילות = אפס), מקובצים לשבועות (ראשון עד שבת) או לחודשים, ומתורגמים
// לגיאומטריה של גרף SVG פשוט — בלי ספריית גרפים. "הנצפים ביותר" נבנים מ-mediaStats
// (צפיות מצטברות לכל פריט) ומהרשומות שכבר בזיכרון, ו"המשתמשים הפעילים ביותר" —
// רק מיומן הפעילות שמנהל־העל כבר רואה.

import { hebrewDateFromDateKey, formatHebrewDate } from './hebrew-date.js';

export const STATS_RANGES = Object.freeze({ 30: 'day', 90: 'week', 365: 'month' });
export const STATS_GRANULARITIES = Object.freeze(['day', 'week', 'month']);
export const STATS_METRICS = Object.freeze(['visits', 'views', 'downloads', 'zipDownloads', 'zipItems', 'uploads', 'uploadsPending', 'approvals', 'rejections']);

// הגרפים שבראש המסך: כל אחד מדד אחד (או סכום של כמה), עם צבע מאסימוני העיצוב.
export const STATS_CHARTS = Object.freeze([
    { id: 'visits', title: 'ביקורים', hint: 'משתמשים מחוברים שונים ביום', metrics: ['visits'], tone: 'cyan' },
    { id: 'views', title: 'צפיות', hint: 'פתיחת פריט בתצוגה המלאה', metrics: ['views'], tone: 'violet' },
    { id: 'downloads', title: 'הורדות', hint: 'קובץ בודד וקובצי ZIP', metrics: ['downloads', 'zipDownloads'], tone: 'gold' },
    { id: 'uploads', title: 'העלאות', hint: 'כל ההעלאות לגלריה', metrics: ['uploads'], tone: 'green' }
]);

export const METRIC_LABELS = Object.freeze({
    visits: 'ביקורים',
    views: 'צפיות',
    downloads: 'הורדות בודדות',
    zipDownloads: 'הורדות ZIP',
    zipItems: 'פריטים ב-ZIP',
    uploads: 'העלאות',
    uploadsPending: 'נשלחו לאישור',
    approvals: 'אושרו',
    rejections: 'נדחו'
});

export const STORAGE_GROUP_LABELS = Object.freeze({
    approved: 'קבצים מאושרים',
    pending: 'ממתינים לאישור',
    variants: 'תצוגות מקדימות',
    backups: 'גיבויים',
    chat: 'צ׳אט',
    other: 'אחר (פרטי ומערכת)'
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function granularityForRange(days) {
    return STATS_RANGES[Number(days)] || 'day';
}

function dayTime(key) {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

function keyOf(time) {
    return new Date(time).toISOString().slice(0, 10);
}

function count(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
}

// שורה לכל יום מ-from עד to (כולל), גם בלי פעילות. ימים מחוץ לטווח ומדדים
// לא מוכרים נזרקים.
export function fillDays(rows, from, to) {
    if (!DATE_KEY.test(String(from)) || !DATE_KEY.test(String(to)) || from > to) return [];
    const byDay = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (DATE_KEY.test(String(row?.day))) byDay.set(row.day, row);
    }
    const days = [];
    for (let time = dayTime(from); time <= dayTime(to) && days.length < 800; time += DAY_MS) {
        const day = keyOf(time);
        const source = byDay.get(day) || {};
        const entry = { day };
        for (const metric of STATS_METRICS) entry[metric] = count(source[metric]);
        days.push(entry);
    }
    return days;
}

function shortDate(key) {
    const [, month, day] = key.split('-');
    return `${Number(day)}.${Number(month)}`;
}

export function hebrewDayLabel(key) {
    const hebrew = hebrewDateFromDateKey(key);
    return hebrew ? formatHebrewDate(hebrew) : '';
}

function bucketKey(day, granularity) {
    if (granularity === 'month') return day.slice(0, 7);
    if (granularity === 'week') {
        const time = dayTime(day);
        // השבוע מתחיל ביום ראשון, כמו בלוח העברי.
        return keyOf(time - new Date(time).getUTCDay() * DAY_MS);
    }
    return day;
}

function bucketLabel(key, granularity) {
    if (granularity === 'month') {
        const [year, month] = key.split('-').map(Number);
        return `${HEBREW_MONTHS[month - 1]} ${year}`;
    }
    if (granularity === 'week') return `שבוע מ־${shortDate(key)}`;
    return shortDate(key);
}

// הימים מקובצים לפי הרזולוציה; כל קבוצה סוכמת את המונים שלה. "ביקורים" בשבוע
// או בחודש הוא סכום הביקורים היומיים (משתמש שביקר בשני ימים נספר פעמיים) —
// המסך אומר זאת, ולמשתמשים השונים בטווח יש את מוני 7 ו-30 הימים.
export function bucketize(days, granularity = 'day') {
    const buckets = [];
    const byKey = new Map();
    for (const entry of Array.isArray(days) ? days : []) {
        const key = bucketKey(entry.day, granularity);
        let bucket = byKey.get(key);
        if (!bucket) {
            bucket = { key, label: bucketLabel(key, granularity), from: entry.day, to: entry.day, hebrew: granularity === 'day' ? hebrewDayLabel(entry.day) : '', values: {} };
            for (const metric of STATS_METRICS) bucket.values[metric] = 0;
            byKey.set(key, bucket);
            buckets.push(bucket);
        }
        bucket.to = entry.day;
        for (const metric of STATS_METRICS) bucket.values[metric] += count(entry[metric]);
    }
    return buckets;
}

export function chartValue(bucket, chart) {
    return chart.metrics.reduce((sum, metric) => sum + count(bucket?.values?.[metric]), 0);
}

export function totalsFor(days) {
    const totals = {};
    for (const metric of STATS_METRICS) totals[metric] = 0;
    for (const entry of Array.isArray(days) ? days : []) {
        for (const metric of STATS_METRICS) totals[metric] += count(entry[metric]);
    }
    return totals;
}

// גרף עמודות: עמודה לכל קבוצה, מימין לשמאל (הקבוצה הראשונה בצד ימין, כמו
// כיוון הקריאה). הגובה יחסי לערך המרבי; עמודה של אפס מקבלת קו דק כדי שיום בלי
// פעילות ייראה כיום ולא כחור בגרף.
export function barChartGeometry(values, { width = 320, height = 120, gap = 2, minBar = 1, rtl = true } = {}) {
    const list = (Array.isArray(values) ? values : []).map(count);
    const max = Math.max(0, ...list);
    const slot = list.length ? width / list.length : width;
    const barWidth = Math.max(1, slot - gap);
    const bars = list.map((value, index) => {
        const barHeight = max > 0 ? Math.max(minBar, Math.round((value / max) * height * 10) / 10) : minBar;
        const position = rtl ? width - (index + 1) * slot : index * slot;
        return { value, x: Math.round((position + gap / 2) * 10) / 10, y: Math.round((height - barHeight) * 10) / 10, width: Math.round(barWidth * 10) / 10, height: barHeight };
    });
    return { width, height, max, bars };
}

// תיאור קצר לקורא מסך: סך הכול, השיא ומתי.
export function chartSummary(chart, buckets) {
    const values = buckets.map(bucket => chartValue(bucket, chart));
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) return `${chart.title}: אין נתונים בטווח הזה.`;
    const max = Math.max(...values);
    const peak = buckets[values.indexOf(max)];
    return `${chart.title}: ${total} בסך הכול; השיא ${max} ב${peak.label}${peak.hebrew ? ` (${peak.hebrew})` : ''}.`;
}

// --- הנצפים ביותר ---

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

// הפריטים עם הכי הרבה צפיות, רק מתוך רשומות שעדיין קיימות בגלריה.
export function topViewedItems(mediaStats, images, limit = 10) {
    const byId = new Map((Array.isArray(images) ? images : []).map(item => [safeId(item?.id), item]));
    return (Array.isArray(mediaStats) ? mediaStats : [])
        .map(entry => ({ id: safeId(entry?.id), views: count(entry?.views), lastViewedAt: Number(entry?.lastViewedAt) || 0 }))
        .filter(entry => entry.id && entry.views > 0 && byId.has(entry.id))
        .sort((a, b) => b.views - a.views || b.lastViewedAt - a.lastViewedAt || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(entry => ({ ...entry, record: byId.get(entry.id) }));
}

// התיקיות לפי סכום הצפיות של הפריטים שבהן.
export function topViewedFolders(mediaStats, images, folders, limit = 10) {
    const folderOf = new Map((Array.isArray(images) ? images : []).map(item => [safeId(item?.id), safeId(item?.folderId)]));
    const names = new Map((Array.isArray(folders) ? folders : []).map(folder => [safeId(folder?.id), String(folder?.name || '')]));
    const totals = new Map();
    for (const entry of Array.isArray(mediaStats) ? mediaStats : []) {
        const folderId = folderOf.get(safeId(entry?.id));
        const views = count(entry?.views);
        if (!folderId || !views) continue;
        totals.set(folderId, (totals.get(folderId) || 0) + views);
    }
    return [...totals.entries()]
        .map(([id, views]) => ({ id, views, name: names.get(id) || 'תיקייה שנמחקה' }))
        .sort((a, b) => b.views - a.views || a.name.localeCompare(b.name, 'he'))
        .slice(0, limit);
}

// מי ביצע הכי הרבה פעולות ביומן הפעילות (שכבר נטען למנהל־העל) בטווח.
export function topActiveUsers(activityLogs, { since = 0, limit = 10 } = {}) {
    const totals = new Map();
    for (const log of Array.isArray(activityLogs) ? activityLogs : []) {
        if ((Number(log?.createdAt) || 0) < since) continue;
        const uid = safeId(log?.actorUid);
        if (!uid || uid === 'background-worker') continue;
        const current = totals.get(uid) || { uid, name: String(log?.actorName || 'משתמש'), actions: 0 };
        current.actions += 1;
        totals.set(uid, current);
    }
    return [...totals.values()].sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name, 'he')).slice(0, limit);
}

// --- אחסון ועלויות ---

export function storageRows(report) {
    const byPrefix = report?.byPrefix && typeof report.byPrefix === 'object' ? report.byPrefix : {};
    return Object.keys(STORAGE_GROUP_LABELS).map(group => ({
        group,
        label: STORAGE_GROUP_LABELS[group],
        objects: count(byPrefix[group]?.objects),
        bytes: count(byPrefix[group]?.bytes)
    }));
}

// הטקסט של שורת המכסה: "8 GB מתוך 10 GB (80%)" — ו-over כשעבר את הסף.
export function quotaLine(status, formatBytes = bytes => `${bytes} B`) {
    if (!status || status.bytes === null || status.bytes === undefined) return { text: 'לא ידוע', over: false, percent: null };
    if (!status.quotaBytes) return { text: `${formatBytes(status.bytes)} (לא הוגדרה מכסה)`, over: false, percent: null };
    return { text: `${formatBytes(status.bytes)} מתוך ${formatBytes(status.quotaBytes)} (${status.percent}%)`, over: Boolean(status.over), percent: status.percent };
}

// ערכי הטופס של הסף → מסמך systemMeta/storageBudget. ה-Worker בודק אותם שוב בקריאה.
export function budgetFromForm({ r2QuotaGb, d1QuotaMb, warnPercent }) {
    const positive = (value, max) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.min(max, Math.round(number * 1000) / 1000) : 0;
    };
    const percent = Math.trunc(Number(warnPercent));
    return {
        r2QuotaGb: positive(r2QuotaGb, 100000),
        d1QuotaMb: positive(d1QuotaMb, 100000 * 1024),
        warnPercent: Number.isFinite(percent) && percent >= 10 && percent <= 100 ? percent : 80
    };
}
