// תצוגת המדיה: פתיחה, מעבר, סרטונים, מצגת וסגירה
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.

import { currentFilteredImages, getFilteredSortedImages, setCurrentFilteredImages } from './media-grid.js';
import { formatMediaDuration } from './uploads.js';

let gallerySlideshowTimer = null;

function openLightbox(imageId) {
    imageId = window.safeRecordId(imageId);
    setCurrentFilteredImages(getFilteredSortedImages());
    window.state.currentLightboxIndex = currentFilteredImages.findIndex(img => window.safeRecordId(img.id) === imageId);
    if (window.state.currentLightboxIndex === -1) return;
    window.recordMediaView(imageId);
    updateLightbox(); window.openModal('lightboxModal');
}

function navigateLightbox(step) {
    if (currentFilteredImages.length === 0) return;
    const activeVideo = document.getElementById('lightboxVideo');
    if (activeVideo) activeVideo.pause();
    window.state.currentLightboxIndex = (window.state.currentLightboxIndex + step + currentFilteredImages.length) % currentFilteredImages.length;
    updateLightbox();
}

window.closeLightbox = function() {
    if (gallerySlideshowTimer) {
        window.clearInterval(gallerySlideshowTimer);
        gallerySlideshowTimer = null;
        updateSlideshowButton();
    }
    const activeVideo = document.getElementById('lightboxVideo');
    if (activeVideo) {
        activeVideo.pause();
        activeVideo.removeAttribute('src');
        activeVideo.load();
    }
    window.closeModal('lightboxModal');
};

function updateSlideshowButton() {
    const button = document.getElementById('slideshowToggle');
    if (!button) return;
    const running = Boolean(gallerySlideshowTimer);
    button.setAttribute('aria-label', running ? 'עצירת מצגת אוטומטית' : 'הפעלת מצגת אוטומטית');
    button.title = running ? 'עצירת מצגת' : 'הפעלת מצגת';
    button.innerHTML = `<i data-lucide="${running ? 'pause' : 'play'}" class="w-6 h-6"></i>`;
    window.scheduleIconRefresh();
}

window.toggleGallerySlideshow = function() {
    if (gallerySlideshowTimer) {
        window.clearInterval(gallerySlideshowTimer);
        gallerySlideshowTimer = null;
    } else {
        const slideshowImages = currentFilteredImages.filter(item => !window.isVideoRecord(item));
        if (slideshowImages.length < 2) {
            window.showNotification('נדרשות לפחות שתי תמונות להפעלת מצגת.', false);
            return;
        }
        const currentId = window.safeRecordId(currentFilteredImages[window.state.currentLightboxIndex]?.id);
        setCurrentFilteredImages(slideshowImages);
        window.state.currentLightboxIndex = Math.max(0, slideshowImages.findIndex(item => window.safeRecordId(item.id) === currentId));
        updateLightbox();
        gallerySlideshowTimer = window.setInterval(() => navigateLightbox(1), 4000);
    }
    updateSlideshowButton();
};

window.startGallerySlideshow = function() {
    const images = getFilteredSortedImages().filter(item => !window.isVideoRecord(item));
    if (!images.length) {
        window.showNotification('אין תמונות להצגת מצגת.', false);
        return;
    }
    openLightbox(images[0].id);
    if (images.length > 1 && !gallerySlideshowTimer) window.toggleGallerySlideshow();
};

function updateLightbox() {
    const img = currentFilteredImages[window.state.currentLightboxIndex]; if (!img) return;
    const f = window.state.folders.find(fold => fold.id === img.folderId);

    const lbImage = document.getElementById('lightboxImage');
    const lbVideo = document.getElementById('lightboxVideo');
    const imageUrl = window.safeImageUrl(img.url);
    const isVideo = window.isVideoRecord(img);
    document.getElementById('lightboxImageFallback')?.remove();
    if (isVideo) {
        if (lbImage) lbImage.hidden = true;
        if (lbVideo) {
            lbVideo.classList.remove('hidden');
            const posterUrl = window.safeImageUrl(img.thumbnailUrl);
            if (posterUrl) lbVideo.poster = posterUrl;
            else lbVideo.removeAttribute('poster');
            const progressKey = `simchat_video_progress_${window.safeRecordId(img.id)}`;
            lbVideo.dataset.mediaId = window.safeRecordId(img.id);
            lbVideo.onloadedmetadata = () => {
                const saved = Number(localStorage.getItem(progressKey));
                if (Number.isFinite(saved) && saved > 3 && saved < lbVideo.duration - 3) lbVideo.currentTime = saved;
            };
            lbVideo.ontimeupdate = () => {
                if (Math.floor(lbVideo.currentTime) % 3 === 0) localStorage.setItem(progressKey, String(lbVideo.currentTime));
            };
            lbVideo.onended = () => localStorage.removeItem(progressKey);
            if (lbVideo.src !== imageUrl) {
                lbVideo.src = imageUrl;
                lbVideo.load();
            }
        }
    } else if(lbImage) {
        if (lbVideo) {
            lbVideo.pause();
            lbVideo.removeAttribute('src');
            lbVideo.load();
            lbVideo.classList.add('hidden');
        }
        lbImage.hidden = false;
        lbImage.onerror = () => window.handleImageError(lbImage);
        lbImage.src = imageUrl;
    }

    const lbTitle = document.getElementById('lightboxTitle');
    if(lbTitle) lbTitle.innerText = img.title;

    const lbDetails = document.getElementById('lightboxDetails');
    if(lbDetails) lbDetails.innerText = `${isVideo ? `סרטון${formatMediaDuration(img.duration) ? ` (${formatMediaDuration(img.duration)})` : ''}` : 'תמונה'} • ${window.formatDate(img.date)} • תיקייה: ${f ? f.name : 'כללי'}`;

    const lbDownload = document.getElementById('lightboxDownload');
    if(lbDownload) {
        lbDownload.disabled = !imageUrl;
        lbDownload.setAttribute('aria-disabled', imageUrl ? 'false' : 'true');
        lbDownload.onclick = imageUrl ? () => window.downloadGalleryMedia(img) : null;
    }

    const lbCounter = document.getElementById('lightboxCounter');
    if(lbCounter) lbCounter.innerText = `${window.state.currentLightboxIndex + 1} מתוך ${currentFilteredImages.length}`;
}

document.addEventListener('keydown', e => {
    const lightbox = document.getElementById('lightboxModal');
    if (lightbox && !lightbox.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') navigateLightbox(1);
        else if (e.key === 'ArrowRight') navigateLightbox(-1);
    }
    if (e.key !== 'Escape') return;

    const openModals = Array.from(document.querySelectorAll('[id$="Modal"]:not(.hidden)'))
        .sort((first, second) => {
            const firstZ = Number.parseInt(getComputedStyle(first).zIndex, 10) || 0;
            const secondZ = Number.parseInt(getComputedStyle(second).zIndex, 10) || 0;
            return firstZ - secondZ;
        });
    const topModal = openModals.at(-1);
    if (topModal) {
        if (topModal.id === 'faceCameraModal') window.closeFaceCamera();
        else if (topModal.id === 'adminTaskModal') window.closeAdminTaskWindow?.();
        else window.closeModal(topModal.id);
        return;
    }
    const drawer = document.getElementById('adminDrawer');
    if (drawer?.classList.contains('translate-x-0')) window.toggleAdminDrawer();
});

window.openLightbox = openLightbox;

window.navigateLightbox = navigateLightbox;
