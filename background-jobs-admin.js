const labels = { titles: 'שמות AI', faces: 'אינדוקס פנים', variants: 'תצוגות מקדימות', dates: 'תאריכי צילום', drive: 'סנכרון Drive' };
const controls = {
    titles: ['aiTitlesStart', 'aiTitlesStop', 'aiTitlesStatus'],
    faces: ['faceIndexStartBtn', 'faceIndexStopBtn', 'faceIndexStatusText'],
    variants: ['variantsStartBtn', 'variantsStopBtn', 'variantsStatusText'],
    dates: ['captureDatesStartBtn', 'captureDatesStopBtn', 'captureDatesStatusText'],
    drive: ['workerSyncBtn', null, 'workerSyncResult']
};
let refreshing = false;
// כשהעיבוד בענן כבוי (CLOUD_BACKGROUND_JOBS=false, ריצה מקומית בדפדפן) מצב הענן
// אינו נכתב למסכים — גם לא מבקשה שיצאה לפני הכיבוי — כדי שלא ידרוס את מצב
// הריצה המקומית.
export async function refreshCloudBackgroundJobs() {
    if (!window.CLOUD_BACKGROUND_JOBS || !window.state?.isAdminLoggedIn || refreshing) return;
    refreshing = true;
    try {
        const [{ config }, { state }] = await Promise.all([window.r2Request('/background/config'), window.r2Request('/background/status')]);
        if (!window.CLOUD_BACKGROUND_JOBS) return;
        const summary = document.getElementById('cloudBackgroundSummary');
        const active = state.phase && !['idle', 'failed'].includes(state.phase) && Date.now() - state.updatedAt < 20 * 60 * 1000;
        const last = state.updatedAt ? new Date(state.updatedAt).toLocaleString('he-IL') : 'ממתין לריצה הראשונה';
        if (summary) summary.replaceChildren();
        for (const [name, ids] of Object.entries(controls)) {
            const enabled = config.enabled[name];
            const job = state.jobs?.[name] || {};
            const message = `${enabled ? (active && state.phase === name ? 'מעבד עכשיו בענן' : 'פעיל בענן') : 'מושהה'} · בריצה האחרונה: ${job.processed || 0} הושלמו, ${job.failed || 0} נכשלו${job.message ? ` · ${job.message}` : ''}`;
            const start = document.getElementById(ids[0]);
            const stop = ids[1] && document.getElementById(ids[1]);
            const status = document.getElementById(ids[2]);
            if (start) { start.disabled = false; start.textContent = enabled ? 'המשך אוטומטי בענן' : 'הפעל בענן'; }
            if (stop) stop.disabled = !enabled;
            if (status) status.textContent = `${message}. אפשר לסגור את הדפדפן. עדכון אחרון: ${last}`;
            if (summary) {
                const line = document.createElement('p');
                line.textContent = `${labels[name]}: ${message}`;
                summary.append(line);
            }
        }
    } catch (error) {
        window.reportClientError?.(error, 'background-status');
    } finally { refreshing = false; }
}
export async function setCloudBackgroundJob(name, enabled) {
    if (!window.checkAdminPermission?.() || !(name in labels)) return;
    try {
        await window.r2Request('/background/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: { [name]: enabled } }) });
        await refreshCloudBackgroundJobs();
        window.showNotification?.(enabled ? 'העיבוד מופעל בענן וימשיך גם כשהדפדפן סגור. הריצה הבאה בתוך כ־15 דקות.' : 'העיבוד הושהה בענן. הפריט שכבר בטיפול יושלם.', true);
    } catch (error) { window.showNotification?.(error.message || 'לא ניתן לעדכן את העיבוד בענן.', false); }
}
window.refreshCloudBackgroundJobs = refreshCloudBackgroundJobs;
window.setCloudBackgroundJob = setCloudBackgroundJob;
window.setInterval(() => { if (!document.hidden) refreshCloudBackgroundJobs(); }, 15000);
