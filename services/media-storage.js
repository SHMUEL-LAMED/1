// העלאה, אישור ומחיקה של מדיה ב־R2 ובענן
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { dataUrlToBlob, safeRecordId } from '../core/utils.js';
import { r2Request } from './r2-client.js';

window.uploadMediaToR2 = async function(mediaBlob, imgId, title = 'קובץ מדיה') {
    if (!(mediaBlob instanceof Blob)) throw new Error('קובץ המדיה אינו תקין.');
    const isVideo = String(mediaBlob.type || '').startsWith('video/');
    if (isVideo && mediaBlob.size > 100 * 1024 * 1024) throw new Error('גודל הסרטון חייב להיות עד 100MB.');
    const cleanTitle = String(title || 'קובץ מדיה').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'קובץ מדיה';
    const form = new FormData();
    const extension = mediaBlob.type === 'video/webm' ? 'webm' : (isVideo ? 'mp4' : 'jpg');
    form.append('file', mediaBlob, `${safeRecordId(imgId) || 'media'}.${extension}`);
    form.append('imageId', safeRecordId(imgId));
    form.append('title', cleanTitle);
    const result = await r2Request('/upload', {
        method: 'POST',
        body: form
    });
    if (!result?.url || !result?.key) throw new Error('שרת האחסון לא החזיר כתובת לקובץ.');
    return {
        url: result.url,
        r2Key: result.key,
        r2OwnerUid: window.state.currentUser?.uid || '',
        r2Stored: true,
        mediaType: result.mediaType || (isVideo ? 'video' : 'image'),
        mimeType: result.mimeType || mediaBlob.type || ''
    };
};

window.uploadImageToR2 = async function(base64Data, imgId, title = 'תמונה') {
    return window.uploadMediaToR2(dataUrlToBlob(base64Data), imgId, title);
};

async function prepareMediaRecordForCloud(record, mediaId) {
    const { sourceFile, thumbnailDataUrl, _isDuplicate, ...cleanRecord } = record;
    let preparedRecord = cleanRecord;
    if (sourceFile instanceof Blob) {
        const storedMedia = await window.uploadMediaToR2(sourceFile, mediaId, cleanRecord.title);
        preparedRecord = { ...cleanRecord, ...storedMedia };
    } else if (cleanRecord.url && cleanRecord.url.startsWith('data:')) {
        const storedImage = await window.uploadImageToR2(cleanRecord.url, mediaId, cleanRecord.title);
        preparedRecord = { ...cleanRecord, ...storedImage };
    }
    if (thumbnailDataUrl) {
        const storedThumbnail = await window.uploadImageToR2(thumbnailDataUrl, `${mediaId}_thumb`, `${cleanRecord.title || 'סרטון'}-תמונה-מקדימה`);
        preparedRecord.thumbnailUrl = storedThumbnail.url;
        preparedRecord.thumbnailR2Key = storedThumbnail.r2Key;
    }
    return preparedRecord;
}

window.deleteImageFromR2 = async function(imageRecord) {
    const keys = [imageRecord?.r2Key, imageRecord?.thumbnailR2Key].map(key => String(key || '').trim()).filter(Boolean);
    for (const key of keys) {
        try {
            const encodedKey = key.split('/').map(encodeURIComponent).join('/');
            await r2Request(`/media/${encodedKey}`, { method: 'DELETE' });
        } catch (error) {
            console.warn('לא ניתן היה למחוק את הקובץ מ-R2:', error);
        }
    }
};

window.approveImageInR2 = async function(imageRecord) {
    const key = String(imageRecord?.r2Key || '').trim();
    if (!key.startsWith('pending/')) return imageRecord;
    const result = await r2Request('/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
    });
    if (!result?.url || !result?.key) throw new Error('שרת האחסון לא השלים את אישור התמונה.');
    const approvedRecord = { ...imageRecord, url: result.url, r2Key: result.key, status: 'active' };
    const thumbnailKey = String(imageRecord?.thumbnailR2Key || '');
    if (thumbnailKey.startsWith('pending/')) {
        const thumbnailResult = await r2Request('/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: thumbnailKey })
        });
        if (thumbnailResult?.url && thumbnailResult?.key) {
            approvedRecord.thumbnailUrl = thumbnailResult.url;
            approvedRecord.thumbnailR2Key = thumbnailResult.key;
        }
    }
    return approvedRecord;
};

window.saveFolderToCloud = async function(folderData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    const folderId = safeRecordId(folderData?.id);
    if (!folderId) throw new Error('מזהה התיקייה אינו תקין.');
    const { doc, setDoc } = window.firestoreModules;
    const folderRecord = { ...folderData, id: folderId };
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'folders', folderId), folderRecord);
    // Update local state immediately so the folder appears without waiting for the next poll
    const existingFolderIndex = (window.state.folders || []).findIndex(f => safeRecordId(f.id) === folderId);
    if (existingFolderIndex >= 0) {
        window.state.folders = window.state.folders.map((f, i) => i === existingFolderIndex ? folderRecord : f);
    } else {
        window.state.folders = [...(window.state.folders || []), folderRecord];
    }
    window.renderFolders();
    window.populateFolderSelects?.();
};

window.deleteFolderCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תיקייה דורשת אישור מנהל־על.');
    const folderId = safeRecordId(id);
    if (!folderId) throw new Error('מזהה התיקייה אינו תקין.');
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'folders', folderId));
};

window.saveImageToCloud = async function(imgData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    const canUploadDirectly = window.state.isAdminLoggedIn || (
        window.state.userApprovalStatus === 'approved' && window.state.userRole === 'uploader'
    );
    if (!canUploadDirectly) throw new Error('אין לחשבון הרשאת העלאה ישירה.');

    const imageId = safeRecordId(imgData?.id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    let imageRecord;
    try {
        imageRecord = await prepareMediaRecordForCloud({ ...imgData, id: imageId }, imageId);
    } catch(e) {
        console.error('R2 upload failed:', e);
        throw new Error(e.message || 'העלאת הקובץ לאחסון נכשלה.');
    }

    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', imageId), imageRecord);
    // Upsert into local state immediately so changes appear without waiting for the next poll
    const existingImageIndex = (window.state.images || []).findIndex(img => safeRecordId(img.id) === imageId);
    if (existingImageIndex >= 0) {
        window.state.images = window.state.images.map((img, i) => i === existingImageIndex ? imageRecord : img);
    } else {
        window.state.images = [imageRecord, ...(window.state.images || [])];
        window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    window.renderImages();
    window.renderFolders();
    // הפקת טביעות הפנים לתמונה חדשה רצה ברקע. היא לעולם אינה מעכבת את
    // ההעלאה ואינה מכשילה אותה — כישלון רק משאיר את התמונה לאינדוקס הבא.
    try {
        window.queueFaceIndexForImage?.(imageRecord);
    } catch (error) {
        console.warn('הוספת התמונה לתור אינדוקס הפנים נכשלה:', error);
    }
};

window.deleteImageCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תמונה דורשת אישור מנהל־על.');
    const imageId = safeRecordId(id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    try {
        const img = window.state.images.find(i => safeRecordId(i.id) === imageId);
        if (img) await window.deleteImageFromR2(img);
    } catch (e) {
        console.warn('R2 deletion failed or skipped during cloud delete:', e);
    }
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', imageId));
};

window.savePendingImageCloud = async function(imgData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (window.state.userApprovalStatus !== 'approved' || window.state.userRole !== 'viewer') {
        throw new Error('העלאה לאישור זמינה רק למשתמש מאושר בדרגה 1.');
    }
    const imageId = safeRecordId(imgData?.id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    let imageRecord = {
        ...imgData,
        id: imageId,
        status: 'pending',
        uploadedBy: window.state.currentUser?.uid || '',
        uploadedByName: window.state.currentUser?.displayName || '',
        uploadedByEmail: window.state.currentUser?.email || ''
    };

    try {
        imageRecord = await prepareMediaRecordForCloud(imageRecord, imageId);
    } catch(e) {
        console.error('R2 upload failed:', e);
        throw new Error(e.message || 'העלאת הקובץ לאחסון נכשלה.');
    }

    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', imageId), imageRecord);
    // Update local state immediately so the pending item appears without waiting for the next poll
    if (!(window.state.pendingImages || []).some(img => safeRecordId(img.id) === imageId)) {
        window.state.pendingImages = [imageRecord, ...(window.state.pendingImages || [])];
    }
    window.renderPendingImages?.();
    window.updatePendingBadge?.();
};

window.deletePendingImageCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תמונה ממתינה דורשת אישור מנהל־על.');
    const imageId = safeRecordId(id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    try {
        const img = window.state.pendingImages.find(i => safeRecordId(i.id) === imageId);
        if (img) await window.deleteImageFromR2(img);
    } catch (e) {
        console.warn('R2 deletion failed or skipped during pending delete:', e);
    }
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', imageId));
};
