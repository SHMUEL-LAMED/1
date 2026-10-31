// invite-link.js — קישור הזמנה לאירוע בדף הגלריה (#invite/<אסימון>).
//
// הסקריפט שבראש index.html קורא את האסימון מה-hash לפני כל סקריפט אחר, שומר
// אותו ב-sessionStorage של הלשונית בלבד ומוחק אותו מהכתובת מיד — כך הוא אינו
// נשאר בהיסטוריה, בסימניות או בקישור ש"שתף" מעתיק. המודול (מיובא ראשון
// ב-app.js) עושה אותו דבר כגיבוי, ומממש את ההזמנה אחרי ההתחברות. האסימון לעולם אינו נשלח
// בכתובת: רק בגוף בקשת POST /invites/redeem, אחרי שהמבקר התחבר עם Google.
//
// אחרי המימוש: מבקר שאושר אוטומטית מגיע לאירוע; אחר — מקבל הודעה שבקשת
// ההצטרפות נשלחה עם ההזמנה, והמנהל רואה "הגיע מהזמנה לאירוע X".
import { parseInviteHash, inviteRedeemMessage, inviteErrorMessage } from './users-model.js';

const STORAGE_KEY = 'simchas_pending_invite';
const FOLDER_KEY = 'simchas_invite_folder';
let redeeming = false;
let memoryToken = '';

function readToken() {
    try { return sessionStorage.getItem(STORAGE_KEY) || ''; } catch { return memoryToken; }
}

function storeToken(token) {
    memoryToken = token;
    try {
        if (token) sessionStorage.setItem(STORAGE_KEY, token);
        else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* מצב פרטי: נשאר בזיכרון של הדף */ }
}

export function captureInviteFromLocation(location = window.location, history = window.history) {
    const token = parseInviteHash(location.hash);
    if (!token) return false;
    storeToken(token);
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    return true;
}

function rememberInviteFolder(folderId) {
    try { sessionStorage.setItem(FOLDER_KEY, String(folderId)); } catch { window.state.inviteFolderId = String(folderId); }
}

// התיקייה של האירוע שאליו המבקר הוזמן — פעם אחת, אחרי שהגלריה נפתחה לו.
export function takeInviteFolder() {
    let folderId = '';
    try {
        folderId = sessionStorage.getItem(FOLDER_KEY) || '';
        sessionStorage.removeItem(FOLDER_KEY);
    } catch { /* מצב פרטי */ }
    folderId ||= window.state?.inviteFolderId || '';
    if (window.state) window.state.inviteFolderId = '';
    return /^[a-zA-Z0-9_-]{1,120}$/.test(folderId) ? folderId : '';
}

export function hasPendingInvite() {
    return Boolean(readToken() || memoryToken);
}

// נקרא אחרי שהפרופיל של המחובר נטען (session-auth.js → app.js). מבקר שעוד לא
// התחבר — רק מתבקש להתחבר.
export async function redeemPendingInvite() {
    const token = readToken() || memoryToken;
    if (!token || redeeming || !window.state?.isGoogleUser || !window.state?.currentUser?.uid) return null;
    redeeming = true;
    // האסימון נמחק לפני השליחה: גם תשובה שלא מגיעה לא תגרום לניסיון חוזר בלולאה.
    storeToken('');
    try {
        const result = await window.r2Request('/invites/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        window.showNotification?.(inviteRedeemMessage(result), result?.status !== 'rejected');
        if (result?.autoApproved) {
            // אושר עכשיו: הפרופיל שבדף עוד אומר "ממתין", ולכן הדף נטען מחדש ונפתח
            // כצופה — ישר בתיקיית האירוע (takeInviteFolder ב-afterProfileReady).
            rememberInviteFolder(result.folderId);
            window.setTimeout(() => window.location.reload(), 1500);
        } else if (result?.status === 'approved' && result.folderId) {
            // כבר מאושר: הגלריה פתוחה, ורק עוברים לאירוע.
            window.setTimeout(() => window.setActiveFolder?.(result.folderId), 300);
        }
        return result;
    } catch (error) {
        console.warn('Invite redemption failed:', error?.code || error?.status || 'error');
        window.showNotification?.(inviteErrorMessage(error), false);
        return null;
    } finally {
        redeeming = false;
    }
}

function announceInvite() {
    // אחרי שהממשק עלה, הודעה אחת: מה לעשות עם הקישור.
    window.setTimeout(() => {
        if (!hasPendingInvite() || window.state?.isGoogleUser) return;
        window.showNotification?.('הוזמנת לאירוע בגלריה. התחבר עם Google כדי להצטרף.', true);
    }, 1500);
}

// הסקריפט שבראש index.html כבר שמר את האסימון ומחק אותו מהכתובת; כאן — גיבוי,
// למקרה שהאחסון היה חסום שם.
if (typeof window !== 'undefined') {
    captureInviteFromLocation();
    if (hasPendingInvite()) announceInvite();
}

window.redeemPendingInvite = redeemPendingInvite;
window.hasPendingInvite = hasPendingInvite;
