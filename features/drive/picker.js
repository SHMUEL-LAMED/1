// בורר תיקיות Drive: פתיחה, ניווט ובחירה
// פוצל מתוך drive-sync.js. הקוד עצמו לא שונה — רק מיקומו.


export function parseDriveFolderId(value) {
    const rawValue = String(value || '').trim();
    if (/^[a-zA-Z0-9_-]{10,}$/.test(rawValue)) return rawValue;
    try {
        const url = new URL(rawValue);
        const pathMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const queryId = url.searchParams.get('id');
        if (pathMatch?.[1]) return pathMatch[1];
        if (queryId && /^[a-zA-Z0-9_-]{10,}$/.test(queryId)) return queryId;
    } catch (error) {
        return null;
    }
    return null;
}

export let driveFolderPickerState = {
    rootFolderId: '',
    rootName: '',
    folders: []
};

function ensureDriveFolderPickerModal() {
    let modal = document.getElementById('driveFolderPickerModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'driveFolderPickerModal';
    // חלון בחירת התיקיות נפתח מתוך חלון משימת הניהול (z-index 105),
    // ולכן הוא חייב להופיע בשכבה גבוהה יותר ולא להסתתר מאחוריו.
    modal.className = 'hidden fixed inset-0 z-[150] bg-slate-950/95 backdrop-blur-xl overflow-y-auto';
    modal.style.zIndex = '150';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'driveFolderPickerTitle');

    const page = document.createElement('div');
    page.className = 'min-h-screen w-full max-w-6xl mx-auto px-4 py-6 sm:px-8 sm:py-10';

    const header = document.createElement('div');
    header.className = 'sticky top-0 z-10 mb-6 rounded-2xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-4';

    const headingWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'driveFolderPickerTitle';
    title.className = 'text-xl sm:text-2xl font-black text-white';
    title.textContent = 'תיקיות Google Drive';
    const subtitle = document.createElement('p');
    subtitle.id = 'driveFolderPickerSubtitle';
    subtitle.className = 'mt-1 text-xs sm:text-sm text-slate-400';
    subtitle.textContent = 'בחר תיקייה וסנכרן אותה בנפרד.';
    headingWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10';
    closeButton.textContent = 'סגור';
    closeButton.addEventListener('click', window.closeDriveFolderPicker);

    header.append(headingWrap, closeButton);

    const list = document.createElement('div');
    list.id = 'driveFolderPickerList';
    list.className = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

    page.append(header, list);
    modal.append(page);
    document.body.append(modal);
    return modal;
}

function renderDriveFolderPicker() {
    const modal = ensureDriveFolderPickerModal();
    const list = modal.querySelector('#driveFolderPickerList');
    const subtitle = modal.querySelector('#driveFolderPickerSubtitle');
    if (!list) return;

    list.innerHTML = '';
    if (subtitle) {
        subtitle.textContent = 'נמצאו ' + driveFolderPickerState.folders.length
            + ' תיקיות. לחץ על “סנכרן תיקייה” ליד כל תיקייה בנפרד.';
    }

    driveFolderPickerState.folders.forEach(function(folder, index) {
        const card = document.createElement('article');
        card.className = 'rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl transition hover:border-amber-400/40';
        card.dataset.driveFolderId = folder.id;

        const top = document.createElement('div');
        top.className = 'flex items-start gap-3';

        const icon = document.createElement('div');
        icon.className = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-400';
        icon.innerHTML = '<i data-lucide="folder" class="h-5 w-5"></i>';

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const name = document.createElement('h3');
        name.className = 'truncate text-sm font-black text-white';
        name.textContent = folder.name;
        const path = document.createElement('p');
        path.className = 'mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400';
        path.textContent = folder.path;
        text.append(name, path);
        top.append(icon, text);

        const status = document.createElement('p');
        status.id = 'drive-folder-status-' + index;
        status.className = 'mt-4 min-h-5 text-[11px] font-semibold text-slate-400';
        status.textContent = 'מוכן לסנכרון';

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'drive-folder-sync-' + index;
        button.className = 'mt-2 w-full rounded-xl bg-amber-400 px-4 py-3 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60';
        button.textContent = 'סנכרן תיקייה';
        button.addEventListener('click', function() {
            window.syncDriveFolderById(folder.id);
        });

        card.append(top, status, button);
        list.append(card);
    });

    window.scheduleIconRefresh();
}

window.openDriveFolderPicker = function() {
    const modal = ensureDriveFolderPickerModal();
    renderDriveFolderPicker();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeDriveFolderPicker = function() {
    const modal = document.getElementById('driveFolderPickerModal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
};
