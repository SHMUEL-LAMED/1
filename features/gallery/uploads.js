// העלאות: בחירת קבצים, כפילויות, עצירה והמשך ואישור
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.


function isSupportedVideoFile(file) {
    return Boolean(file && (
        ['video/mp4', 'video/webm'].includes(String(file.type || '').toLowerCase())
        || /\.(?:mp4|webm)$/i.test(file.name)
    ));
}

function isSupportedMediaFile(file) {
    return Boolean(file && (
        file.type.startsWith('image/')
        || /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
        || isSupportedVideoFile(file)
    ));
}

async function createFileFingerprint(file) {
    if (!(file instanceof Blob) || !window.crypto?.subtle) return '';
    const bytes = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

let duplicateUploadResolver = null;

window.resolveDuplicateUpload = function(choice) {
    window.closeModal('duplicateMediaModal');
    const resolver = duplicateUploadResolver;
    duplicateUploadResolver = null;
    if (resolver) resolver(choice);
};

async function resolveDuplicateMedia(records) {
    const knownHashes = new Set(
        [...(window.state.images || []), ...(window.state.pendingImages || [])]
            .map(item => String(item.contentHash || ''))
            .filter(Boolean)
    );
    const currentHashes = new Set();
    records.forEach(record => {
        const hash = String(record.contentHash || '');
        record._isDuplicate = Boolean(hash && (knownHashes.has(hash) || currentHashes.has(hash)));
        if (hash) currentHashes.add(hash);
    });
    const duplicates = records.filter(record => record._isDuplicate);
    if (!duplicates.length) return records;

    const message = document.getElementById('duplicateMediaMessage');
    const list = document.getElementById('duplicateMediaList');
    if (message) message.textContent = `נמצאו ${duplicates.length} קבצים שכבר קיימים בגלריה או מופיעים יותר מפעם אחת בבחירה הנוכחית.`;
    if (list) {
        list.replaceChildren();
        duplicates.slice(0, 20).forEach(record => {
            const row = document.createElement('p');
            row.className = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-slate-300 truncate';
            row.textContent = record.title || 'קובץ ללא שם';
            list.appendChild(row);
        });
    }
    window.openModal('duplicateMediaModal');
    window.scheduleIconRefresh();
    const choice = await new Promise(resolve => { duplicateUploadResolver = resolve; });
    if (choice === 'cancel') return [];
    if (choice === 'skip') return records.filter(record => !record._isDuplicate);
    return records;
}

function inspectVideoFile(file) {
    return new Promise(resolve => {
        const video = document.createElement('video');
        const objectUrl = URL.createObjectURL(file);
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(objectUrl);
            video.removeAttribute('src');
            video.load();
            resolve(result);
        };
        const timeout = window.setTimeout(() => finish({ duration: 0, thumbnailDataUrl: '' }), 15000);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
            const captureAt = Math.min(Math.max(0.1, duration * 0.1), 2);
            video.onseeked = () => {
                window.clearTimeout(timeout);
                try {
                    const width = video.videoWidth || 640;
                    const height = video.videoHeight || 360;
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(1, 800 / Math.max(width, height));
                    canvas.width = Math.max(1, Math.round(width * scale));
                    canvas.height = Math.max(1, Math.round(height * scale));
                    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
                    finish({ duration, thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.76) });
                } catch (error) {
                    finish({ duration, thumbnailDataUrl: '' });
                }
            };
            try {
                video.currentTime = captureAt;
            } catch (error) {
                window.clearTimeout(timeout);
                finish({ duration, thumbnailDataUrl: '' });
            }
        };
        video.onerror = () => {
            window.clearTimeout(timeout);
            finish({ duration: 0, thumbnailDataUrl: '' });
        };
        video.src = objectUrl;
    });
}

export function formatMediaDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const remaining = String(total % 60).padStart(2, '0');
    return `${minutes}:${remaining}`;
}

window.renderSelectedUploadQueue = function(inputIds, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const files = (inputIds || []).flatMap(id => Array.from(document.getElementById(id)?.files || [])).filter(isSupportedMediaFile);
    container.replaceChildren();
    container.classList.toggle('hidden', files.length === 0);
    files.forEach((file, index) => {
        const row = document.createElement('div');
        row.dataset.uploadIndex = String(index);
        row.className = 'flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2';
        const icon = document.createElement('span');
        icon.className = 'upload-queue-icon text-amber-400';
        icon.innerHTML = `<i data-lucide="${isSupportedVideoFile(file) ? 'video' : 'image'}" class="w-3.5 h-3.5"></i>`;
        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[10px] font-bold text-slate-200 truncate';
        name.textContent = file.webkitRelativePath || file.name;
        const size = document.createElement('p');
        size.className = 'text-[8px] text-slate-500';
        size.textContent = file.size >= 1024 * 1024
            ? `${(file.size / (1024 * 1024)).toFixed(1)}MB`
            : `${Math.max(1, Math.round(file.size / 1024))}KB`;
        body.append(name, size);
        const status = document.createElement('span');
        status.className = 'upload-queue-status text-[9px] text-slate-400';
        status.textContent = 'ממתין';
        row.append(icon, body, status);
        container.appendChild(row);
    });
    window.scheduleIconRefresh();
};

function updateUploadQueueItem(containerId, index, state, label) {
    const row = document.querySelector(`#${containerId} [data-upload-index="${index}"]`);
    if (!row) return;
    const status = row.querySelector('.upload-queue-status');
    const icon = row.querySelector('.upload-queue-icon');
    if (status) {
        status.textContent = label;
        status.className = `upload-queue-status text-[9px] ${
            state === 'success' ? 'text-emerald-300' :
            state === 'error' ? 'text-red-300' :
            state === 'active' ? 'text-cyan-300' : 'text-slate-400'
        }`;
    }
    if (icon) {
        icon.className = `upload-queue-icon ${
            state === 'success' ? 'text-emerald-300' :
            state === 'error' ? 'text-red-300' :
            state === 'active' ? 'text-cyan-300' : 'text-amber-400'
        }`;
        icon.innerHTML = `<i data-lucide="${
            state === 'success' ? 'circle-check' :
            state === 'error' ? 'circle-x' :
            state === 'active' ? 'loader-circle' : 'image'
        }" class="w-3.5 h-3.5 ${state === 'active' ? 'animate-spin' : ''}"></i>`;
    }
    window.scheduleIconRefresh();
}

let uploadPaused = false;

let failedUploadRecords = [];

function waitWhileUploadPaused() {
    return new Promise(resolve => {
        const check = () => uploadPaused ? window.setTimeout(check, 250) : resolve();
        check();
    });
}

window.toggleUploadPause = function() {
    uploadPaused = !uploadPaused;
    const button = document.getElementById('userUploadPauseBtn');
    if (button) button.textContent = uploadPaused ? 'המשך העלאה' : 'השהה';
    const text = document.getElementById('userUploadProgressText');
    if (uploadPaused && text) text.textContent = 'תור ההעלאה מושהה. הקובץ הנוכחי יסתיים בבטחה.';
};

function updateUploadControlButtons(running = false) {
    const pause = document.getElementById('userUploadPauseBtn');
    const retry = document.getElementById('userUploadRetryBtn');
    if (pause) pause.classList.toggle('hidden', !running);
    if (retry) retry.classList.toggle('hidden', running || failedUploadRecords.length === 0);
}

window.retryFailedUploads = async function() {
    if (!failedUploadRecords.length) return;
    const pending = [...failedUploadRecords];
    failedUploadRecords = [];
    uploadPaused = false;
    updateUploadControlButtons(true);
    const progress = document.getElementById('userUploadProgress');
    const text = document.getElementById('userUploadProgressText');
    progress?.classList.remove('hidden');
    for (let index = 0; index < pending.length; index++) {
        await waitWhileUploadPaused();
        const item = pending[index];
        if (text) text.textContent = `ניסיון חוזר: ${index + 1} מתוך ${pending.length}`;
        updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'active', 'מנסה שוב');
        try {
            if (item.mode === 'pending') await window.savePendingImageCloud(item.record);
            else await window.saveImageToCloud(item.record);
            updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'success', 'הושלם');
        } catch (error) {
            failedUploadRecords.push(item);
            updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'error', 'נכשל שוב');
        }
    }
    progress?.classList.add('hidden');
    updateUploadControlButtons(false);
    window.showNotification(failedUploadRecords.length ? `${failedUploadRecords.length} קבצים עדיין לא הועלו.` : 'כל הקבצים הועלו בהצלחה.', failedUploadRecords.length === 0);
};

async function processFilesWithFolders(files, targetFolderId = 'auto', isAdmin = false) {
    const newImages = []; let processedCount = 0;
    const fallbackFolderId = window.safeRecordId(
        window.state.folders.find(folder => window.safeRecordId(folder.id) === '4')?.id
        || window.state.folders.find(folder => window.safeRecordId(folder.id) !== 'all')?.id
    );
    if (!fallbackFolderId) throw new Error('יש ליצור לפחות תיקיית יעד אחת לפני העלאת קבצים.');
    const progressEl = document.getElementById(isAdmin ? 'adminUploadProgressText' : 'userUploadProgressText');
    const queueId = isAdmin ? 'adminUploadQueue' : 'userUploadQueue';
    for (let i = 0; i < files.length; i++) {
        await waitWhileUploadPaused();
        const file = files[i]; let destFolderId = targetFolderId === 'auto' ? null : targetFolderId; let folderName = "כללי";
        updateUploadQueueItem(queueId, i, 'active', 'מעבד');
        let contentHash = '';
        try {
            contentHash = await createFileFingerprint(file);
        } catch (error) {
            console.warn('File fingerprint failed:', error);
        }
        if (file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length > 1) {
                folderName = parts[parts.length - 2];
                if (isAdmin && targetFolderId === 'auto') {
                    let existingFolder = window.state.folders.find(f => f.name === folderName);
                    if (!existingFolder) {
                        existingFolder = { id: 'folder_' + crypto.randomUUID(), name: folderName, icon: 'folder', isDefault: false };
                        await window.saveFolderToCloud(existingFolder);
                    }
                    destFolderId = existingFolder.id;
                }
            }
        }
        const isVideo = isSupportedVideoFile(file);
        if (isVideo && file.size > 100 * 1024 * 1024) {
            updateUploadQueueItem(queueId, i, 'error', 'מעל 100MB');
        } else if (isVideo) {
            const videoMimeType = file.type || (/\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4');
            const videoFile = file.type ? file : new File([file], file.name, { type: videoMimeType, lastModified: file.lastModified });
            const videoInfo = await inspectVideoFile(videoFile);
            newImages.push({
                uploadQueueIndex: i,
                id: `img_${crypto.randomUUID()}`,
                folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: '',
                sourceFile: videoFile, mediaType: 'video', mimeType: videoMimeType,
                duration: videoInfo.duration,
                thumbnailDataUrl: videoInfo.thumbnailDataUrl,
                contentHash, originalSize: file.size,
                date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName
            });
            updateUploadQueueItem(queueId, i, 'ready', 'מוכן');
        } else {
            const base64 = await window.compressAndConvertImage(file, 800, 800, 0.6);
            if (base64) {
                newImages.push({
                    uploadQueueIndex: i,
                    id: `img_${crypto.randomUUID()}`,
                    folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: base64,
                    mediaType: 'image', mimeType: 'image/jpeg',
                    contentHash, originalSize: file.size,
                    date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName
                });
                updateUploadQueueItem(queueId, i, 'ready', 'מוכן');
            } else {
                updateUploadQueueItem(queueId, i, 'error', 'עיבוד נכשל');
            }
        }
        processedCount++;
        if (progressEl) progressEl.innerText = `מעבד: ${Math.round((processedCount / files.length) * 100)}%`;
    }
    return newImages;
}

async function handleAddPhotoAdmin(event, confirmed = false) {
    event?.preventDefault(); if (!window.checkAdminPermission()) return;
    const filesInput = document.getElementById('adminMultiFiles'); const folderInput = document.getElementById('adminFolderUpload');
    const targetFolderId = document.getElementById('adminTargetFolderSelect').value;
    let allFiles = [];
    if (filesInput && filesInput.files.length > 0) allFiles = [...allFiles, ...Array.from(filesInput.files)];
    if (folderInput && folderInput.files.length > 0) allFiles = [...allFiles, ...Array.from(folderInput.files)];
    allFiles = allFiles.filter(isSupportedMediaFile);

    if (allFiles.length === 0) { window.showNotification('נא לבחור תמונות, סרטונים או תיקייה', false); return; }
    if (!confirmed) {
        window.showConfirm(
            'העלאת קבצים לגלריה',
            `להעלות ${allFiles.length} קבצים לגלריה? הקבצים יעובדו ויישמרו בענן.`,
            () => handleAddPhotoAdmin(null, true)
        );
        return;
    }

    const progressContainer = document.getElementById('adminUploadProgress');
    if(progressContainer) progressContainer.classList.remove('hidden');
    const pText = document.getElementById('adminUploadProgressText');

    try {
        failedUploadRecords = [];
        uploadPaused = false;
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, true);
        if (newImages.length === 0) throw new Error('לא נמצאו קובצי מדיה תקינים.');
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        let uploadedCount = 0;
        let failedCount = 0;
        for (let index = 0; index < uploadRecords.length; index++) {
            await waitWhileUploadPaused();
            if(pText) pText.innerText = `מעלה לאחסון: ${index + 1} מתוך ${uploadRecords.length}`;
            const { uploadQueueIndex, ...imageRecord } = uploadRecords[index];
            updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'active', 'מעלה');
            try {
                await window.saveImageToCloud(imageRecord);
                uploadedCount++;
                updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'success', 'הושלם');
            } catch (error) {
                failedCount++;
                failedUploadRecords.push({ record: imageRecord, queueId: 'adminUploadQueue', uploadQueueIndex, mode: 'direct' });
                updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'error', 'נכשל — נסה שוב');
                console.warn('Single admin upload failed:', error);
            }
        }
        if (!uploadedCount) throw new Error('העלאת הקבצים נכשלה. ניתן לנסות שוב.');
        if(filesInput) filesInput.value = '';
        if(folderInput) folderInput.value = '';
        await window.logActivity('uploaded_images', 'media', '', `${uploadedCount} קבצים`, failedCount ? `${failedCount} נכשלו` : 'העלאה דרך לוח הניהול');
        window.showNotification(`הועלו ${uploadedCount} קבצים לגלריה${failedCount ? `; ${failedCount} נכשלו וניתן לנסות שוב` : ''}.`);
    } catch (error) {
        console.error('Admin upload failed:', error);
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
    }
}

async function submitUserUpload(confirmed = false) {
    const approved = window.state.userApprovalStatus === 'approved';
    const canUploadDirectly = approved && ['uploader', 'admin', 'super_admin'].includes(window.state.userRole);
    const canSubmitForApproval = approved && window.state.userRole === 'viewer';
    if (!canUploadDirectly && !canSubmitForApproval) {
        window.showNotification('אין לחשבון שלך הרשאת העלאת תמונות.', false);
        return;
    }
    const filesInput = document.getElementById('userMultiFiles'); const folderInput = document.getElementById('userFolderUpload');
    const targetFolderEl = document.getElementById('userTargetFolderSelect');
    const targetFolderId = targetFolderEl?.value || '4';
    if (!window.state.folders.some(folder => window.safeRecordId(folder.id) === window.safeRecordId(targetFolderId))) {
        window.showNotification('נא לבחור תיקיית יעד תקינה.', false);
        return;
    }
    let allFiles = [];
    if (filesInput && filesInput.files.length > 0) allFiles = [...allFiles, ...Array.from(filesInput.files)];
    if (folderInput && folderInput.files.length > 0) allFiles = [...allFiles, ...Array.from(folderInput.files)];
    allFiles = allFiles.filter(isSupportedMediaFile);

    if (allFiles.length === 0) { window.showNotification('נא לבחור תמונות או סרטונים', false); return; }
    if (!confirmed) {
        window.showConfirm(
            canUploadDirectly ? 'העלאת תמונות לגלריה' : 'שליחת תמונות לאישור',
            canUploadDirectly
                ? `להעלות ${allFiles.length} קבצים ישירות לגלריה?`
                : `לשלוח ${allFiles.length} קבצים לאישור מנהל?`,
            () => submitUserUpload(true)
        );
        return;
    }
    const btn = document.getElementById('userUploadSubmitBtn');
    if(btn) btn.disabled = true;

    const progressContainer = document.getElementById('userUploadProgress');
    if(progressContainer) progressContainer.classList.remove('hidden');
    const pText = document.getElementById('userUploadProgressText');

    try {
        failedUploadRecords = [];
        uploadPaused = false;
        updateUploadControlButtons(true);
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, false);
        if (newImages.length === 0) throw new Error('לא נמצאו קובצי מדיה תקינים.');
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        let uploadedCount = 0;
        let failedCount = 0;
        for (let index = 0; index < uploadRecords.length; index++) {
            await waitWhileUploadPaused();
            if(pText) pText.innerText = `${canUploadDirectly ? 'מעלה לגלריה' : 'שולח לאישור'}: ${index + 1} מתוך ${uploadRecords.length}`;
            const { uploadQueueIndex, ...imageRecord } = uploadRecords[index];
            updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'active', canUploadDirectly ? 'מעלה' : 'שולח');
            try {
                if (canUploadDirectly) await window.saveImageToCloud(imageRecord);
                else await window.savePendingImageCloud(imageRecord);
                uploadedCount++;
                updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'success', 'הושלם');
            } catch (error) {
                failedCount++;
                failedUploadRecords.push({ record: imageRecord, queueId: 'userUploadQueue', uploadQueueIndex, mode: canUploadDirectly ? 'direct' : 'pending' });
                updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'error', 'נכשל — נסה שוב');
                console.warn('Single user upload failed:', error);
            }
        }
        if (!uploadedCount) throw new Error('העלאת הקבצים נכשלה. ניתן לנסות שוב.');
        await window.logActivity('uploaded_images', 'media', '', `${uploadedCount} קבצים`, `${canUploadDirectly ? 'העלאה ישירה' : 'נשלחו לאישור'}${failedCount ? `; ${failedCount} נכשלו` : ''}`);
        window.showNotification(canUploadDirectly
            ? `${uploadedCount} קבצים הועלו בהצלחה לגלריה${failedCount ? `; ${failedCount} נכשלו` : ''}!`
            : `${uploadedCount} קבצים נשלחו לאישור מנהל${failedCount ? `; ${failedCount} נכשלו` : ''}.`
        );
        if(filesInput) filesInput.value = '';
        if(folderInput) folderInput.value = '';
        if (!failedCount) window.closeModal('userUploadModal');
    } catch (error) {
        console.error('User upload failed:', error);
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
        if(btn) btn.disabled = false;
        updateUploadControlButtons(false);
    }
}

window.submitUserUpload = submitUserUpload;

window.handleAddPhotoAdmin = handleAddPhotoAdmin;

window.resetUploadPauseState = function() {
    uploadPaused = false;
    const pauseButton = document.getElementById('userUploadPauseBtn');
    if (pauseButton) pauseButton.textContent = 'השהה';
};
