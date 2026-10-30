// pending-swipe-model.js — ההיגיון של "מצב מהיר" באישור העלאות, בלי DOM:
// לאן החלקה מובילה (אישור או דחייה, לפי כיוון הקריאה), איזה מקש עושה מה,
// מה מוצג על הכרטיס, ותור ההחלטות עם חלון הביטול — ההחלטה נשמרת בשרת רק
// כשהחלון נסגר, ולכן "בטל" אינו צריך מסלול שחזור בשרת. pending-swipe.js
// מחבר אותו לדף, והבדיקות (pending-swipe-model.test.mjs) בודקות אותו
// ישירות עם שעונים מוזרקים — כמו big-screen-model.js.

import { lockAxis, SWIPE_FLICK_VELOCITY } from './lightbox-math.js';

// כמה זמן אפשר לבטל החלטה לפני שהיא נשלחת לשרת.
export const SWIPE_UNDO_MS = 5_000;
// אישור או דחייה: גרירה של כרבע מרוחב הכרטיס, או הנפה מהירה של 60px לפחות.
// הסף גבוה מזה של התצוגה המלאה בכוונה: כאן החלקה בטעות שולחת פריט לגלריה.
export const SWIPE_DECIDE_RATIO = 0.28;
export const SWIPE_DECIDE_MIN = 80;
export const SWIPE_DECIDE_FLICK = 60;

export const SWIPE_ACTIONS = Object.freeze(['approve', 'reject']);

// לאיזו החלטה גרירה אופקית מובילה. הכרטיס עף אל הכפתור שלו: "אשר" הוא
// הראשון בשורה, ולכן יושב בצד תחילת השורה — מימין באתר העברי, משמאל
// ב-LTR. גרירה ימינה באתר שלנו היא אישור, כמו המוסכמה המוכרת.
export function swipeActionForDx(dx, direction = 'rtl') {
    if (!dx) return null;
    const towardStart = direction === 'ltr' ? dx < 0 : dx > 0;
    return towardStart ? 'approve' : 'reject';
}

// ההחלטה בסוף מחווה: 'approve', 'reject' או null (הכרטיס חוזר למקומו).
// מחווה אנכית אינה מחליטה דבר — היא גלילה של הדף או של פרטי הכרטיס.
export function decideCardSwipe({ dx = 0, dy = 0, vx = 0, width = 0, direction = 'rtl' } = {}) {
    if (lockAxis(dx, dy) !== 'x') return null;
    const action = swipeActionForDx(dx, direction);
    if (!action) return null;
    const far = Math.abs(dx) >= Math.max(SWIPE_DECIDE_MIN, width * SWIPE_DECIDE_RATIO);
    // הנפה נחשבת רק כשהיד עדיין נעה לכיוון הגרירה בסוף המחווה.
    const flick = Math.abs(dx) >= SWIPE_DECIDE_FLICK && Math.abs(vx) > SWIPE_FLICK_VELOCITY && Math.sign(vx) === Math.sign(dx);
    return far || flick ? action : null;
}

// כמה "קרוב להחלטה" הכרטיס בזמן הגרירה (0–1), לחותמת "אשר"/"דחה" שמתחזקת.
export function swipeProgress(dx, width = 0) {
    const threshold = Math.max(SWIPE_DECIDE_MIN, (Number(width) || 0) * SWIPE_DECIDE_RATIO);
    return Math.min(1, Math.abs(Number(dx) || 0) / threshold);
}

// מקלדת: החצים לפי הכיוון שאליו הכרטיס עף (כמו בגרירה), A/R לפי המקש
// הפיזי (event.code) — כך הם עובדים גם כשהמקלדת בעברית (ש/ר) — Enter
// מאשר, Z או Backspace (וגם Ctrl+Z) מבטלים, ו-Escape יוצא מהמצב המהיר.
// מקש עם Ctrl/Alt/Meta אחר שייך לדפדפן, ולכן אינו נתפס.
export function keyAction({ key = '', code = '', ctrlKey = false, metaKey = false, altKey = false, shiftKey = false } = {}, direction = 'rtl') {
    if ((ctrlKey || metaKey) && !altKey && (code === 'KeyZ' || key === 'z' || key === 'Z')) return 'undo';
    if (ctrlKey || metaKey || altKey) return null;
    if (key === 'Escape') return 'close';
    if (key === 'ArrowRight') return swipeActionForDx(1, direction);
    if (key === 'ArrowLeft') return swipeActionForDx(-1, direction);
    if (key === 'Enter' && !shiftKey) return 'approve';
    if (code === 'KeyA' || key === 'a' || key === 'A') return 'approve';
    if (code === 'KeyR' || key === 'r' || key === 'R') return 'reject';
    if (code === 'KeyZ' || code === 'KeyU' || key === 'Backspace') return 'undo';
    return null;
}

// סדר התור לאורך המפגש. הרשימה בלוח ממוינת מהחדש לישן ומתעדכנת בסקר,
// ופריט שהגיע עכשיו היה קופץ לראשה ומחליף את הכרטיס שהמנהל מסתכל עליו.
// לכן הסדר נקבע בפתיחה: מה שנעלם מהמקור יוצא, ומה שחדש נכנס לסוף.
export function mergeQueueOrder(previousOrder, sourceIds) {
    const source = [];
    const seen = new Set();
    for (const raw of sourceIds || []) {
        const id = String(raw ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        source.push(id);
    }
    const kept = [];
    const known = new Set();
    for (const raw of previousOrder || []) {
        const id = String(raw ?? '');
        if (!seen.has(id) || known.has(id)) continue;
        known.add(id);
        kept.push(id);
    }
    return [...kept, ...source.filter(id => !known.has(id))];
}

const DEFAULT_FOLDER_NAME = 'כללי';

function validTime(value) {
    const ms = Number(value);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// מה מוצג על הכרטיס. היעד מחושב כמו באישור עצמו (approveSelectedPending
// ב-admin.js): "אוטומטי" שומר בתיקייה בשם התיקייה המקורית, ויוצר אותה
// אם אינה קיימת; יעד אחר הוא תיקייה קיימת לפי מזהה.
export function pendingCardDetails(record, { folders = [], targetFolderId = 'auto', isVideo = false } = {}) {
    const sourceFolder = String(record?.originalFolderName || '').trim();
    let destination = '';
    let createsFolder = false;
    if (!targetFolderId || targetFolderId === 'auto') {
        destination = sourceFolder || DEFAULT_FOLDER_NAME;
        createsFolder = !folders.some(folder => folder?.name === destination);
    } else {
        destination = folders.find(folder => String(folder?.id) === String(targetFolderId))?.name || '';
    }
    return {
        title: String(record?.title || '').trim() || (isVideo ? 'סרטון ללא שם' : 'תמונה ללא שם'),
        kind: isVideo ? 'סרטון' : 'תמונה',
        uploader: String(record?.uploadedByName || '').trim() || String(record?.uploadedByEmail || '').trim() || 'מעלה לא ידוע',
        uploaderEmail: String(record?.uploadedByName || '').trim() ? String(record?.uploadedByEmail || '').trim() : '',
        sourceFolder,
        destination,
        createsFolder,
        uploadedAt: validTime(record?.createdAt),
        takenAt: validTime(record?.takenAt)
    };
}

// תור ההחלטות של המצב המהיר. החלטה נכנסת להמתנה ל-undoMs, ורק אז
// commit(id, action, meta) רץ — אותן פונקציות אישור ודחייה של הלוח. בכל
// רגע יש לכל היותר החלטה אחת שאפשר לבטל: החלטה חדשה שולחת מיד את הקודמת,
// וכך "בטל" תמיד מחזיר את הפריט האחרון, כמו שהכפתור מבטיח.
// פריט שהוחלט (ממתין, נשלח או נשמר) אינו חוזר לתור; אם השמירה נכשלה הוא
// חוזר, ו-onError מקבל את השגיאה.
export function createSwipeSession({
    undoMs = SWIPE_UNDO_MS,
    commit = async () => {},
    onChange = () => {},
    onError = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    now = () => Date.now()
} = {}) {
    const handled = new Map(); // מזהה → פעולה, לכל מה שכבר הוחלט במפגש הזה
    const inFlight = new Set();
    let pending = null;        // { id, action, meta, deadline, timer }
    let committed = 0;
    // השמירות רצות בזו אחר זו, כמו הלולאה של "אשר נבחרים": שני אישורים
    // מהירים לאותה תיקייה מקורית שעוד אינה קיימת היו יוצרים אותה פעמיים,
    // כי התיקייה נכנסת ל-state.folders רק כשהשמירה שלה מסתיימת.
    let chain = Promise.resolve();
    // מסתיים כשכל מה שנשלח עד עכשיו הסתיים (הצליח או נכשל) — ל-drain.
    let settled = Promise.resolve();

    function send(entry) {
        inFlight.add(entry.id);
        const result = chain.then(() => commit(entry.id, entry.action, entry.meta));
        chain = result.catch(() => {});
        const done = result
            .then(() => { committed += 1; })
            .catch(error => {
                handled.delete(entry.id);
                onError(error, { id: entry.id, action: entry.action });
            })
            .finally(() => {
                inFlight.delete(entry.id);
                onChange();
            });
        settled = done;
        return done;
    }

    // שולח עכשיו את ההחלטה שממתינה (אם יש), בלי לחכות לסוף החלון.
    function flush() {
        if (!pending) return Promise.resolve();
        const entry = pending;
        pending = null;
        clearTimer(entry.timer);
        return send(entry);
    }

    // כמו flush, אבל מחכה גם לשמירות שכבר בדרך: ההבטחה מסתיימת רק כשכל
    // מה שהוחלט עד עכשיו נשמר או נכשל. ההתנתקות מחכה לה, כדי שההחלטות
    // יישלחו בשם המנהל שקיבל אותן ולא אחרי שהאסימון שלו כבר נמחק.
    function drain() {
        flush();
        return settled;
    }

    return {
        // הפריטים שעדיין צריך להחליט עליהם, בסדר שקיבלנו.
        queue(ids) {
            return (ids || []).map(String).filter(id => id && !handled.has(id));
        },
        decide(id, action, meta = undefined) {
            const key = String(id || '');
            if (!key || !SWIPE_ACTIONS.includes(action) || handled.has(key)) return false;
            if (pending) flush();
            handled.set(key, action);
            const entry = { id: key, action, meta, deadline: now() + undoMs, timer: null };
            entry.timer = setTimer(() => {
                if (pending === entry) flush();
            }, undoMs);
            pending = entry;
            onChange();
            return true;
        },
        undo() {
            if (!pending) return null;
            const entry = pending;
            pending = null;
            clearTimer(entry.timer);
            handled.delete(entry.id);
            onChange();
            return { id: entry.id, action: entry.action };
        },
        // סוף המפגש בלי לשמור: ההחלטה שממתינה נזרקת (לא נשלחת), וכל מה
        // שהוחלט נשכח — חשבון אחר שייכנס יראה שוב את כל הפריטים. שמירה שכבר
        // בדרך ממשיכה; commit עצמו אחראי לבדוק שהחשבון לא התחלף בינתיים.
        reset() {
            const entry = pending;
            pending = null;
            if (entry) clearTimer(entry.timer);
            handled.clear();
            onChange();
            return entry ? { id: entry.id, action: entry.action } : null;
        },
        flush,
        drain,
        get pending() {
            return pending ? { id: pending.id, action: pending.action, deadline: pending.deadline } : null;
        },
        get busy() {
            return inFlight.size > 0;
        },
        get committed() {
            return committed;
        },
        isHandled(id) {
            return handled.has(String(id || ''));
        }
    };
}
