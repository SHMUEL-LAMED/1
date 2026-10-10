// people.js — "אנשים בגלריה" ו"התמונות שלי" בדף הגלריה.
//
// המודול נטען עצלה (defineLazyModule ב-app.js), רק כשמשתמש לוחץ על
// "אנשים" או "התמונות שלי", או כשהכתובת היא #people / #person/<id>.
//
//   רשימת האנשים — אנשים שמנהל אישר ונתן להם שם, עם תמונה (חיתוך הפרצוף).
//   האלבום של אדם — כל התמונות המאושרות שבהן הוא זוהה, בגלריה עצמה, תחת
//     #person/<id>; כפתור "חזור" בדפדפן חוזר לגלריה.
//   התמונות שלי — רק בלחיצה מפורשת: תמונת הפרופיל של Google (או סלפי) מעובדת
//     בדפדפן, ולשרת נשלחת רק טביעה מספרית להשוואה. היא נשמרת רק אם המשתמש
//     סימן "זכור אותי", ונמחקת ב"שכח אותי".
//
// השמות והאלבומים זמינים למשתמשים מחוברים ומאושרים בלבד (גם ה-Worker אוכף
// זאת), וטביעות של אחרים לעולם אינן מגיעות לדפדפן.
import {
    FIND_ME_PRIVACY_NOTE,
    faceCropStyle,
    filterPeople,
    imageCountLabel,
    largerGooglePhotoUrl,
    normalizePerson,
    normalizePersonsResponse,
    orderRecordsByIds,
    parsePeopleRoute,
    personHash
} from './people-model.js';

const PEOPLE_CACHE_MS = 60 * 1000;
const FIND_ME_RESULT_LIMIT = 200;
const SELFIE_MAX_BYTES = 15 * 1024 * 1024;

let peopleCache = null;
let peopleQuery = '';
let albumGeneration = 0;
let findMeBusy = false;
// מתקדם בכל התנתקות, החלפת חשבון או אובדן אישור (resetPeopleState). פעולה
// שהתחילה לפני כן — חיפוש "התמונות שלי", שמירת "זכור אותי" — נעצרת כשהיא
// חוזרת, ואינה מוצגת או נשמרת בשם המשתמש הבא.
let peopleSession = 0;
// האלבום שמוצג עכשיו בגלריה: אדם מסוים או "התמונות שלי".
const album = { kind: '', personId: '', results: null };

const el = id => document.getElementById(id);

function canUsePeople() {
    return Boolean(window.state?.isGoogleUser && window.state?.userApprovalStatus === 'approved');
}

function requireApproved() {
    if (canUsePeople()) return true;
    window.showNotification?.('האנשים בגלריה זמינים למשתמשים מחוברים ומאושרים בלבד.', false);
    return false;
}

function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
}

// מסגרת ריבועית עם חיתוך הפרצוף מתוך התמונה הקטנה. בלי מיקום ידוע —
// התמונה כולה, ממורכזת.
function createFaceCrop(face, label = '') {
    const frame = document.createElement('span');
    frame.className = 'face-crop';
    if (!face?.url) {
        frame.classList.add('is-empty');
        frame.setAttribute('aria-hidden', 'true');
        return frame;
    }
    const image = document.createElement('img');
    image.alt = label;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const style = faceCropStyle(face.box);
    if (style) {
        image.classList.add('is-cropped');
        Object.assign(image.style, style);
    }
    image.src = face.url;
    if (!label) frame.setAttribute('aria-hidden', 'true');
    frame.append(image);
    return frame;
}

function imagesCollection() {
    const { collection } = window.firestoreModules || {};
    return collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images');
}

// הרשומות של האלבום לפי מזהים, דרך שכבת הנתונים (עם אותן הרשאות כמו הגלריה).
async function fetchImagesByIds(ids) {
    const unique = [...new Set(ids)];
    const loaded = new Map((window.state?.images || []).map(record => [window.safeRecordId(record.id), record]));
    const missing = unique.filter(id => !loaded.has(id));
    const { getDocsByIds } = window.firestoreModules || {};
    if (missing.length && window.db && typeof getDocsByIds === 'function') {
        const snapshot = await getDocsByIds(imagesCollection(), missing);
        snapshot.docs.forEach(item => loaded.set(window.safeRecordId(item.id), item.data()));
    }
    return orderRecordsByIds(unique, [...loaded.values()], window.safeRecordId);
}

// ==========================================================================
// רשימת האנשים
// ==========================================================================

async function loadPeople({ force = false } = {}) {
    if (!force && peopleCache && Date.now() - peopleCache.loadedAt < PEOPLE_CACHE_MS) return peopleCache.people;
    const session = peopleSession;
    const payload = await window.r2Request('/face/persons');
    const people = normalizePersonsResponse(payload, window.safeImageUrl);
    if (session === peopleSession) peopleCache = { people, loadedAt: Date.now() };
    return people;
}

function renderPeopleList() {
    const list = el('peopleDirectoryList');
    if (!list || !peopleCache) return;
    const visible = filterPeople(peopleCache.people, peopleQuery);
    list.replaceChildren(...visible.map(person => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'person-card';
        link.href = personHash(person.personId);
        link.dataset.personId = person.personId;
        const name = document.createElement('span');
        name.className = 'person-card-name';
        name.textContent = person.name;
        const count = document.createElement('span');
        count.className = 'person-card-count';
        count.textContent = imageCountLabel(person.imageCount);
        link.append(createFaceCrop(person.cover), name, count);
        link.addEventListener('click', event => {
            // לחיצה עם מקש (לשונית חדשה) נשארת קישור רגיל.
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            window.closeModal?.('peopleDirectoryModal');
            navigateToPerson(person.personId);
        });
        item.append(link);
        return item;
    }));
    if (!peopleCache.people.length) {
        setText('peopleDirectoryStatus', 'עדיין אין אנשים עם שם. מנהל הגלריה מאשר ונותן שמות לקבוצות הפרצופים בלוח הניהול.');
    } else if (!visible.length) {
        setText('peopleDirectoryStatus', 'לא נמצא אדם בשם הזה.');
    } else {
        setText('peopleDirectoryStatus', `${visible.length} אנשים. לחיצה על אדם מציגה את כל התמונות שלו.`);
    }
}

async function openPeopleDirectory() {
    if (!requireApproved()) return;
    peopleQuery = '';
    const search = el('peopleDirectorySearch');
    if (search) search.value = '';
    window.openModal?.('peopleDirectoryModal');
    const list = el('peopleDirectoryList');
    if (!peopleCache) list?.replaceChildren();
    setText('peopleDirectoryStatus', 'טוען את רשימת האנשים…');
    list?.setAttribute('aria-busy', 'true');
    const session = peopleSession;
    try {
        await loadPeople();
        if (session === peopleSession) renderPeopleList();
    } catch (error) {
        console.warn('People directory failed to load:', error);
        if (session !== peopleSession) return;
        setText('peopleDirectoryStatus', error?.status === 404
            ? 'רשימת האנשים עדיין אינה זמינה בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : 'טעינת רשימת האנשים נכשלה. נסה שוב בעוד רגע.');
    } finally {
        list?.removeAttribute('aria-busy');
    }
}

function filterPeopleDirectory(value) {
    peopleQuery = String(value ?? '').slice(0, 80);
    renderPeopleList();
}

// ==========================================================================
// האלבום בגלריה (אדם או "התמונות שלי")
// ==========================================================================

function renderAlbumBanner({ title, subtitle, cover, showDirectory }) {
    const banner = el('tempSearchBanner');
    if (!banner) return;
    banner.className = 'people-banner';
    const details = document.createElement('div');
    details.className = 'people-banner-details';
    const copy = document.createElement('div');
    copy.className = 'people-banner-copy';
    const heading = document.createElement('h2');
    heading.className = 'people-banner-title';
    heading.id = 'peopleAlbumTitle';
    heading.tabIndex = -1;
    heading.textContent = title;
    const sub = document.createElement('p');
    sub.className = 'people-banner-sub';
    sub.setAttribute('aria-live', 'polite');
    sub.textContent = subtitle;
    copy.append(heading, sub);
    details.append(createFaceCrop(cover), copy);

    const actions = document.createElement('div');
    actions.className = 'people-banner-actions';
    if (showDirectory) {
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'btn-secondary-dark';
        all.textContent = 'כל האנשים';
        all.addEventListener('click', () => openPeopleDirectory());
        actions.append(all);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-secondary-dark';
    back.textContent = 'חזור לגלריה';
    back.addEventListener('click', () => closePeopleAlbum());
    actions.append(back);

    banner.replaceChildren(details, actions);
    banner.classList.remove('hidden');
    return heading;
}

function showAlbum(kind, personId, records, banner) {
    if (!canUsePeople()) return;
    album.kind = kind;
    album.personId = personId;
    album.results = records;
    window.state.tempSearchResults = records;
    const heading = renderAlbumBanner(banner);
    window.renderImages?.();
    heading?.focus({ preventScroll: true });
    el('tempSearchBanner')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

function albumIsShowing() {
    return Boolean(album.kind) && window.state?.tempSearchResults === album.results;
}

function clearHashIfPerson() {
    if (parsePeopleRoute(window.location.hash)?.view === 'person') {
        window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    }
}

function isModalOpen(id) {
    const modal = el(id);
    return Boolean(modal) && !modal.classList.contains('hidden');
}

// התנתקות, החלפת חשבון או אובדן אישור (נקרא מ-session-auth.js): כל מה
// שהמודול מציג או זוכר נמחק — האלבום, תוצאות "התמונות שלי", רשימת האנשים
// והחלונות — ותשובות שעוד בדרך נזרקות. כך שם ופנים של אדם אינם נשארים מול
// מבקר שאינו מחובר, ותוצאות של משתמש אחד אינן מוצגות למשתמש הבא. הבאנר
// עצמו ו-tempSearchResults מתאפסים ב-session-auth.js, גם כשהמודול לא נטען.
function resetPeopleState() {
    peopleSession += 1;
    albumGeneration += 1;
    const openModals = ['peopleDirectoryModal', 'findMeModal'].filter(isModalOpen);
    const wasShowing = Boolean(album.kind) || openModals.length > 0;
    album.kind = '';
    album.personId = '';
    album.results = null;
    peopleCache = null;
    peopleQuery = '';
    openModals.forEach(id => window.closeModal?.(id));
    el('peopleDirectoryList')?.replaceChildren();
    const search = el('peopleDirectorySearch');
    if (search) search.value = '';
    setText('peopleDirectoryStatus', '');
    setFindMeStatus('');
    renderSavedState(false);
    const selfie = el('findMeSelfie');
    if (selfie) selfie.hidden = true;
    // קישור שהמשתמש עצמו פתח (#person/<id> או #people) אינו נפתח מחדש
    // למשתמש הבא. קישור שמבקר הגיע איתו לפני הכניסה נשאר, כדי שייפתח אחריה.
    if (wasShowing && parsePeopleRoute(window.location.hash)) {
        window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    }
}

function closePeopleAlbum({ keepHash = false } = {}) {
    albumGeneration += 1;
    const showing = albumIsShowing() || (album.kind === 'person' && album.results === null);
    album.kind = '';
    album.personId = '';
    album.results = null;
    if (!keepHash) clearHashIfPerson();
    if (showing) window.clearTempSearchFilter?.();
}

function navigateToPerson(personId) {
    const hash = personHash(personId);
    if (!hash) return;
    if (window.location.hash === hash) showPersonAlbum(personId);
    else window.location.hash = hash;
}

async function showPersonAlbum(personId) {
    if (!requireApproved()) return;
    const generation = ++albumGeneration;
    const cached = peopleCache?.people.find(person => person.personId === personId);
    // הבאנר מופיע מיד; הגלריה מתחלפת רק כשהתמונות הגיעו.
    album.kind = 'person';
    album.personId = personId;
    renderAlbumBanner({
        title: cached ? `התמונות של ${cached.name}` : 'טוען את האלבום…',
        subtitle: 'טוען את התמונות…',
        cover: cached?.cover || null,
        showDirectory: true
    });
    try {
        const payload = await window.r2Request(`/face/persons/${encodeURIComponent(personId)}`);
        const person = normalizePerson(payload?.person, window.safeImageUrl);
        const ids = (Array.isArray(payload?.imageIds) ? payload.imageIds : []).map(window.safeRecordId).filter(Boolean);
        const records = await fetchImagesByIds(ids);
        if (generation !== albumGeneration) return;
        showAlbum('person', personId, records, {
            title: `התמונות של ${person?.name || cached?.name || 'האדם'}`,
            subtitle: imageCountLabel(records.length),
            cover: person?.cover || cached?.cover || null,
            showDirectory: true
        });
    } catch (error) {
        if (generation !== albumGeneration) return;
        console.warn('Person album failed to load:', error);
        closePeopleAlbum();
        el('tempSearchBanner')?.classList.add('hidden');
        window.showNotification?.(error?.status === 404
            ? 'האדם לא נמצא, או שהאלבום שלו אינו זמין.'
            : 'טעינת האלבום נכשלה. נסה שוב בעוד רגע.', false);
    }
}

// נקרא מ-app.js בכל שינוי של ה-hash, וגם אחרי שהגלריה נפתחה למשתמש מאושר.
function handlePeopleRoute(hash = window.location.hash) {
    const route = parsePeopleRoute(hash);
    if (!route) {
        if (album.kind === 'person') closePeopleAlbum({ keepHash: true });
        return;
    }
    // לפני אישור הצפייה אין מה להציג; הקריאה תחזור כשהגלריה תיפתח.
    if (!canUsePeople()) return;
    if (route.view === 'directory') {
        openPeopleDirectory();
        return;
    }
    if (album.kind === 'person' && album.personId === route.personId) return;
    showPersonAlbum(route.personId);
}

// ==========================================================================
// התמונות שלי
// ==========================================================================

function setFindMeStatus(text) {
    setText('findMeStatus', text);
}

function setFindMeBusy(busy) {
    findMeBusy = busy;
    for (const id of ['findMeProfileBtn', 'findMeUseSavedBtn', 'findMeForgetBtn', 'findMeSelfieInput']) {
        const node = el(id);
        if (node) node.disabled = busy;
    }
    el('findMeModal')?.querySelector('.modal-body')?.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showSelfieOption(reason) {
    const selfie = el('findMeSelfie');
    if (selfie) selfie.hidden = false;
    setFindMeStatus(reason);
    el('findMeSelfieLabel')?.focus?.({ preventScroll: true });
}

function renderSavedState(remembered) {
    const saved = el('findMeSaved');
    if (saved) saved.hidden = !remembered;
}

async function refreshSavedState() {
    const session = peopleSession;
    try {
        const status = await window.r2Request('/face/me');
        if (session === peopleSession) renderSavedState(status?.remembered === true);
    } catch (error) {
        console.warn('Find-me status failed to load:', error);
        if (session === peopleSession) renderSavedState(false);
    }
}

function openFindMe() {
    if (!requireApproved()) return;
    const note = el('findMePrivacyNote');
    if (note) note.textContent = FIND_ME_PRIVACY_NOTE;
    const remember = el('findMeRemember');
    if (remember) remember.checked = false;
    const selfie = el('findMeSelfie');
    if (selfie) selfie.hidden = true;
    renderSavedState(false);
    setFindMeStatus('');
    setFindMeBusy(false);
    window.openModal?.('findMeModal');
    refreshSavedState();
}

async function faceEngine() {
    await window.ensureFaceSearchModule?.();
    if (typeof window.loadFaceApi !== 'function') throw new Error('מנוע זיהוי הפנים לא נטען. רענן את הדף ונסה שוב.');
    return window.loadFaceApi();
}

async function describeSingleFace(faceapi, image) {
    const detection = await faceapi.detectSingleFace(image).withFaceLandmarks().withFaceDescriptor();
    if (!detection?.descriptor) return null;
    return Array.from(detection.descriptor, value => Math.round(value * 1e6) / 1e6);
}

async function showFindMeResults(response, session) {
    if (session !== peopleSession) return;
    const threshold = Number(window.FACE_MATCH_THRESHOLD) || 0.48;
    const ids = (Array.isArray(response?.matches) ? response.matches : [])
        .filter(match => Number.isFinite(Number(match?.distance)) && Number(match.distance) < threshold)
        .map(match => window.safeRecordId(match.imageId))
        .filter(Boolean);
    const records = ids.length ? await fetchImagesByIds(ids) : [];
    if (session !== peopleSession) return;
    if (!records.length) {
        setFindMeStatus('לא נמצאו תמונות שבהן זוהית. אפשר לנסות סלפי ברור ומואר, מול המצלמה.');
        const selfie = el('findMeSelfie');
        if (selfie) selfie.hidden = false;
        return;
    }
    window.closeModal?.('findMeModal');
    closePeopleAlbum();
    showAlbum('me', '', records, {
        title: 'התמונות שלי',
        subtitle: `${imageCountLabel(records.length)} שבהן זוהית`,
        cover: null,
        showDirectory: false
    });
    window.showNotification?.(`נמצאו ${imageCountLabel(records.length)} שבהן זוהית.`, true);
}

async function searchWithDescriptor(descriptor, session) {
    if (session !== peopleSession) return;
    setFindMeStatus('משווה את טביעת הפנים מול הגלריה…');
    const modelVersion = window.FACE_MODEL_VERSION;
    const response = await window.r2Request('/face/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor, modelVersion, limit: FIND_ME_RESULT_LIMIT })
    });
    // המשתמש התנתק בינתיים: התוצאות והטביעה אינן מוצגות ואינן נשמרות.
    if (session !== peopleSession) return;
    // הטביעה נשמרת רק כשהמשתמש סימן "זכור אותי" בעצמו, ולעולם לא כברירת מחדל.
    if (el('findMeRemember')?.checked === true) {
        try {
            await window.r2Request('/face/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ descriptor, modelVersion, consent: true })
            });
            renderSavedState(true);
        } catch (error) {
            console.warn('Find-me remember failed:', error);
            window.showNotification?.('החיפוש בוצע, אך שמירת הטביעה נכשלה.', false);
        }
    }
    await showFindMeResults(response, session);
}

function describeError(error) {
    if (error?.status === 429) return 'בוצעו חיפושים רבים. המתן כמה דקות ונסה שוב.';
    if (error?.status === 404) return 'החיפוש אינו זמין בשרת כרגע. יש לפרוס את גרסת ה־Worker העדכנית.';
    return `החיפוש נכשל: ${error?.message || 'שגיאה לא ידועה'}`;
}

async function findMeFromProfile() {
    if (findMeBusy || !requireApproved()) return;
    const session = peopleSession;
    const stale = () => session !== peopleSession;
    setFindMeBusy(true);
    try {
        const photoUrl = largerGooglePhotoUrl(window.state?.currentUser?.photoURL);
        if (!photoUrl) {
            showSelfieOption('לחשבון Google שלך אין תמונת פרופיל. בחר סלפי — הוא יעובד במכשיר בלבד.');
            return;
        }
        setFindMeStatus('טוען את מנוע זיהוי הפנים (בפעם הראשונה זה לוקח רגע)…');
        const faceapi = await faceEngine();
        if (stale()) return;
        setFindMeStatus('מזהה את הפנים בתמונת הפרופיל…');
        let image;
        try {
            image = await window.loadFaceImageElement(photoUrl);
        } catch {
            if (!stale()) showSelfieOption('הדפדפן לא איפשר לקרוא את תמונת הפרופיל של Google. בחר סלפי — הוא יעובד במכשיר בלבד ואינו מועלה.');
            return;
        }
        const descriptor = await describeSingleFace(faceapi, image);
        if (stale()) return;
        if (!descriptor) {
            showSelfieOption('לא זוהו פנים בתמונת הפרופיל. בחר סלפי ברור — הוא יעובד במכשיר בלבד ואינו מועלה.');
            return;
        }
        await searchWithDescriptor(descriptor, session);
    } catch (error) {
        console.warn('Find-me from profile failed:', error);
        if (!stale()) setFindMeStatus(describeError(error));
    } finally {
        setFindMeBusy(false);
    }
}

async function findMeFromSelfie(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file || findMeBusy || !requireApproved()) return;
    if (!/^image\//i.test(file.type || '') || file.size > SELFIE_MAX_BYTES) {
        setFindMeStatus('יש לבחור קובץ תמונה עד 15MB.');
        if (input) input.value = '';
        return;
    }
    const session = peopleSession;
    const stale = () => session !== peopleSession;
    setFindMeBusy(true);
    // הסלפי נקרא מהזיכרון של הדפדפן בלבד (blob:) — אין העלאה לשום מקום.
    const objectUrl = URL.createObjectURL(file);
    try {
        setFindMeStatus('טוען את מנוע זיהוי הפנים (בפעם הראשונה זה לוקח רגע)…');
        const faceapi = await faceEngine();
        if (stale()) return;
        setFindMeStatus('מזהה את הפנים בסלפי, במכשיר שלך…');
        const image = await window.loadFaceImageElement(objectUrl);
        const descriptor = await describeSingleFace(faceapi, image);
        if (stale()) return;
        if (!descriptor) {
            setFindMeStatus('לא זוהו פנים בתמונה. נסה סלפי ברור ומואר, מול המצלמה.');
            return;
        }
        await searchWithDescriptor(descriptor, session);
    } catch (error) {
        console.warn('Find-me from selfie failed:', error);
        if (!stale()) setFindMeStatus(describeError(error));
    } finally {
        URL.revokeObjectURL(objectUrl);
        if (input) input.value = '';
        setFindMeBusy(false);
    }
}

async function findMeWithSaved() {
    if (findMeBusy || !requireApproved()) return;
    const session = peopleSession;
    setFindMeBusy(true);
    try {
        setFindMeStatus('משווה את הטביעה השמורה מול הגלריה…');
        const response = await window.r2Request('/face/me/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: FIND_ME_RESULT_LIMIT })
        });
        await showFindMeResults(response, session);
    } catch (error) {
        console.warn('Find-me with saved descriptor failed:', error);
        if (session !== peopleSession) return;
        if (error?.status === 404) {
            renderSavedState(false);
            setFindMeStatus('אין טביעה שמורה. חפש לפי תמונת הפרופיל או סלפי.');
        } else {
            setFindMeStatus(describeError(error));
        }
    } finally {
        setFindMeBusy(false);
    }
}

async function forgetFindMe() {
    if (findMeBusy || !requireApproved()) return;
    const session = peopleSession;
    setFindMeBusy(true);
    try {
        await window.r2Request('/face/me', { method: 'DELETE' });
        if (session !== peopleSession) return;
        renderSavedState(false);
        setFindMeStatus('טביעת הפנים שלך נמחקה מהשרת.');
    } catch (error) {
        console.warn('Forget-me failed:', error);
        if (session === peopleSession) setFindMeStatus('המחיקה נכשלה. נסה שוב בעוד רגע.');
    } finally {
        setFindMeBusy(false);
    }
}

window.openPeopleDirectory = openPeopleDirectory;
window.filterPeopleDirectory = filterPeopleDirectory;
window.handlePeopleRoute = handlePeopleRoute;
window.closePeopleAlbum = closePeopleAlbum;
// אינו ברשימת המעטפות של app.js: session-auth.js קורא לו רק אם המודול כבר
// נטען, ואחרת אין מה לאפס.
window.resetPeopleState = resetPeopleState;
window.openFindMe = openFindMe;
window.findMeFromProfile = findMeFromProfile;
window.findMeFromSelfie = findMeFromSelfie;
window.findMeWithSaved = findMeWithSaved;
window.forgetFindMe = forgetFindMe;
