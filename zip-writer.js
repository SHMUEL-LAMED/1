// zip-writer.js — כתיבת קובץ ZIP בדפדפן, בלי ספרייה חיצונית (בלי DOM, נבדק ב־Node).
// הקבצים נשמרים בלי דחיסה (STORE): תמונות וסרטונים כבר דחוסים, ודחיסה נוספת
// רק הייתה מאטה את הטלפון. שמות הקבצים ב־UTF-8 (דגל 11), כך שעברית נשמרת.
// הפלט הוא רשימת חלקים ל־Blob, כדי שהדפדפן יוכל להחזיק אותם בלי להעתיק לזיכרון אחד.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// תאריך ושעה בפורמט DOS (שעון מקומי, דיוק של שתי שניות, משנת 1980).
export function dosDateTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
}

// שם ייחודי בתוך הארכיון: "תמונה.jpg", "תמונה (2).jpg" וכן הלאה. ההשוואה
// אינה תלויה ברישיות, כי מערכות קבצים רבות אינן מבחינות בה.
export function uniqueZipName(name, used) {
    const clean = String(name || 'קובץ').replace(/[\\/:*?"<>|\r\n]+/g, '-').trim() || 'קובץ';
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let candidate = clean;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
}

// entries: [{ name, data: Uint8Array, date?: Date }] → מערך חלקים ל־new Blob(parts).
// ZIP רגיל (לא ZIP64) מוגבל ל־4GB ול־65535 קבצים; מעבר לכך נזרקת שגיאה ברורה.
export function buildZipParts(entries) {
    if (entries.length > 0xFFFF) throw new Error('יותר מדי קבצים לקובץ ZIP אחד.');
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const data = entry.data;
        const crc = crc32(data);
        const { time, date } = dosDateTime(entry.date);
        if (offset + 30 + nameBytes.length + data.length > 0xFFFFFFFF) {
            throw new Error('הקבצים שנבחרו גדולים מדי לקובץ ZIP אחד.');
        }

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), nameBytes, data);

        const header = new DataView(new ArrayBuffer(46));
        header.setUint32(0, 0x02014B50, true);
        header.setUint16(4, 20, true);
        header.setUint16(6, 20, true);
        header.setUint16(8, 0x0800, true);
        header.setUint16(10, 0, true);
        header.setUint16(12, time, true);
        header.setUint16(14, date, true);
        header.setUint32(16, crc, true);
        header.setUint32(20, data.length, true);
        header.setUint32(24, data.length, true);
        header.setUint16(28, nameBytes.length, true);
        header.setUint32(42, offset, true);
        central.push(new Uint8Array(header.buffer), nameBytes);

        offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return [...parts, ...central, new Uint8Array(end.buffer)];
}
