// יומן הפעילות: רישום והצגה
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { formatDate, safeRecordId } from '../core/utils.js';
import { scheduleIconRefresh } from '../ui/icons.js';

window.logActivity = async function(action, targetType, targetId, targetName, details = '') {
    if (!window.db || !window.state.currentUser?.uid) return;
    try {
        const { doc, setDoc } = window.firestoreModules;
        const logId = `log_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'activityLogs', logId), {
            id: logId,
            action: String(action || 'activity').slice(0, 60),
            targetType: String(targetType || '').slice(0, 40),
            targetId: safeRecordId(targetId),
            targetName: String(targetName || '').slice(0, 160),
            details: String(details || '').slice(0, 400),
            actorUid: window.state.currentUser.uid,
            actorName: window.state.currentUser.displayName || window.state.currentUser.email || 'משתמש',
            actorRole: window.state.userRole || 'viewer',
            createdAt: Date.now()
        });
    } catch (error) {
        console.warn('Activity log write failed:', error);
    }
};

window.renderActivityLogs = function() {
    const list = document.getElementById('activityLogList');
    const summary = document.getElementById('activitySummary');
    const logs = window.state.activityLogs || [];
    if (summary) {
        const cards = [
            ['users', (window.state.pendingUsers || []).length, 'הצטרפות'],
            ['image-plus', (window.state.pendingImages || []).length, 'לאישור'],
            ['trash-2', (window.state.deletionRequests || []).length, 'בקשות מחיקה'],
            ['archive-restore', (window.state.trashItems || []).length, 'בסל']
        ];
        summary.innerHTML = cards.map(([icon, value, label]) => `
            <div class="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                <i data-lucide="${icon}" class="w-4 h-4 mx-auto mb-1 text-cyan-300"></i>
                <strong class="block text-lg text-white">${value}</strong>
                <span class="text-[9px] text-slate-400">${label}</span>
            </div>`).join('');
    }
    if (!list) return;
    list.innerHTML = '';
    if (!logs.length) {
        list.innerHTML = '<p class="text-xs text-center text-slate-500 py-6">עדיין אין פעולות מתועדות.</p>';
    } else {
        const actionLabels = {
            moved_to_trash: 'העביר לסל המחזור',
            restored: 'שחזר פריט',
            purged: 'מחק לצמיתות',
            approved_user: 'אישר משתמש',
            changed_role: 'שינה דרגה',
            changed_block: 'שינה חסימה',
            approved_images: 'אישר תמונות',
            uploaded_images: 'העלה תמונות',
            synced_drive: 'סנכרן Drive',
            resolved_support: 'סימן פנייה כטופלה',
            reopened_support: 'פתח פנייה מחדש'
        };
        logs.slice(0, 50).forEach(log => {
            const row = document.createElement('article');
            row.className = 'rounded-xl border border-white/10 bg-white/5 p-3';
            const title = document.createElement('p');
            title.className = 'text-[11px] font-bold text-slate-100';
            title.textContent = `${log.actorName || 'משתמש'} — ${actionLabels[log.action] || log.action || 'פעולה'}`;
            const meta = document.createElement('p');
            meta.className = 'text-[9px] text-slate-400 mt-1';
            meta.textContent = `${log.targetName || log.targetId || ''}${log.details ? ` · ${log.details}` : ''} · ${formatDate(log.createdAt)}`;
            row.append(title, meta);
            list.appendChild(row);
        });
    }
    scheduleIconRefresh();
};
