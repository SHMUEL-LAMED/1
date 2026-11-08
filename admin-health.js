// admin-health.js — מסך "תקינות המערכת" בלוח הניהול: בדיקת Cloudflare D1 ו-R2,
// הרשאות מסד הנתונים, זיהוי הפנים והאינדוקס בענן, התצוגות המקדימות וחיבור Drive.
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציה נרשמת על window באותו שם.
//
// העוזרים המשותפים (scheduleIconRefresh, R2_WORKER_BASE_URL) נקראים מ-window
// בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא ישבור אותם.

export async function runSystemHealthCheck() {
    const { scheduleIconRefresh, R2_WORKER_BASE_URL } = window;
    const container = document.getElementById('systemHealthResults');
    if (!container) return;
    container.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'admin-empty';
    loading.textContent = 'בודק את שירותי המערכת…';
    container.appendChild(loading);

    const checks = [
        {
            label: 'Cloudflare D1 והתחברות',
            run: async () => {
                if (!window.db) throw new Error('מסד הנתונים עדיין לא מחובר');
                if (!window.state.currentUser) throw new Error('אין משתמש מחובר');
                return 'מחובר';
            }
        },
        {
            label: 'הרשאות מסד הנתונים',
            run: async () => {
                if (!window.state.isSuperAdmin) return 'בדיקה מלאה זמינה למנהל־על';
                const { collection, getDocs } = window.firestoreModules;
                await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems'));
                return 'סל המחזור מורשה';
            }
        },
        {
            label: 'Cloudflare R2',
            run: async () => {
                const response = await fetch(`${R2_WORKER_BASE_URL}/health`);
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.bucketConnected !== true || payload.databaseConnected !== true) throw new Error(payload.message || 'האחסון אינו זמין');
                return 'R2 ו־D1 מחוברים';
            }
        },
        {
            label: 'זיהוי פנים',
            run: async () => typeof window.faceapi === 'undefined'
                ? 'ייטען בעת פתיחת חיפוש הפנים'
                : 'הספרייה נטענה'
        },
        {
            label: 'אינדוקס פנים בענן',
            run: async () => {
                // בלי טעינת המודול refreshFaceIndexSummary אינה קיימת,
                // והבדיקה הייתה מדווחת "אינו זמין" גם כשהאינדוקס תקין.
                await window.ensureFaceIndexModule?.();
                const summary = await window.refreshFaceIndexSummary?.();
                if (!summary) throw new Error('מצב האינדוקס אינו זמין');
                return summary.ready
                    ? `מוכן — ${summary.indexedImages} תמונות, ${summary.faceCount} פרצופים`
                    : `נותרו ${summary.remainingImages} תמונות להכנה`;
            }
        },
        {
            label: 'תצוגות מקדימות',
            run: async () => {
                await window.ensureMediaVariantsModule?.();
                const summary = await window.refreshMediaVariantsSummary?.();
                if (!summary) throw new Error('רשימת המדיה אינה זמינה');
                return summary.missing
                    ? `נותרו ${summary.missing} פריטים בלי תצוגות — הפעילו את הריצה במסך "תצוגות מקדימות"`
                    : `מוכן — ${summary.total} פריטים עם תצוגות`;
            }
        },
        {
            label: 'Google Drive',
            run: async () => window.driveConnectionActive ? 'מחובר כעת' : 'לא מחובר — חברו בעת הצורך'
        }
    ];

    const results = [];
    for (const check of checks) {
        try {
            results.push({ label: check.label, ok: true, message: await check.run() });
        } catch (error) {
            results.push({ label: check.label, ok: false, message: error.message || 'הבדיקה נכשלה' });
        }
    }

    container.replaceChildren();
    results.forEach(result => {
        const row = document.createElement('div');
        row.className = 'admin-row';
        row.innerHTML = `<span class="admin-stat-icon" data-tone="${result.ok ? 'green' : 'danger'}"><i data-lucide="${result.ok ? 'circle-check' : 'circle-alert'}" class="w-4 h-4"></i></span>`;
        const text = document.createElement('div');
        text.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'admin-row-title';
        title.textContent = result.label;
        const detail = document.createElement('p');
        detail.className = 'admin-row-meta';
        detail.textContent = result.message;
        text.append(title, detail);
        row.appendChild(text);
        container.appendChild(row);
    });
    scheduleIconRefresh(container);
}
window.runSystemHealthCheck = runSystemHealthCheck;
