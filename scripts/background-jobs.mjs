import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readCaptureDate, captureFields, captureFromDriveMetadata, needsCaptureDate, CAPTURE_HEAD_BYTES } from '../capture-date.js';
import { selectVariantCandidates } from '../media-variants.js';
import { needsAiDescription } from '../scene-tags.js';
import { pathToFileURL } from 'node:url';

export const JOB_NAMES = ['titles', 'faces', 'variants', 'dates', 'drive'];
export function canRetry(retries, job, id, now = Date.now()) {
    return !retries.some(item => item.job === job && item.id === id && item.after > now);
}
export function noteRetry(retries, job, id, now = Date.now()) {
    const previous = retries.find(item => item.job === job && item.id === id);
    const attempts = Math.min(10, (previous?.attempts || 0) + 1);
    return [...retries.filter(item => item.job !== job || item.id !== id), { job, id, attempts, after: now + Math.min(86400000, 900000 * 2 ** (attempts - 1)) }].slice(-500);
}

export async function runBackgroundJobs({ apiOrigin = process.env.GALLERY_API_ORIGIN, budgetMs = 12 * 60 * 1000, maxItems = 40, authenticate, launchBrowser, report = console.log } = {}) {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    let token = await authenticate(apiOrigin);
    let browser, page, server;
    let config, state;
    const jobs = Object.fromEntries(JOB_NAMES.map(name => [name, { processed: 0, failed: 0, message: '' }]));
    let retry = [];
    let cursor = {};
    const api = async (path, options = {}) => {
        const response = await fetch(`${apiOrigin}${path}`, {
            ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(options.timeoutMs || 90000)
        });
        if (options.binary) {
            if (!response.ok) throw Object.assign(new Error('media_read_failed'), { status: response.status });
            return response;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.code || 'request_failed'), { status: response.status });
        return data;
    };
    const post = (path, data) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const put = (collection, id, data) => api(`/data/${collection}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, merge: true }) });
    const progress = async phase => post('/background/status', { runId: process.env.GITHUB_RUN_ID || '', startedAt, phase, jobs, retry, cursor });
    const refreshConfig = async () => { config = (await api('/background/config')).config; return config; };
    const list = async collection => {
        const all = [];
        let after = '';
        do {
            const result = await api(`/data/${collection}?limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`);
            all.push(...(result.documents || []).map(item => ({ ...item.data, id: item.id })));
            after = result.nextCursor || '';
        } while (after && Date.now() < deadline);
        return all;
    };
    const stored = record => /^(approved|pending)\//.test(record.r2Key || '') && String(record.url || '').startsWith(`${apiOrigin}/media/`);
    const ensurePage = async () => {
        if (page) return page;
        server = spawn(process.execPath, ['e2e/static-server.mjs', '8081'], { stdio: 'ignore', env: { ...process.env, E2E_ROOT: '.' } });
        for (let attempt = 0; attempt < 50; attempt++) {
            try { if ((await fetch('http://127.0.0.1:8081/index.html')).ok) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        browser = launchBrowser ? await launchBrowser() : await chromium.launch({ headless: true });
        page = await browser.newPage();
        await page.route(`${apiOrigin}/**`, async route => {
            const headers = { ...route.request().headers(), Authorization: `Bearer ${token}` };
            delete headers.origin;
            delete headers.host;
            const range = /^bytes=(\d+)-$/.exec(headers.range || '');
            if (range) headers.range = `bytes=${range[1]}-${Number(range[1]) + 4 * 1024 * 1024 - 1}`;
            try {
                const response = await fetch(route.request().url(), { headers, signal: AbortSignal.timeout(90000) });
                const outHeaders = Object.fromEntries(response.headers);
                outHeaders['access-control-allow-origin'] = '*';
                // Node fetch מפענח דחיסה בעצמו.
                delete outHeaders['content-encoding']; delete outHeaders['content-length'];
                await route.fulfill({ status: response.status, headers: outHeaders, body: Buffer.from(await response.arrayBuffer()) });
            } catch { await route.abort(); }
        });
        await page.route('**/background-runner.html*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>' }));
        await page.goto('http://127.0.0.1:8081/background-runner.html?api=production');
        await page.evaluate(async () => {
            window.backgroundVariants = await import('/media-variants-generate.js');
        });
        return page;
    };
    const createVariants = async record => {
        const view = await ensurePage();
        const encoded = await view.evaluate(async record => {
            const source = record.mediaType === "video" ? record.url : await (await fetch(record.url)).blob();
            const generated = await window.backgroundVariants.generateMediaVariants(source, { isVideo: record.mediaType === 'video' });
            const parts = [];
            for (const [name, part] of Object.entries(generated.parts || {})) {
                const bytes = new Uint8Array(await part.blob.arrayBuffer());
                let text = '';
                for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
                parts.push({ name, width: part.width, height: part.height, type: part.blob.type, extension: part.extension, base64: btoa(text) });
            }
            return parts;
        }, record);
        const form = new FormData();
        form.append('imageId', record.id);
        const meta = {};
        for (const part of encoded) {
            form.append(`variant_${part.name}`, new Blob([Buffer.from(part.base64, 'base64')], { type: part.type }), `${part.name}.${part.extension}`);
            meta[part.name] = { width: part.width, height: part.height };
        }
        form.append('variantsMeta', JSON.stringify(meta));
        const result = await api('/media/variants', { method: 'POST', body: form });
        Object.assign(record, { variants: result.variants, variantsVersion: 1 });
    };
    let driveAccessToken;
    const driveRequest = async path => {
        const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${driveAccessToken}` }, signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`drive_${response.status}`);
        return response;
    };
    const syncDrive = async records => {
        if (!config.enabled.drive) return;
        const interval = config.intervalMinutes * 60000;
        if (!cursor.drive && cursor.lastDriveAt && Date.now() - cursor.lastDriveAt < interval) return;
        const connection = await post('/background/drive-token', {});
        if (!connection.connected) { jobs.drive.message = 'נדרש חיבור Google Drive קבוע בחשבון מנהל'; return; }
        driveAccessToken = connection.accessToken;
        const byId = new Map(records.map(record => [record.id, record]));
        const configuredRoots = config.driveFolders.filter(folder => folder.autoSync !== false);
        // התור נשמר בענן בין ריצות: תיקייה, עמוד ופריט בתוך העמוד.
        const rootsKey = JSON.stringify(configuredRoots);
        if (cursor.driveRoots !== rootsKey) { cursor.drive = null; cursor.driveRoots = rootsKey; }
        const driveDeadline = Math.min(deadline - 120000, Date.now() + budgetMs / 5);
        const pending = cursor.drive?.pending || configuredRoots.map(folder => ({ id: folder.id, name: folder.label || 'Drive', root: folder.id, depth: 0, parent: null, pageToken: '', offset: 0 }));
        let added = 0;
        while (pending.length && Date.now() < driveDeadline && added < 30) {
            await refreshConfig();
            if (!config.enabled.drive) break;
            const folder = pending[0];
            const folderId = `drivefolder_${folder.id}`;
            await put('folders', folderId, { id: folderId, name: folder.name, icon: 'folder-sync', isDefault: false, driveFolderId: folder.id, driveParentFolderId: folder.parent, parentFolderId: folder.parent ? `drivefolder_${folder.parent}` : null, driveRootFolderId: folder.root, driveDepth: folder.depth, syncedFromDrive: true });
            const params = new URLSearchParams({ q: `'${folder.id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,imageMediaMetadata(time))', pageSize: '100', orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
            if (folder.pageToken) params.set('pageToken', folder.pageToken);
            const batch = await (await driveRequest(`files?${params}`)).json();
            const files = batch.files || [];
            for (let i = folder.offset || 0; i < files.length; i++) {
                if (Date.now() >= driveDeadline || added >= 30) { folder.offset = i; break; }
                const file = files[i];
                const id = `driveimage_${file.id}`;
                try {
                    if (file.mimeType === 'application/vnd.google-apps.folder') {
                        if (folder.depth < 20 && pending.length < 500 && !pending.some(item => item.id === file.id)) pending.push({ id: file.id, name: file.name, root: folder.root, parent: folder.id, depth: folder.depth + 1, pageToken: '', offset: 0 });
                    } else if (/^(image|video)\//.test(file.mimeType || '')) {
                        const existing = byId.get(id);
                        if (!existing || existing.driveModifiedTime !== file.modifiedTime) {
                            if (canRetry(retry, 'drive', id)) {
                                const isVideoFile = String(file.mimeType).startsWith("video/");
                                if (Number(file.size) > (isVideoFile ? 1024 : 50) * 1024 * 1024) throw new Error("media_too_large");
                                const media = await driveRequest(`files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`);
                                const source = await media.blob();
                                const type = file.mimeType || source.type;
                                const isVideo = type.startsWith('video/');
                                let uploaded;
                                if (source.size > (isVideo ? 100 : 10) * 1024 * 1024) {
                                    const session = await post('/upload/multipart/create', { imageId: id, title: file.name, fileName: file.name, mimeType: type, size: source.size });
                                    for (let part = 1; part <= session.totalParts; part++) {
                                        await api(`/upload/multipart/part?uploadId=${encodeURIComponent(session.uploadId)}&partNumber=${part}`, { method: 'PUT', body: source.slice((part - 1) * session.partSize, part * session.partSize) });
                                    }
                                    const completion = new FormData();
                                    completion.append('uploadId', session.uploadId);
                                    uploaded = await api('/upload/multipart/complete', { method: 'POST', body: completion });
                                } else {
                                    const form = new FormData();
                                    form.append('file', source, file.name); form.append('imageId', id); form.append('title', file.name);
                                    uploaded = await api('/upload', { method: 'POST', body: form });
                                }
                                const modified = Date.parse(file.modifiedTime) || Date.now();
                                const record = { ...(existing || {}), id, folderId, title: String(file.name).replace(/\.[^.]+$/, ''), originalTitle: file.name, variants: {}, variantsVersion: 0, aiTitleVersion: 0, takenAt: null, takenAtDate: null, takenAtSource: null, url: uploaded.url, r2Key: uploaded.key, r2Stored: true, mediaType: isVideo ? 'video' : 'image', mimeType: type, createdAt: existing?.createdAt || modified, date: new Date(modified).toISOString().slice(0,10), driveFileId: file.id, driveFolderId: folder.id, driveRootFolderId: folder.root, driveModifiedTime: file.modifiedTime, syncedFromDrive: true, ...(captureFromDriveMetadata(file) ? captureFields(captureFromDriveMetadata(file)) : {}) };
                                await put('images', id, record);
                                byId.set(id, record); if (existing) records[records.findIndex(item => item.id === id)] = record; else records.push(record); added += 1; jobs.drive.processed += 1;
                                retry = retry.filter(item => item.job !== 'drive' || item.id !== id);
                            }
                        } else if (existing.folderId !== folderId) {
                            await put('images', id, { ...existing, folderId, driveFolderId: folder.id });
                        }
                    }
                } catch { jobs.drive.failed += 1; retry = noteRetry(retry, 'drive', id); }
                folder.offset = i + 1;
                cursor.drive = { pending };
                await progress('drive');
            }
            if (folder.offset >= files.length) {
                if (batch.nextPageToken) { folder.pageToken = batch.nextPageToken; folder.offset = 0; }
                else pending.shift();
            }
            cursor.drive = pending.length ? { pending } : null;
            await progress('drive');
        }
        if (!pending.length) cursor.lastDriveAt = Date.now();
        jobs.drive.message = pending.length ? 'הסנכרון ימשיך בריצה הבאה' : 'סנכרון Drive הושלם';
    };
    const runJob = async (name, records, processItem) => {
        let done = 0;
        const jobDeadline = Math.min(deadline, Date.now() + budgetMs / 5);
        await refreshConfig();
        if (!config.enabled[name]) { jobs[name].message = 'מושהה'; return; }
        for (const record of records) {
            if (Date.now() >= jobDeadline || done >= maxItems) break;
            if (!canRetry(retry, name, record.id)) continue;
            await refreshConfig();
            if (!config.enabled[name]) break;
            try {
                await processItem(record);
                jobs[name].processed += 1;
                retry = retry.filter(item => item.job !== name || item.id !== record.id);
            } catch (error) {
                jobs[name].failed += 1;
                retry = noteRetry(retry, name, record.id);
                if (name === 'titles' && [429, 502, 503].includes(error.status)) { jobs[name].message = 'מנוע AI אינו זמין כרגע; ינסה שוב בריצה הבאה'; break; }
            }
            done += 1;
            await progress(name);
        }
    };
    try {
        await refreshConfig();
        state = (await api('/background/status')).state;
        retry = state.retry || [];
        cursor = state.cursor || {};
        const images = await list('images');
        const pending = await list('pendingImages');
        await progress('starting');
        try { await syncDrive(images); } catch { jobs.drive.message = 'סנכרון Drive נכשל; ינסה שוב בריצה הבאה'; jobs.drive.failed += 1; }
        const media = [...new Map([...pending, ...images].filter(stored).map(record => [record.id, record])).values()];
        const variantCandidates = selectVariantCandidates(media, { sanitize: value => value, isSupported: item => String(item.url).startsWith(`${apiOrigin}/media/`) }).candidates;
        await runJob('variants', variantCandidates.map(item => media.find(record => record.id === item.imageId)), createVariants);
        await runJob('dates', media.filter(needsCaptureDate), async record => {
            let capture;
            if (driveAccessToken && record.driveFileId) {
                try { capture = captureFromDriveMetadata(await (await driveRequest(`files/${record.driveFileId}?fields=imageMediaMetadata(time)&supportsAllDrives=true`)).json()); } catch {}
            }
            if (!capture) {
                const head = await api(`/media/probe/${record.id}?length=${CAPTURE_HEAD_BYTES}`, { binary: true });
                const size = Number(head.headers.get('X-Media-Size'));
                const bytes = new Uint8Array(await head.arrayBuffer());
                capture = await readCaptureDate({ size, read: async (offset, length) => offset + length <= bytes.length ? bytes.subarray(offset, offset + length) : new Uint8Array(await (await api(`/media/probe/${record.id}?offset=${offset}&length=${length}`, { binary: true })).arrayBuffer()) });
            }
            await post('/media/taken-at', { updates: [{ imageId: record.id, ...captureFields(capture) }] });
        });
        // POST /ai-title נותן שם, כיתוב ותגיות בקריאה אחת; נשלחת כל תמונה שחסר לה
        // שם AI או כיתוב מהגרסה הנוכחית (כיתוב שנערך ידנית לעולם אינו נשלח שוב).
        await runJob('titles', images.filter(record => stored(record) && needsAiDescription(record)), record => post('/ai-title', { imageId: record.id }));
        const faceImages = images.filter(record => stored(record) && record.mediaType !== 'video');
        const pendingFaces = new Set();
        for (let offset = 0; offset < faceImages.length; offset += 200) {
            const result = await post('/face/index/pending', { imageIds: faceImages.slice(offset, offset + 200).map(record => record.id) });
            for (const id of result.pending || []) pendingFaces.add(id);
        }
        await runJob('faces', faceImages.filter(record => pendingFaces.has(record.id)), async record => {
            const view = await ensurePage();
            // הטביעות ומיקום כל פרצוף בתמונה (לחיתוך התצוגה של האדם, ראו people-model.js).
            const { faces, boxes } = await view.evaluate(async record => {
                await import('/face-search.js');
                const { boxFromDetection } = await import('/people-model.js');
                const engine = await window.loadFaceApi();
                const image = await window.loadFaceImageElement(record.url);
                const detections = (await engine.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors()).slice(0,20);
                return {
                    faces: detections.map(face => Array.from(face.descriptor)),
                    boxes: detections.map(face => boxFromDetection(face.detection?.box, image.naturalWidth, image.naturalHeight))
                };
            }, record);
            const entry = { imageId: record.id, faces };
            if (boxes.length && boxes.every(Boolean)) entry.boxes = boxes;
            await post('/face/index', { images: [entry] });
        });
        // קיבוץ הפרצופים לאנשים: ה-Worker מקבץ גם לבד אחרי כל אינדוקס, וכאן
        // הוא ממשיך עד הסוף גם פרצופים ישנים שעוד לא קובצו.
        if (config.enabled.faces) {
            for (let round = 0; round < 40 && Date.now() < deadline; round += 1) {
                const result = await post('/face/clusters/run', {});
                if (result.busy || !result.processed || !result.remaining) break;
            }
        }
        await progress('idle');
        report(JSON.stringify({ processed: jobs, runId: process.env.GITHUB_RUN_ID || '' }));
    } catch (error) {
        await progress('failed').catch(() => {});
        throw error;
    } finally {
        await browser?.close();
        server?.kill('SIGTERM');
        token = ''; driveAccessToken = '';
    }
}

async function authenticate(apiOrigin) {
    const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
    url.searchParams.set('audience', `${apiOrigin}/background`);
    const oidcResponse = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(20000) });
    const oidc = await oidcResponse.json();
    if (!oidcResponse.ok || !oidc.value) throw new Error('GitHub OIDC unavailable');
    // הפריסה יכולה להתבצע במקביל ל-push שמפעיל את תהליך הרקע.
    for (let attempt = 0; attempt < 30; attempt++) {
        const response = await fetch(`${apiOrigin}/background/session`, { method: 'POST', headers: { Authorization: `Bearer ${oidc.value}` }, signal: AbortSignal.timeout(20000) });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.token) return result.token;
        if (![404, 405, 502, 503].includes(response.status)) throw new Error(`Background authentication failed (${response.status}, ${result.code || 'unknown'})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('Background endpoint unavailable');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    runBackgroundJobs({ authenticate }).catch(error => { console.error(`Background job failed: ${error.message}`); process.exitCode = 1; });
}
