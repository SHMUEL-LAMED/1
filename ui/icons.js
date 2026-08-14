// רענון אייקוני Lucide בקבוצות, כדי לא לרנדר מחדש על כל שינוי
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.


let _iconRefreshPending = false;

let _iconRefreshNodes = new Set();

export function scheduleIconRefresh(node) {
    if (node instanceof Element) _iconRefreshNodes.add(node);
    if (_iconRefreshPending) return;
    _iconRefreshPending = true;
    requestAnimationFrame(() => {
        _iconRefreshPending = false;
        if (typeof lucide === 'undefined' || !lucide.createIcons) return;
        const nodes = _iconRefreshNodes;
        _iconRefreshNodes = new Set();
        if (nodes.size === 0) {
            lucide.createIcons();
        } else {
            for (const n of nodes) lucide.createIcons({ node: n });
        }
    });
}

window.scheduleIconRefresh = scheduleIconRefresh;
