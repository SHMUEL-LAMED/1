// admin-guide-ui.js — מסך "מדריך למנהלים" בלוח הניהול: תוכן העניינים,
// הסעיפים המתקפלים והחיפוש בתוך המדריך.
//
// התוכן וההיגיון הטהור ב-admin-guide.js; כאן רק הציור. המודול נטען עצלה
// מ-admin-ui.js בפתיחת המסך — כולל בפתיחה מקישור "?" שבמסך אחר, שמבקש
// סעיף מסוים (window.openAdminGuide).
//
// כל סעיף הוא <details> עם <summary>: הדפדפן נותן את המקלדת (Enter ורווח)
// ואת ההכרזה "מורחב / מכווץ" לקוראי מסך בלי קוד נוסף. תוכן העניינים הוא
// קישורים אמיתיים (#guide/<מזהה>), כך שאפשר גם להעתיק כתובת של סעיף.
import {
    GUIDE_SECTIONS,
    findGuideSection,
    guideHash,
    splitEmphasis,
    filterGuideSections,
    guideFilterMessage
} from './admin-guide.js';

let currentSectionId = '';
let searchQuery = '';

function root() {
    return document.getElementById('adminGuideRoot');
}

function sectionElement(id) {
    return document.getElementById(`guide-section-${id}`);
}

function prefersReducedMotion() {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch (error) {
        return false;
    }
}

// טקסט עם **הדגשה**: נבנה מצמתי טקסט ו-<strong> בלבד, ולכן שום תו בתוכן
// אינו מתפרש כ-HTML.
function appendRichText(parent, text) {
    splitEmphasis(text).forEach(part => {
        if (part.strong) {
            const strong = document.createElement('strong');
            strong.textContent = part.text;
            parent.appendChild(strong);
        } else {
            parent.appendChild(document.createTextNode(part.text));
        }
    });
    return parent;
}

function renderBlock(block) {
    if (block.type === 'h') {
        return appendRichText(Object.assign(document.createElement('h4'), { className: 'admin-guide-subtitle' }), block.text);
    }
    if (block.type === 'note') {
        return appendRichText(Object.assign(document.createElement('p'), { className: 'admin-guide-note' }), block.text);
    }
    if (block.type === 'list' || block.type === 'steps') {
        const list = document.createElement(block.type === 'steps' ? 'ol' : 'ul');
        list.className = `admin-guide-list${block.type === 'steps' ? ' is-steps' : ''}`;
        block.items.forEach(item => list.appendChild(appendRichText(document.createElement('li'), item)));
        return list;
    }
    return appendRichText(document.createElement('p'), block.text);
}

// כפתורי "מעבר למסך" — רק למסכים שהמנהל הנוכחי רשאי לפתוח. מסך של
// מנהל־על אינו מוצג למנהל בדרגה 3, כמו בתפריט עצמו.
function renderViewActions(section) {
    const views = section.views
        .map(id => window.adminViewInfo?.(id))
        .filter(info => info?.allowed);
    if (!views.length) return null;
    const actions = document.createElement('div');
    actions.className = 'admin-guide-actions';
    views.forEach(info => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        button.dataset.guideOpenView = info.id;
        button.innerHTML = '<i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>';
        button.append(` מעבר למסך: ${info.title}`);
        button.onclick = () => window.openAdminView(info.id);
        actions.appendChild(button);
    });
    return actions;
}

function renderSection(section, isOpen) {
    const details = document.createElement('details');
    details.className = 'admin-panel admin-guide-section';
    details.id = `guide-section-${section.id}`;
    details.dataset.guideSection = section.id;
    details.open = isOpen;

    const summary = document.createElement('summary');
    summary.className = 'admin-guide-summary';
    summary.innerHTML = `<span class="admin-stat-icon" data-tone="gold"><i data-lucide="${window.safeIconName(section.icon)}" class="w-4 h-4"></i></span>`;
    const text = document.createElement('span');
    text.className = 'admin-guide-summary-text';
    const title = document.createElement('strong');
    title.id = `guide-title-${section.id}`;
    title.textContent = section.title;
    const hint = document.createElement('small');
    hint.textContent = section.summary;
    text.append(title, hint);
    summary.appendChild(text);
    if (section.superAdminOnly) {
        const tag = document.createElement('span');
        tag.className = 'admin-guide-tag';
        tag.textContent = 'מנהל־על';
        summary.appendChild(tag);
    }

    const content = document.createElement('div');
    content.className = 'admin-guide-content';
    section.blocks.forEach(block => content.appendChild(renderBlock(block)));
    const actions = renderViewActions(section);
    if (actions) content.appendChild(actions);

    details.append(summary, content);
    return details;
}

function renderToc() {
    const nav = document.createElement('nav');
    nav.className = 'admin-panel admin-guide-toc';
    nav.setAttribute('aria-labelledby', 'adminGuideTocTitle');
    const heading = document.createElement('p');
    heading.id = 'adminGuideTocTitle';
    heading.className = 'admin-section-label';
    heading.textContent = 'תוכן העניינים';
    const list = document.createElement('ol');
    GUIDE_SECTIONS.forEach(section => {
        const item = document.createElement('li');
        item.dataset.guideTocItem = section.id;
        const link = document.createElement('a');
        link.href = guideHash(section.id);
        link.dataset.guideLink = section.id;
        link.textContent = section.title;
        link.onclick = event => {
            event.preventDefault();
            openGuideSection(section.id, { focus: true });
        };
        item.appendChild(link);
        list.appendChild(item);
    });
    nav.append(heading, list);
    return nav;
}

function renderToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'admin-guide-toolbar';

    const search = document.createElement('label');
    search.className = 'admin-guide-search';
    search.innerHTML = '<i data-lucide="search" class="w-4 h-4"></i>';
    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'adminGuideSearch';
    input.autocomplete = 'off';
    input.placeholder = 'חיפוש במדריך…';
    input.setAttribute('aria-label', 'חיפוש במדריך למנהלים');
    input.setAttribute('aria-controls', 'adminGuideSections');
    input.value = searchQuery;
    input.oninput = () => applyGuideFilter(input.value);
    input.onkeydown = event => {
        if (event.key !== 'Escape' || !input.value) return;
        event.preventDefault();
        input.value = '';
        applyGuideFilter('');
    };
    search.appendChild(input);

    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
    expand.textContent = 'פתיחת כל הסעיפים';
    expand.onclick = () => setAllSections(true);
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
    collapse.textContent = 'סגירת כל הסעיפים';
    collapse.onclick = () => setAllSections(false);

    toolbar.append(search, expand, collapse);
    return toolbar;
}

function setAllSections(open) {
    document.querySelectorAll('#adminGuideSections .admin-guide-section').forEach(details => {
        if (!details.hidden) details.open = open;
    });
}

function markCurrent(id) {
    currentSectionId = id;
    document.querySelectorAll('[data-guide-link]').forEach(link => {
        if (link.dataset.guideLink === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    });
}

function writeHash(id) {
    try {
        const hash = guideHash(id);
        if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    } catch (error) {
        // דפדפן שחוסם replaceState אינו סיבה לא לפתוח את הסעיף.
    }
}

// החיפוש מסתיר סעיפים שאינם מתאימים — גם בתוכן העניינים — ופותח את
// המתאימים, כדי שהתשובה תהיה גלויה בלי לחיצה נוספת.
function applyGuideFilter(value) {
    searchQuery = String(value ?? '');
    const matches = new Set(filterGuideSections(searchQuery));
    const active = Boolean(searchQuery.trim());
    GUIDE_SECTIONS.forEach(section => {
        const visible = matches.has(section.id);
        const details = sectionElement(section.id);
        if (details) {
            details.hidden = !visible;
            if (active && visible) details.open = true;
        }
        const tocItem = document.querySelector(`[data-guide-toc-item="${section.id}"]`);
        if (tocItem) tocItem.hidden = !visible;
    });
    const status = document.getElementById('adminGuideStatus');
    if (status) status.textContent = guideFilterMessage(matches.size, GUIDE_SECTIONS.length, searchQuery);
}

// המסך והלוח נכנסים באנימציה (rise: הזזה והקטנה קלה), ומיקום שנמדד באמצעה
// שגוי בעשרות פיקסלים בדף ארוך. כשקופצים לסעיף, הכניסה של כל מי שמכיל אותו
// מסתיימת מיד — הגלילה עצמה היא התנועה — והמיקום נמדד במקום הסופי.
function finishEntranceAround(element) {
    (document.getAnimations?.() || []).forEach(animation => {
        const target = animation.effect?.target;
        if (!target?.contains?.(element)) return;
        if (animation.effect.getComputedTiming?.().iterations === Infinity) return;
        try {
            animation.finish();
        } catch (error) {
            // אנימציה שאי אפשר לסיים אינה סיבה לא לגלול.
        }
    });
}

// כמה מראש המסך מכוסה: הכותרת הצפה של האתר, ובעמודה אחת גם כותרת המסך
// הדבוקה, שגובהה תלוי ברוחב (התיאור והכפתורים נשברים לשורות). לכן הגובה
// נמדד ולא נקבע ב-CSS.
function coveredTop() {
    return ['.site-header', '.admin-main-head'].reduce((covered, selector) => {
        const element = document.querySelector(selector);
        if (!element) return covered;
        const style = window.getComputedStyle(element);
        if (style.position !== 'sticky' && style.position !== 'fixed') return covered;
        return Math.max(covered, (parseFloat(style.top) || 0) + element.offsetHeight);
    }, 0);
}

function scrollToSection(details) {
    finishEntranceAround(details);
    const top = details.getBoundingClientRect().top + window.scrollY - coveredTop() - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// פתיחת סעיף: מתקפל פתוח, נגלל לראש המסך ומקבל את הפוקוס, והכתובת
// מתעדכנת ל-#guide/<מזהה>. סעיף שהחיפוש הסתיר מחזיר קודם את כל המדריך.
export function openGuideSection(id, { focus = false, scroll = true } = {}) {
    const section = findGuideSection(id);
    const details = section && sectionElement(section.id);
    if (!details) return false;
    if (details.hidden) {
        const input = document.getElementById('adminGuideSearch');
        if (input) input.value = '';
        applyGuideFilter('');
    }
    details.open = true;
    markCurrent(section.id);
    writeHash(section.id);
    if (focus) details.querySelector('summary')?.focus({ preventScroll: true });
    if (scroll) scrollToSection(details);
    return true;
}

// ההרשאות שקובעות את כפתורי "מעבר למסך". כשהן לא השתנו אין סיבה לבנות
// מחדש — וכך גם פתיחה חוזרת של המסך אינה מאבדת חיפוש שבאמצע הקלדה.
function permissionsSignature() {
    return GUIDE_SECTIONS.flatMap(section => section.views)
        .filter(id => window.adminViewInfo?.(id)?.allowed)
        .join(',');
}

function buildGuide(container) {
    // בפעם הראשונה פתוח רק סעיף הפתיחה; אחר כך נשמר מה שהמנהל פתח.
    const previous = container.querySelector('.admin-guide');
    const wasOpen = new Set(previous
        ? [...container.querySelectorAll('.admin-guide-section[open]')].map(details => details.dataset.guideSection)
        : [GUIDE_SECTIONS[0].id]);

    const layout = document.createElement('div');
    layout.className = 'admin-guide';
    layout.dataset.permissions = permissionsSignature();
    const body = document.createElement('div');
    body.className = 'admin-guide-body';
    const status = document.createElement('p');
    status.id = 'adminGuideStatus';
    status.className = 'field-hint';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const sections = document.createElement('div');
    sections.id = 'adminGuideSections';
    sections.className = 'admin-guide-sections';
    GUIDE_SECTIONS.forEach(item => sections.appendChild(renderSection(item, wasOpen.has(item.id))));
    body.append(renderToolbar(), status, sections);
    layout.append(renderToc(), body);
    container.replaceChildren(layout);

    applyGuideFilter(searchQuery);
    if (currentSectionId) markCurrent(currentSectionId);
    window.scheduleIconRefresh?.(container);
}

// נקרא בכל פתיחה של המסך — גם כשהלוח פותח מחדש את המסך הפעיל אחרי שינוי
// הרשאה, ואז הוא כבר גלל לראש הדף. section — הסעיף שבכתובת או שביקש "?";
// requested — בקשה מפורשת ("?"). בלי בקשה כזו, מי שמקליד בחיפוש של המדריך
// אינו מוקפץ לסעיף והחיפוש שלו אינו מתאפס.
export function renderAdminGuide({ section = '', requested = false } = {}) {
    const container = root();
    if (!container) return;
    const built = container.querySelector('.admin-guide');
    if (!built || built.dataset.permissions !== permissionsSignature()) buildGuide(container);

    const target = findGuideSection(section) ? section : '';
    if (!target) {
        // כניסה למדריך כולו (#guide): אין סעיף נוכחי לסמן בתוכן העניינים.
        markCurrent('');
        return;
    }
    const typing = container.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (!requested && (typing || searchQuery.trim())) return;
    openGuideSection(target, { focus: true });
}
