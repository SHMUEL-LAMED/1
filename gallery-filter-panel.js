// gallery-filter-panel.js — חלונית "סינון" של סרגל הכלים, ושבבי המסננים הפעילים.
//
// כל הבוררים של הסינון (שנה וחודש עבריים, טווח תאריכים, סוג מדיה, אורך סרטון,
// כיוון ושבבי "סוג הרגע") יושבים בחלונית #galleryFilterPanel עם אותם מזהים
// ואותן פונקציות כמו קודם — gallery.js ממשיך לנהל אותם. המודול הזה אחראי רק
// על המעטפת:
//   - פתיחה וסגירה: כפתור "סינון", Escape, לחיצה מחוץ לחלונית, "סגור".
//     במסך רחב החלונית צפה מתחת לסרגל ואינה חוסמת את הדף (aria-modal="false");
//     בטלפון היא גיליון תחתון עם רקע מעומעם, נעילת גלילה ומלכודת פוקוס.
//   - המונה שעל הכפתור ושורת השבבים "המסננים הפעילים", כל שבב עם × שמסיר
//     אותו בלבד, ו"נקה הכל" (window.clearGalleryFilters ב-gallery.js).
// המצב נקרא מ-window.getGallerySearchSnapshot — אותו מקור שהחיפושים השמורים
// משתמשים בו — אחרי כל ציור של הגלריה (window.syncGalleryFilterPanel).

import { sceneTagLabel } from './scene-tags.js';
import { describeDateRange } from './hebrew-date-range.js';
import { formatHebrewYear, hebrewMonthName } from './hebrew-date.js';

const SHEET_QUERY = '(max-width: 767px)';
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]):not([hidden]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const byId = id => document.getElementById(id);

function isSheet() {
    return Boolean(window.matchMedia?.(SHEET_QUERY).matches);
}

function selectedLabel(id, fallback) {
    const select = byId(id);
    const option = select?.selectedOptions?.[0];
    return option && option.value ? option.textContent.trim() : fallback;
}

// המסננים הפעילים, בסדר שבו הם מופיעים בחלונית. לכל אחד תווית לשבב ופעולה
// שמסירה אותו — דרך אותן פונקציות שהבוררים עצמם קוראים להן.
export function activeGalleryFilters(snapshot = window.getGallerySearchSnapshot?.()) {
    const filters = snapshot?.filters || {};
    const list = [];
    if (filters.hebrewYear) {
        list.push({ id: 'year', label: formatHebrewYear(filters.hebrewYear), kind: 'שנה', clear: () => window.setGalleryHebrewYear?.('') });
    }
    if (filters.hebrewMonth) {
        list.push({ id: 'month', label: hebrewMonthName(filters.hebrewMonth) || filters.hebrewMonth, kind: 'חודש', clear: () => window.setGalleryHebrewMonth?.('') });
    }
    if (filters.dateFrom || filters.dateTo) {
        list.push({ id: 'range', label: describeDateRange({ from: filters.dateFrom, to: filters.dateTo }), kind: 'טווח', clear: () => window.setGalleryDateRange?.('', '') });
    }
    if (filters.mediaType) {
        list.push({ id: 'media', label: selectedLabel('galleryMediaTypeFilter', filters.mediaType), kind: 'סוג', clear: () => window.setGalleryMediaType?.('') });
    }
    if (filters.videoLength) {
        list.push({ id: 'length', label: selectedLabel('galleryVideoLengthFilter', filters.videoLength), kind: 'אורך', clear: () => window.setGalleryVideoLength?.('') });
    }
    if (filters.orientation) {
        list.push({ id: 'orientation', label: selectedLabel('galleryOrientationFilter', filters.orientation), kind: 'כיוון', clear: () => window.setGalleryOrientation?.('') });
    }
    const tag = Array.isArray(filters.tags) ? filters.tags[0] : '';
    if (tag) {
        list.push({ id: 'scene', label: sceneTagLabel(tag) || tag, kind: 'סוג הרגע', clear: () => window.setGallerySceneTag?.('') });
    }
    return list;
}

let lastFocus = null;
let currentFilters = [];
// אחרי הסרה של שבב: המקום שלו ברשימה, כדי להעביר את הפוקוס אחרי הציור הבא
// (הגלריה מציירת באיחור קטן, ורק אז השבבים נבנים מחדש).
let pendingChipFocus = null;

function renderChips(filters) {
    const wrap = byId('galleryActiveFilters');
    const list = byId('galleryActiveFilterChips');
    if (!wrap || !list) return;
    const key = filters.map(filter => `${filter.id}:${filter.label}`).join('|');
    wrap.hidden = filters.length === 0;
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.filterChip : null;
    list.replaceChildren(...filters.map(filter => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'active-filter-chip';
        button.dataset.filterChip = filter.id;
        button.setAttribute('aria-label', `הסרת הסינון ${filter.kind}: ${filter.label}`);
        const kind = document.createElement('span');
        kind.className = 'active-filter-kind';
        kind.textContent = filter.kind;
        const label = document.createElement('span');
        label.className = 'active-filter-label';
        label.textContent = filter.label;
        const remove = document.createElement('span');
        remove.className = 'active-filter-remove';
        remove.setAttribute('aria-hidden', 'true');
        remove.textContent = '×';
        button.append(kind, label, remove);
        item.appendChild(button);
        return item;
    }));
    if (focusedId) list.querySelector(`[data-filter-chip="${focusedId}"]`)?.focus({ preventScroll: true });
}

function renderCount(filters, visibleCount) {
    const badge = byId('galleryFilterCount');
    const value = byId('galleryFilterCountValue');
    const toggle = byId('galleryFilterToggle');
    if (badge) badge.hidden = filters.length === 0;
    if (value) value.textContent = String(filters.length);
    if (toggle) toggle.dataset.active = filters.length ? 'true' : 'false';
    const clear = byId('galleryFilterPanelClear');
    if (clear) clear.disabled = filters.length === 0;
    const done = byId('galleryFilterDoneLabel');
    if (done && Number.isFinite(visibleCount)) {
        const text = visibleCount === 1 ? 'הצגת פריט אחד' : `הצגת ${visibleCount} פריטים`;
        if (done.textContent !== text) done.textContent = text;
    }
}

// נקרא בסוף כל ציור של הגלריה (gallery.js) — המצב כבר עדכני שם.
window.syncGalleryFilterPanel = function(visibleCount) {
    currentFilters = activeGalleryFilters();
    renderChips(currentFilters);
    renderCount(currentFilters, Number(visibleCount));
    if (pendingChipFocus !== null) {
        const index = pendingChipFocus;
        pendingChipFocus = null;
        // הפוקוס עובר לשבב שבא במקומו (או לקודם), ובלי שבבים — לכפתור "סינון".
        const chips = [...document.querySelectorAll('#galleryActiveFilterChips .active-filter-chip')];
        (chips[index] || chips[index - 1] || byId('galleryFilterToggle'))?.focus({ preventScroll: true });
    }
};

function panelOpen() {
    const panel = byId('galleryFilterPanel');
    return Boolean(panel && !panel.hidden);
}

function setOpen(open, { focus = false } = {}) {
    const panel = byId('galleryFilterPanel');
    const toggle = byId('galleryFilterToggle');
    const backdrop = byId('galleryFilterBackdrop');
    if (!panel || !toggle) return;
    const sheet = isSheet();
    panel.hidden = !open;
    panel.setAttribute('aria-modal', open && sheet ? 'true' : 'false');
    panel.dataset.mode = sheet ? 'sheet' : 'popover';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (backdrop) backdrop.hidden = !(open && sheet);
    document.documentElement.classList.toggle('filter-sheet-open', open && sheet);
    panel.closest('.gallery-toolbar')?.classList.toggle('has-open-filters', open);
    if (open) {
        lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : toggle;
        window.syncGalleryFilterPanel?.(NaN);
        const first = panel.querySelector('.filter-panel-body select:not([disabled]):not([hidden]), .filter-panel-body button:not([disabled])');
        (first || panel.querySelector('.filter-panel-close'))?.focus({ preventScroll: true });
    } else if (focus) {
        (lastFocus && document.contains(lastFocus) && !panel.contains(lastFocus) ? lastFocus : toggle).focus({ preventScroll: true });
    }
}

window.toggleGalleryFilters = function() {
    setOpen(!panelOpen(), { focus: true });
};
window.openGalleryFilters = function() {
    setOpen(true);
};
window.closeGalleryFilters = function({ focus = false } = {}) {
    if (panelOpen()) setOpen(false, { focus });
};

function handleChipClick(event) {
    const button = event.target.closest?.('.active-filter-chip');
    if (!button) return;
    const index = currentFilters.findIndex(filter => filter.id === button.dataset.filterChip);
    const filter = currentFilters[index];
    if (!filter) return;
    pendingChipFocus = index;
    filter.clear();
}

function trapFocus(event) {
    const panel = byId('galleryFilterPanel');
    if (!panel || panel.getAttribute('aria-modal') !== 'true') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter(node => node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
    }
}

export function initGalleryFilterPanel() {
    const panel = byId('galleryFilterPanel');
    if (!panel || panel.dataset.ready) return;
    panel.dataset.ready = '1';
    byId('galleryActiveFilterChips')?.addEventListener('click', handleChipClick);

    document.addEventListener('keydown', event => {
        if (!panelOpen()) return;
        if (event.key === 'Tab') {
            trapFocus(event);
            return;
        }
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const toggle = byId('galleryFilterToggle');
        // Escape בתוך החלונית (או על הכפתור שפתח אותה) סוגר רק אותה.
        if (!isSheet() && !panel.contains(document.activeElement) && document.activeElement !== toggle) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false, { focus: true });
    });

    // במסך רחב: לחיצה מחוץ לחלונית ולכפתור סוגרת אותה, והלחיצה עצמה ממשיכה
    // ליעדה (כרטיס, תיקייה). בטלפון הרקע המעומעם סוגר אותה.
    document.addEventListener('pointerdown', event => {
        if (!panelOpen() || isSheet()) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panel.contains(target) || byId('galleryFilterToggle')?.contains(target)) return;
        setOpen(false);
    });

    // מעבר בין רוחב טלפון לרוחב רחב בזמן שהחלונית פתוחה: היא מתחלפת בין גיליון לחלונית.
    window.matchMedia?.(SHEET_QUERY).addEventListener?.('change', () => {
        if (panelOpen()) setOpen(true);
    });
}
