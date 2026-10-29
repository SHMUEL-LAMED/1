// כתיבת ZIP: CRC32, שמות ייחודיים ומבנה הארכיון. הארכיון נפתח כאן בקורא
// מינימלי, וכשיש unzip במערכת — גם בכלי חיצוני אמיתי.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { crc32, dosDateTime, uniqueZipName, buildZipParts } from "./zip-writer.js";

const bytes = text => new TextEncoder().encode(text);
const concat = parts => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
};

test("CRC32 תואם לערכים הידועים", () => {
    assert.equal(crc32(bytes("")), 0);
    assert.equal(crc32(bytes("123456789")), 0xCBF43926);
    assert.equal(crc32(bytes("The quick brown fox jumps over the lazy dog")), 0x414FA339);
});

test("תאריך DOS: שנה מ־1980, חודש ויום, שניות בדיוק של שתיים", () => {
    const { date, time } = dosDateTime(new Date(2026, 9, 29, 13, 45, 31));
    assert.equal(date >> 9, 2026 - 1980);
    assert.equal((date >> 5) & 0x0F, 10);
    assert.equal(date & 0x1F, 29);
    assert.equal(time >> 11, 13);
    assert.equal((time >> 5) & 0x3F, 45);
    assert.equal(time & 0x1F, 15);
    assert.equal(dosDateTime(new Date(1970, 0, 1)).date >> 9, 0);
    assert.doesNotThrow(() => dosDateTime(new Date("לא תאריך")));
});

test("שמות ייחודיים: מספור לפני הסיומת, בלי תלות ברישיות, ותווים אסורים מוחלפים", () => {
    const used = new Set();
    assert.equal(uniqueZipName("תמונה.jpg", used), "תמונה.jpg");
    assert.equal(uniqueZipName("תמונה.jpg", used), "תמונה (2).jpg");
    assert.equal(uniqueZipName("תמונה.JPG", used), "תמונה (3).JPG");
    assert.equal(uniqueZipName("a/b:c.png", used), "a-b-c.png");
    assert.equal(uniqueZipName("", used), "קובץ");
    assert.equal(uniqueZipName("", used), "קובץ (2)");
});

test("מבנה הארכיון: כותרות, תוכן ושמות בעברית נקראים חזרה", () => {
    const files = [
        { name: "שמחת תורה.jpg", data: bytes("first file") },
        { name: "b.txt", data: bytes("second") }
    ];
    const zip = concat(buildZipParts(files));
    const view = new DataView(zip.buffer);
    const endOffset = zip.length - 22;
    assert.equal(view.getUint32(endOffset, true), 0x06054B50);
    assert.equal(view.getUint16(endOffset + 10, true), 2);

    let cursor = view.getUint32(endOffset + 16, true);
    const decoder = new TextDecoder();
    for (const file of files) {
        assert.equal(view.getUint32(cursor, true), 0x02014B50);
        assert.equal(view.getUint16(cursor + 8, true) & 0x0800, 0x0800, "דגל UTF-8");
        const nameLength = view.getUint16(cursor + 28, true);
        const localOffset = view.getUint32(cursor + 42, true);
        assert.equal(decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength)), file.name);
        assert.equal(view.getUint32(cursor + 16, true), crc32(file.data));

        assert.equal(view.getUint32(localOffset, true), 0x04034B50);
        const localName = view.getUint16(localOffset + 26, true);
        const start = localOffset + 30 + localName;
        assert.deepEqual(zip.subarray(start, start + file.data.length), file.data);
        cursor += 46 + nameLength;
    }
});

test("ארכיון ריק תקין, ויותר מ־65535 קבצים נדחה", () => {
    const empty = concat(buildZipParts([]));
    assert.equal(empty.length, 22);
    assert.throws(() => buildZipParts({ length: 70000 }), /יותר מדי קבצים/);
});

test("כלי unzip אמיתי פותח את הארכיון", { skip: (() => { try { execFileSync("unzip", ["-v"]); return false; } catch { return "unzip לא מותקן"; } })() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-writer-"));
    try {
        const path = join(dir, "test.zip");
        writeFileSync(path, concat(buildZipParts([{ name: "a.txt", data: bytes("hello zip") }])));
        execFileSync("unzip", ["-t", path]);
        execFileSync("unzip", ["-o", "-q", path, "-d", dir]);
        assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "hello zip");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
