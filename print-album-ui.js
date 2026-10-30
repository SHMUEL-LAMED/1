// print-album-ui.js — אלבום להדפסה: החלון, טעינת התמונות וההדפסה.
//
// נטען עצלה (app.js) מ"אלבום להדפסה" בעמוד האירוע ומ"אלבום PDF" בסרגל הבחירה
// המרובה. ה-PDF הוא של הדפדפן: האלבום נבנה כעמודי A4 בתוך #printAlbum, שמוסתר
// במסך, ו-window.print() מדפיס רק אותו (body.is-printing-album ב-styles.css).
// כך אין ספריית PDF כבדה, והטקסט העברי, הגופן וכיוון הקריאה הם בדיוק של הדף.
//
// לפני ההדפסה כל התמונות נטענות ומפוענחות — אחרת חלון ההדפסה היה מצלם
// ריבועים ריקים — עם התקדמות בחלון ואפשרות ביטול. התמונות שנטענו הן אותם
// אלמנטים שנכנסים לעמודים, כך שאין טעינה שנייה; תמונה שלא נטענה יוצאת
// מהאלבום והעמודים מתחלקים בלעדיה. ההחלטות עצמן (מה נכנס, הסדר, החלוקה
// לעמודים, השער) — ב-print-album.js, שנבדק ב-Node.
import {
    ALBUM_PER_PAGE_KEY, ALBUM_MAX_ITEMS, normalizeAlbumPerPage, paginateAlbum,
    prepareAlbumItems, albumCoverDate, albumCountLabel
} from './print-album.js';
import { readGalleryPreference, writeGalleryPreference } from './gallery-layout.js';
// לולאת המסלולים המקבילים של ריצת התצוגות: מוגבלת, עוצרת בין פריטים, וכישלון
// של פריט אחד אינו עוצר את השאר — בדיוק מה שהטעינה כאן צריכה.
import { runVariantBackfill } from './media-variants.js';

// מעט מסלולים: הדפדפן ממילא מגביל חיבורים לשרת, ושלושה-ארבעה מספיקים כדי
// שהביטול ייענה מיד ולא אחרי עשרות בקשות שכבר יצאו.
const PRELOAD_CONCURRENCY = 4;
// תמונה שלא נטענה בזמן הזה נחשבת לכישלון ויוצאת מהאלבום, במקום לתקוע אותו.
const IMAGE_TIMEOUT_MS = 30_000;

// האלבום שהחלון פתוח עליו: { title, eventDate, description, folderId | records, ownerUid }.
let pendingAlbum = null;
// הטעינה שרצה: { cancelled, aborts } — aborts מסיימים מיד טעינות שבדרך.
let activeJob = null;

function readPerPage() {
    return readGalleryPreference(ALBUM_PER_PAGE_KEY, normalizeAlbumPerPage);
}

function selectedPerPage() {
    const checked = document.querySelector('input[name="printAlbumPerPage"]:checked');
    return normalizeAlbumPerPage(checked?.value ?? readPerPage());
}

function setProgress(text, fraction = 0) {
    const box = document.getElementById('printAlbumProgress');
    const bar = document.getElementById('printAlbumProgressBar');
    const status = document.getElementById('printAlbumStatus');
    if (box) box.hidden = !text;
    if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (status) status.textContent = text || '';
}

// בזמן הטעינה הבחירה נעולה והכפתור אינו לחיץ; "ביטול" נשאר פעיל תמיד.
function setBusy(busy) {
    const start = document.getElementById('printAlbumStartBtn');
    if (start) start.disabled = busy;
    document.querySelectorAll('input[name="printAlbumPerPage"]').forEach(input => { input.disabled = busy; });
    document.getElementById('printAlbumModal')?.setAttribute('aria-busy', String(busy));
}

// המזהה של המשתמש המחובר והמאושר לצפייה, או '' כשאין כזה (אורח, ממתין
// לאישור, מי שהאישור שלו בוטל). אותו תנאי כמו ב-people.js: גם מנהל מאושר.
function approvedViewerUid() {
    const state = window.state;
    if (!state?.isGoogleUser || state.userApprovalStatus !== 'approved') return '';
    return String(state.currentUser?.uid || '');
}

// האלבום שייך למי שפתח את החלון. התנתקות, החלפת חשבון ואובדן אישור מאפסים
// אותו (resetPrintAlbum מ-session-auth.js), וזו הגנה נוספת למקרה שהאיפוס לא
// הספיק לרוץ: אחרת הבא בלשונית היה מדפיס את התמונות שהקודם בחר.
function albumBelongsToViewer(album) {
    const uid = approvedViewerUid();
    return Boolean(album?.ownerUid) && album.ownerUid === uid;
}

function openAlbumDialog(album) {
    const ownerUid = approvedViewerUid();
    if (!ownerUid) return;
    pendingAlbum = { ...album, ownerUid };
    const perPage = readPerPage();
    document.querySelectorAll('input[name="printAlbumPerPage"]').forEach(input => {
        input.checked = Number(input.value) === perPage;
        input.onchange = () => writeGalleryPreference(ALBUM_PER_PAGE_KEY, String(normalizeAlbumPerPage(input.value)));
    });
    const summary = document.getElementById('printAlbumSummary');
    if (summary) {
        const count = Number(album.expected) || 0;
        summary.textContent = `${album.title} · ${count === 1 ? 'פריט אחד' : `${count} פריטים`}`;
    }
    setProgress('');
    setBusy(false);
    window.openModal('printAlbumModal');
    window.scheduleIconRefresh?.();
}

// מעמוד האירוע: התיקייה כולה, גם מה שעוד לא נגלל (loadAllFolderImages).
window.openFolderPrintAlbum = function(folderId) {
    const id = window.safeRecordId(folderId);
    const folder = window.state.folders.find(item => window.safeRecordId(item.id) === id);
    if (!folder || id === 'all') return;
    const loaded = window.getLoadedFolderImages?.(id)?.length || 0;
    openAlbumDialog({
        title: folder.name || 'אירוע',
        eventDate: folder.eventDate || '',
        description: folder.description || '',
        folderId: id,
        expected: Math.max(loaded, Number(window.state.folderCounts?.[id]) || 0)
    });
};

// מסרגל הבחירה המרובה: הנבחרים בלבד. כולם מאותה תיקייה — השער נושא את שמה
// ואת תאריך האירוע שלה; מכמה תיקיות — "תמונות נבחרות".
window.openSelectionPrintAlbum = function() {
    const records = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    if (!records.length) {
        window.showNotification('לא נבחרו פריטים לאלבום.', false);
        return;
    }
    const folderIds = new Set(records.map(item => window.safeRecordId(item.folderId)));
    const folder = folderIds.size === 1
        ? window.state.folders.find(item => window.safeRecordId(item.id) === [...folderIds][0])
        : null;
    openAlbumDialog({
        title: folder?.name || 'תמונות נבחרות',
        eventDate: folder?.eventDate || '',
        description: '',
        records,
        expected: records.length
    });
};

// סגירת החלון (closeModal ב-app.js) באמצע הטעינה: הכול נעצר, ושום חלון
// הדפסה לא ייפתח אחר כך.
window.abortPrintAlbum = function() {
    const job = activeJob;
    if (!job) return;
    job.cancelled = true;
    for (const abort of [...job.aborts]) abort();
    activeJob = null;
    setBusy(false);
    setProgress('');
    clearPrintedAlbum();
};

// התנתקות, החלפת חשבון או אובדן אישור (clearPrivateGalleryViews ב-session-auth.js,
// שקורא לזה רק אם המודול נטען — לפני כן אין כאן מה לאפס): הטעינה נעצרת, האלבום
// שנבחר נשכח, העמודים יוצאים מהדף והחלון נסגר. כך מבקר שאינו מחובר אינו יכול
// ללחוץ "הכן והדפס" ולקבל את האלבום של המשתמש הקודם.
function resetPrintAlbum() {
    window.abortPrintAlbum();
    pendingAlbum = null;
    clearPrintedAlbum();
    window.removeEventListener('afterprint', clearPrintedAlbum);
    const summary = document.getElementById('printAlbumSummary');
    if (summary) summary.textContent = '';
    setProgress('');
    setBusy(false);
    const modal = document.getElementById('printAlbumModal');
    if (modal && !modal.classList.contains('hidden')) window.closeModal?.('printAlbumModal');
}
window.resetPrintAlbum = resetPrintAlbum;

// טעינה ופענוח של תמונה אחת. מחזיר את האלמנט הטעון — הוא זה שנכנס לעמוד.
function preloadImage(src, job) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            job.aborts.delete(cancel);
            image.onload = null;
            image.onerror = null;
            if (error) {
                image.removeAttribute('src');
                reject(error);
            } else {
                resolve(image);
            }
        };
        const cancel = () => finish(new Error('בוטל'));
        const timer = setTimeout(() => finish(new Error('הזמן לטעינת התמונה עבר')), IMAGE_TIMEOUT_MS);
        job.aborts.add(cancel);
        image.onload = () => {
            // decode() מבטיח שהתמונה מוכנה לצביעה כשחלון ההדפסה נפתח.
            const decoded = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve();
            decoded.then(() => finish());
        };
        image.onerror = () => finish(new Error('טעינת התמונה נכשלה'));
        image.decoding = 'sync';
        image.src = src;
    });
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // textContent ולא innerHTML: שמות, כיתובים ותיאורים הם טקסט של משתמשים.
    if (text) node.textContent = text;
    return node;
}

function buildCover(album, items, images) {
    const cover = element('section', 'print-album-page print-album-cover');
    const coverImage = images.get(items[0]?.id);
    if (coverImage) {
        const image = coverImage.cloneNode();
        image.className = 'print-album-cover-image';
        image.alt = '';
        cover.appendChild(image);
    }
    cover.appendChild(element('p', 'print-album-kicker', 'אלבום תמונות'));
    cover.appendChild(element('h1', 'print-album-title', album.title));
    const date = albumCoverDate({ eventDate: album.eventDate, records: album.datedRecords });
    if (date.hebrew) cover.appendChild(element('p', 'print-album-date', date.hebrew));
    if (date.gregorian) cover.appendChild(element('p', 'print-album-gregorian', date.gregorian));
    cover.appendChild(element('p', 'print-album-count', albumCountLabel(items)));
    if (album.description) cover.appendChild(element('p', 'print-album-description', album.description));
    return cover;
}

function buildFigure(item, image) {
    const figure = element('figure', 'print-album-item');
    const frame = element('div', 'print-album-frame');
    image.className = 'print-album-image';
    image.alt = item.caption || item.title;
    frame.appendChild(image);
    figure.appendChild(frame);
    const caption = element('figcaption', 'print-album-caption');
    caption.appendChild(element('strong', 'print-album-item-title', item.title));
    if (item.caption) caption.appendChild(element('span', 'print-album-item-caption', item.caption));
    if (item.dateText) caption.appendChild(element('span', 'print-album-item-date', item.dateText));
    figure.appendChild(caption);
    return figure;
}

function renderAlbum(album, items, images, perPage) {
    const root = document.getElementById('printAlbum');
    if (!root) return null;
    const pages = paginateAlbum(items, perPage);
    root.replaceChildren(buildCover(album, items, images));
    root.dataset.perPage = String(perPage);
    root.dataset.pageCount = String(pages.length + 1);
    pages.forEach(pageItems => {
        const page = element('section', 'print-album-page print-album-photos');
        page.dataset.count = String(pageItems.length);
        pageItems.forEach(item => page.appendChild(buildFigure(item, images.get(item.id))));
        root.appendChild(page);
    });
    return root;
}

// אחרי ההדפסה (או ביטול חלון ההדפסה) העמודים יוצאים מהדף, כדי שהדפסה
// רגילה של האתר (Ctrl+P) לא תדפיס אלבום ישן ושהזיכרון של התמונות ישתחרר.
function clearPrintedAlbum() {
    document.body.classList.remove('is-printing-album');
    document.getElementById('printAlbum')?.replaceChildren();
}

function albumNotes({ skipped, failed, truncated }) {
    const notes = [];
    if (truncated) notes.push(`האלבום נעצר בתקרה של ${ALBUM_MAX_ITEMS} פריטים.`);
    if (failed) notes.push(failed === 1 ? 'תמונה אחת לא נטענה ולא נכללה.' : `${failed} תמונות לא נטענו ולא נכללו.`);
    if (skipped) notes.push(skipped === 1 ? 'סרטון אחד בלי תמונת פוסטר לא נכלל.' : `${skipped} פריטים בלי תמונה להדפסה לא נכללו.`);
    return notes.join(' ');
}

window.startPrintAlbum = async function() {
    const album = pendingAlbum;
    if (!album || activeJob) return;
    // מי שלוחץ אינו מי שפתח את החלון (או שכבר אינו מאושר): לא טוענים ולא מדפיסים.
    if (!albumBelongsToViewer(album)) {
        resetPrintAlbum();
        return;
    }
    const perPage = selectedPerPage();
    writeGalleryPreference(ALBUM_PER_PAGE_KEY, String(perPage));
    const job = { cancelled: false, aborts: new Set() };
    activeJob = job;
    setBusy(true);
    setProgress('מכין את רשימת התמונות…', 0);
    clearPrintedAlbum();
    // אחרי כל המתנה: בוטל, או שהמשתמש התחלף בינתיים — ואז הכול מתאפס כאן.
    const stopped = () => {
        if (job.cancelled) return true;
        if (albumBelongsToViewer(album)) return false;
        resetPrintAlbum();
        return true;
    };
    const shouldStop = () => job.cancelled || !albumBelongsToViewer(album);

    try {
        let records = album.records;
        let more = false;
        if (!records) {
            const result = await window.loadAllFolderImages(album.folderId, { limit: ALBUM_MAX_ITEMS, shouldStop });
            records = result.items;
            more = result.hasMore;
        }
        if (stopped()) return;

        const prepared = prepareAlbumItems(records, { sanitize: window.safeImageUrl });
        if (!prepared.items.length) {
            window.closeModal('printAlbumModal');
            window.showNotification('אין באלבום תמונות להדפסה.', false);
            return;
        }

        const images = new Map();
        const total = prepared.items.length;
        setProgress(`טוען תמונות… 0 מתוך ${total}`, 0);
        const summary = await runVariantBackfill(
            prepared.items.map(item => ({ imageId: item.id, item })),
            async ({ item }) => { images.set(item.id, await preloadImage(item.src, job)); },
            {
                concurrency: PRELOAD_CONCURRENCY,
                shouldStop,
                onProgress: ({ processed }) => {
                    if (!job.cancelled) setProgress(`טוען תמונות… ${processed} מתוך ${total}`, processed / total);
                }
            }
        );
        if (stopped()) return;

        const items = prepared.items.filter(item => images.has(item.id));
        if (!items.length) {
            window.closeModal('printAlbumModal');
            window.showNotification('טעינת התמונות נכשלה. נסה שוב בעוד רגע.', false);
            return;
        }
        const root = renderAlbum({ ...album, datedRecords: records }, items, images, perPage);
        // תמונת השער היא עותק של הראשונה, ונטענת מהזיכרון של הדף; מחכים גם לה.
        const unready = [...(root?.querySelectorAll('img') || [])].filter(image => !image.complete);
        await Promise.all(unready.map(image => image.decode().catch(() => {})));
        if (stopped()) return;

        // מכאן אין מה לבטל: החלון נסגר בלי לעצור, וחלון ההדפסה נפתח.
        activeJob = null;
        window.closeModal('printAlbumModal');
        const notes = albumNotes({ skipped: prepared.skipped, failed: summary.failed, truncated: prepared.truncated || more });
        window.showNotification(notes || 'האלבום מוכן. לקובץ PDF בחר "שמירה כ־PDF" בחלון ההדפסה.', !summary.failed);
        document.body.classList.add('is-printing-album');
        window.addEventListener('afterprint', clearPrintedAlbum, { once: true });
        window.print();
    } catch (error) {
        console.error('Print album failed:', error);
        if (!job.cancelled) window.showNotification(error?.message || 'הכנת האלבום נכשלה.', false);
    } finally {
        if (activeJob === job) {
            activeJob = null;
            setBusy(false);
            setProgress('');
        }
    }
};
