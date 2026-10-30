// admin-stats.js — מסך "סטטיסטיקות" בלוח הניהול (מנהל־על): שימוש לאורך זמן,
// הנצפים ביותר, הפעילים ביותר, ו"אחסון ועלויות". נטען עצלה בפתיחת המסך.
//
// הגרפים הם SVG פשוט שנבנה כאן, בלי ספריית גרפים: עמודה לכל יום, שבוע או
// חודש, עם תיאור לקורא מסך ועם אותם נתונים בטבלה רגילה ("הצגת הנתונים כטבלה").
// כל החישוב — השלמת ימים, קיבוץ, גיאומטריה — ב-admin-stats-model.js.

import {
    STATS_CHARTS, METRIC_LABELS, STATS_METRICS, fillDays, bucketize, chartValue, barChartGeometry,
    chartSummary, totalsFor, granularityForRange, topViewedItems, topViewedFolders, topActiveUsers,
    storageRows, quotaLine, budgetFromForm
} from './admin-stats-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RANGES = [30, 90, 365];
const RANGE_LABELS = { 30: '30 יום (לפי יום)', 90: '90 יום (לפי שבוע)', 365: 'שנה (לפי חודש)' };
let range = 30;
let statsRequest = 0;

function bytes(value) {
    return typeof window.formatBytes === 'function' ? window.formatBytes(value) : `${value} B`;
}

function setStatus(text) {
    const status = document.getElementById('statsStatus');
    if (status) status.textContent = text;
}

function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function renderRangeButtons() {
    const group = document.getElementById('statsRange');
    if (!group) return;
    group.replaceChildren();
    for (const days of RANGES) {
        const button = element('button', `admin-filter-chip ${days === range ? 'is-active' : ''}`, RANGE_LABELS[days]);
        button.type = 'button';
        button.setAttribute('aria-pressed', days === range ? 'true' : 'false');
        button.addEventListener('click', () => setAdminStatsRange(days));
        group.appendChild(button);
    }
}

function renderActiveUsers(activeUsers, totals) {
    const container = document.getElementById('statsActiveUsers');
    if (!container) return;
    container.replaceChildren();
    const cards = [
        ['פעילים היום', activeUsers?.today, 'cyan'],
        ['פעילים ב־7 ימים', activeUsers?.last7, 'violet'],
        ['פעילים ב־30 ימים', activeUsers?.last30, 'green'],
        ['אושרו בטווח', totals.approvals, 'gold'],
        ['נדחו בטווח', totals.rejections, 'danger']
    ];
    for (const [label, value, tone] of cards) {
        const card = element('div', 'admin-stat');
        card.dataset.tone = tone;
        const body = element('div');
        body.append(element('strong', '', String(Number(value) || 0)), element('span', '', label));
        card.appendChild(body);
        container.appendChild(card);
    }
}

function renderChart(chart, buckets, index) {
    const figure = element('figure', 'stats-chart');
    figure.dataset.tone = chart.tone;
    const values = buckets.map(bucket => chartValue(bucket, chart));
    const total = values.reduce((sum, value) => sum + value, 0);
    const caption = element('figcaption', 'stats-chart-caption');
    caption.append(element('strong', '', chart.title), element('span', '', `${total} · ${chart.hint}`));
    figure.appendChild(caption);

    const geometry = barChartGeometry(values, { width: 320, height: 96 });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'stats-chart-svg');
    svg.setAttribute('role', 'img');
    const titleId = `statsChartTitle${index}`;
    const descId = `statsChartDesc${index}`;
    svg.setAttribute('aria-labelledby', `${titleId} ${descId}`);
    const title = document.createElementNS(SVG_NS, 'title');
    title.id = titleId;
    title.textContent = chart.title;
    const desc = document.createElementNS(SVG_NS, 'desc');
    desc.id = descId;
    desc.textContent = chartSummary(chart, buckets);
    svg.append(title, desc);
    geometry.bars.forEach((bar, barIndex) => {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(bar.x));
        rect.setAttribute('y', String(bar.y));
        rect.setAttribute('width', String(bar.width));
        rect.setAttribute('height', String(bar.height));
        rect.setAttribute('class', bar.value ? 'stats-bar' : 'stats-bar is-empty');
        const tip = document.createElementNS(SVG_NS, 'title');
        const bucket = buckets[barIndex];
        tip.textContent = `${bucket.label}${bucket.hebrew ? ` (${bucket.hebrew})` : ''}: ${bar.value}`;
        rect.appendChild(tip);
        svg.appendChild(rect);
    });
    figure.appendChild(svg);
    const axis = element('div', 'stats-chart-axis');
    axis.setAttribute('aria-hidden', 'true');
    axis.append(element('span', '', buckets[0]?.label || ''), element('span', '', buckets[buckets.length - 1]?.label || ''));
    figure.appendChild(axis);
    return figure;
}

function renderTable(buckets) {
    const wrap = document.getElementById('statsTable');
    if (!wrap) return;
    wrap.replaceChildren();
    const table = element('table', 'stats-table');
    const caption = element('caption', '', `נתוני השימוש — ${RANGE_LABELS[range]}`);
    const head = element('thead');
    const headRow = element('tr');
    const firstHead = element('th', '', 'תקופה');
    firstHead.scope = 'col';
    headRow.appendChild(firstHead);
    for (const metric of STATS_METRICS) {
        const cell = element('th', '', METRIC_LABELS[metric]);
        cell.scope = 'col';
        headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    const body = element('tbody');
    for (const bucket of [...buckets].reverse()) {
        const row = element('tr');
        const label = element('th', '', bucket.hebrew ? `${bucket.label} · ${bucket.hebrew}` : bucket.label);
        label.scope = 'row';
        row.appendChild(label);
        for (const metric of STATS_METRICS) row.appendChild(element('td', '', String(bucket.values[metric] || 0)));
        body.appendChild(row);
    }
    table.append(caption, head, body);
    wrap.appendChild(table);
}

function renderUsage(payload) {
    const days = fillDays(payload?.days, payload?.from, payload?.to);
    const buckets = bucketize(days, granularityForRange(range));
    const totals = totalsFor(days);
    renderActiveUsers(payload?.activeUsers, totals);
    const charts = document.getElementById('statsCharts');
    if (charts) {
        charts.replaceChildren();
        STATS_CHARTS.forEach((chart, index) => charts.appendChild(renderChart(chart, buckets, index)));
    }
    renderTable(buckets);
    const since = document.getElementById('statsCollectedSince');
    if (since) {
        since.textContent = payload?.collectedSince
            ? `הנתונים נאספים מאז ${payload.collectedSince}. ביקור הוא משתמש מחובר אחד ביום; בשבוע ובחודש — סכום הימים.`
            : 'עדיין לא נאספו נתונים. הם מתחילים להיאסף מהביקור הראשון אחרי עדכון השרת.';
    }
}

function renderRankList(id, rows, describe, emptyText) {
    const list = document.getElementById(id);
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
        list.appendChild(element('li', 'admin-empty', emptyText));
        return;
    }
    for (const row of rows) {
        const item = element('li', 'stats-rank-item');
        const [name, value] = describe(row);
        item.append(element('span', 'stats-rank-name', name), element('span', 'stats-rank-value', value));
        list.appendChild(item);
    }
}

async function renderTopLists() {
    const state = window.state || {};
    let mediaStats = [];
    try {
        const { collection, getDocs } = window.firestoreModules || {};
        if (window.db && collection && getDocs) {
            const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats'));
            mediaStats = snapshot.docs.map(entry => entry.data());
        }
    } catch (error) {
        console.warn('קריאת מוני הצפיות נכשלה:', error);
    }
    renderRankList('statsTopFolders', topViewedFolders(mediaStats, state.images, state.folders),
        row => [row.name, `${row.views} צפיות`], 'עדיין אין צפיות.');
    renderRankList('statsTopItems', topViewedItems(mediaStats, state.images),
        row => [row.record?.title || 'ללא שם', `${row.views} צפיות`], 'עדיין אין צפיות.');
    // יומן הפעילות כבר טעון אצל מנהל־העל; מחוץ לטווח שנבחר הפעולות אינן נספרות.
    renderRankList('statsTopUsers', topActiveUsers(state.activityLogs, { since: Date.now() - range * 24 * 60 * 60 * 1000 }),
        row => [row.name, `${row.actions} פעולות`], 'אין פעולות מתועדות בטווח הזה.');
}

function renderStorage(payload) {
    const summary = document.getElementById('storageSummary');
    const report = payload?.report;
    if (summary) {
        summary.textContent = report?.completedAt
            ? `נכון ל־${new Date(report.completedAt).toLocaleString('he-IL')}: ${report.objects} קבצים, ${bytes(report.bytes)} באחסון (R2).`
            : (payload?.scanning ? `הסריקה הראשונה בדרך (${payload.scanning.objects} קבצים עד עכשיו).` : 'הסריקה היומית עוד לא רצה. היא רצה בתחזוקה הבאה, פעם ביום.');
    }
    const table = document.getElementById('storageTableBody');
    if (table) {
        table.replaceChildren();
        for (const row of storageRows(report)) {
            const tr = element('tr');
            const name = element('th', '', row.label);
            name.scope = 'row';
            tr.append(name, element('td', '', String(row.objects)), element('td', '', bytes(row.bytes)));
            table.appendChild(tr);
        }
    }
    const quota = document.getElementById('storageQuota');
    if (quota) {
        quota.replaceChildren();
        const status = payload?.status || {};
        for (const [label, entry] of [['אחסון (R2)', status.r2], ['מסד הנתונים (D1)', status.d1]]) {
            const line = quotaLine(entry, bytes);
            const row = element('p', `storage-quota-line ${line.over ? 'is-over' : ''}`);
            row.append(element('strong', '', `${label}: `), element('span', '', line.text));
            if (line.over) {
                row.setAttribute('role', 'alert');
                row.appendChild(element('span', 'storage-quota-warning', ` — מעל סף האזהרה (${status.warnPercent}%)`));
            }
            if (Number.isFinite(line.percent)) {
                const meter = element('progress', 'storage-quota-meter');
                meter.max = 100;
                meter.value = Math.min(100, line.percent);
                meter.setAttribute('aria-label', `${label}: ${line.percent}% מהמכסה`);
                row.appendChild(meter);
            }
            quota.appendChild(row);
        }
    }
    const jobs = document.getElementById('storageJobs');
    if (jobs) {
        const month = report?.jobs?.month;
        jobs.textContent = month
            ? `בחודש ${month}: ${report.jobs.aiDescriptions ?? '—'} תמונות קיבלו שם או כיתוב מה-AI, ו־${report.jobs.faceIndexed ?? '—'} עברו אינדוקס פנים.`
            : '';
    }
    const budget = payload?.budget || {};
    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input && document.activeElement !== input) input.value = value ? String(value) : '';
    };
    setValue('storageR2QuotaGb', budget.r2QuotaGb);
    setValue('storageD1QuotaMb', budget.d1QuotaMb);
    setValue('storageWarnPercent', budget.warnPercent || 80);
}

export async function loadAdminStats() {
    if (!window.canViewSuperAdminData?.() || typeof window.r2Request !== 'function') return;
    renderRangeButtons();
    const request = ++statsRequest;
    setStatus('טוען נתונים…');
    const [usage, storage] = await Promise.allSettled([
        window.r2Request(`/stats/usage?days=${range}`, { method: 'GET' }),
        window.r2Request('/maintenance/storage', { method: 'GET' })
    ]);
    if (request !== statsRequest || !window.canViewSuperAdminData?.()) return;
    const messages = [];
    if (usage.status === 'fulfilled') renderUsage(usage.value);
    else messages.push(usage.reason?.status === 404 ? 'השרת עדיין לא עודכן לסטטיסטיקות.' : `טעינת נתוני השימוש נכשלה: ${usage.reason?.message || ''}`);
    if (storage.status === 'fulfilled') renderStorage(storage.value);
    else messages.push(storage.reason?.status === 404 ? 'השרת עדיין לא עודכן לדוח האחסון.' : `טעינת דוח האחסון נכשלה: ${storage.reason?.message || ''}`);
    await renderTopLists();
    if (request === statsRequest) setStatus(messages.join(' '));
}

export function setAdminStatsRange(days) {
    range = RANGES.includes(Number(days)) ? Number(days) : 30;
    return loadAdminStats();
}

// הסף נשמר כמסמך systemMeta פנימי (רק מנהל־על קורא וכותב, ראו SYSTEM_META_PRIVATE_IDS).
export async function saveStorageBudget() {
    if (!window.checkSuperAdminPermission?.()) return;
    const value = id => document.getElementById(id)?.value;
    const budget = budgetFromForm({ r2QuotaGb: value('storageR2QuotaGb'), d1QuotaMb: value('storageD1QuotaMb'), warnPercent: value('storageWarnPercent') });
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'storageBudget'), {
            ...budget,
            updatedAt: Date.now(),
            updatedBy: window.state?.currentUser?.uid || ''
        });
        window.showNotification('סף האחסון נשמר.', true);
        await loadAdminStats();
    } catch (error) {
        console.error('Saving storage budget failed:', error);
        window.showNotification(error?.message || 'שמירת הסף נכשלה.', false);
    }
}
