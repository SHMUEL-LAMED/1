// content-hash.js — טביעת התוכן של קובץ לפני העלאה (SHA-256 מלא, hex).
//
// הטביעה מחושבת על הקובץ כפי שנבחר, לפני ההקטנה (upload-compress.js), ולכן
// אותה תמונה שנבחרת פעמיים מקבלת אותה טביעה. היא נשמרת ברשומה (contentHash)
// ונשלחת ל-Worker (POST /duplicates) כדי לגלות כפילויות לפני ההעלאה.
//
// קובץ עד 64MB נקרא בבת אחת ל-crypto.subtle (מהיר). קובץ גדול יותר — סרטון של
// מאות מגה — נקרא בחלקים של 4MB ועובר דרך מימוש SHA-256 מצטבר שכאן, כך שלעולם
// אינו נטען כולו לזיכרון. התוצאה זהה בשני המסלולים (אותו אלגוריתם).
//
// legacyHash היא הטביעה מדגימות ("s1:") שהדפדפן חישב עד עכשיו לקובץ מעל 64MB:
// רשומות ישנות של סרטונים גדולים נושאות אותה, ולכן גם היא נשלחת לבדיקה.
// המודול בלי DOM ונבדק ב-Node מול node:crypto.

export const FULL_HASH_SUBTLE_MAX_BYTES = 64 * 1024 * 1024;
export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const LEGACY_SAMPLE_BYTES = 1024 * 1024;

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function toHex(bytes) {
    let text = '';
    for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
    return text;
}

// SHA-256 מצטבר: update() מקבל חלקים בכל גודל, digestHex() מסיים.
export function createSha256() {
    const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const words = new Uint32Array(64);
    const block = new Uint8Array(64);
    let blockLength = 0;
    let totalBytes = 0;
    let finished = false;

    function compress(bytes, offset) {
        for (let index = 0; index < 16; index += 1) {
            const at = offset + index * 4;
            words[index] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
        }
        for (let index = 16; index < 64; index += 1) {
            const w15 = words[index - 15];
            const w2 = words[index - 2];
            const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
            const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
        }
        let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
        for (let index = 0; index < 64; index += 1) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[index] + words[index]) | 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0;
            d = c; c = b; b = a; a = (temp1 + temp2) | 0;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
    }

    return {
        update(input) {
            if (finished) throw new Error('הטביעה כבר הושלמה.');
            const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
            totalBytes += bytes.length;
            let offset = 0;
            if (blockLength) {
                const take = Math.min(64 - blockLength, bytes.length);
                block.set(bytes.subarray(0, take), blockLength);
                blockLength += take;
                offset = take;
                if (blockLength === 64) { compress(block, 0); blockLength = 0; }
            }
            for (; offset + 64 <= bytes.length; offset += 64) compress(bytes, offset);
            if (offset < bytes.length) {
                block.set(bytes.subarray(offset), 0);
                blockLength = bytes.length - offset;
            }
            return this;
        },
        digestHex() {
            if (finished) throw new Error('הטביעה כבר הושלמה.');
            finished = true;
            const bitLength = totalBytes * 8;
            const tail = new Uint8Array(blockLength + 1 > 56 ? 128 : 64);
            tail.set(block.subarray(0, blockLength), 0);
            tail[blockLength] = 0x80;
            const view = new DataView(tail.buffer);
            view.setUint32(tail.length - 8, Math.floor(bitLength / 0x100000000));
            view.setUint32(tail.length - 4, bitLength >>> 0);
            for (let offset = 0; offset < tail.length; offset += 64) compress(tail, offset);
            const out = new Uint8Array(32);
            const outView = new DataView(out.buffer);
            for (let index = 0; index < 8; index += 1) outView.setUint32(index * 4, state[index]);
            return toHex(out);
        }
    };
}

async function readSlice(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// SHA-256 מלא של קובץ. onProgress(0..1) מדווח על קובץ גדול; signal מבטל.
export async function sha256OfBlob(blob, { subtle = globalThis.crypto?.subtle, onProgress, signal, chunkBytes = HASH_CHUNK_BYTES } = {}) {
    if (!blob || typeof blob.slice !== 'function') return '';
    if (subtle && blob.size <= FULL_HASH_SUBTLE_MAX_BYTES) {
        return toHex(new Uint8Array(await subtle.digest('SHA-256', await blob.arrayBuffer())));
    }
    const hash = createSha256();
    for (let start = 0; start < blob.size; start += chunkBytes) {
        if (signal?.aborted) throw Object.assign(new Error('החישוב בוטל.'), { name: 'AbortError' });
        hash.update(await readSlice(blob, start, Math.min(blob.size, start + chunkBytes)));
        onProgress?.(Math.min(1, (start + chunkBytes) / blob.size));
        // נותן לדף לנשום בין חלקים, כדי שהממשק לא ייתקע בטלפון.
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return hash.digestHex();
}

// הטביעה הישנה מדגימות (גודל + 1MB מההתחלה, מהאמצע ומהסוף), בדיוק כפי
// שהדפדפן חישב אותה עד עכשיו לקובץ מעל 64MB — רק לבדיקת כפילויות מול רשומות ישנות.
export async function legacySampleHash(blob, { subtle = globalThis.crypto?.subtle } = {}) {
    if (!blob || blob.size <= FULL_HASH_SUBTLE_MAX_BYTES || !subtle) return '';
    const middle = Math.floor(blob.size / 2);
    const samples = await new Blob([
        String(blob.size),
        blob.slice(0, LEGACY_SAMPLE_BYTES),
        blob.slice(middle, middle + LEGACY_SAMPLE_BYTES),
        blob.slice(blob.size - LEGACY_SAMPLE_BYTES)
    ]).arrayBuffer();
    return `s1:${toHex(new Uint8Array(await subtle.digest('SHA-256', samples)))}`;
}

// מה שתור ההעלאה צריך: contentHash לרשומה, וכל הטביעות לבדיקת הכפילויות.
export async function fingerprintForUpload(blob, options = {}) {
    const contentHash = await sha256OfBlob(blob, options);
    const legacyHash = await legacySampleHash(blob, options);
    return { contentHash, legacyHash, lookup: [contentHash, legacyHash].filter(Boolean) };
}
