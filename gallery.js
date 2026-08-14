// gallery.js — הצגת הגלריה, מדיה, ניווט ותיקיות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.


import './features/gallery/media-grid.js';
import './features/gallery/bulk-actions.js';
import './features/gallery/downloads.js';
import './features/gallery/folders.js';
import './features/gallery/uploads.js';
import './features/gallery/lightbox.js';
import './features/gallery/ai-search.js';

export function initGallery() {
    window.renderFolders?.();
    window.renderImages?.();
}
