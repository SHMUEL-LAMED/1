// scripts/backup-to-sql.mjs — הופך גיבוי D1 יומי (backups/d1/YYYY-MM-DD.json.gz,
// ראו maintenanceBackup ב-worker/maintenance.js) לקובץ SQL לשחזור ידני.
//
//   node scripts/backup-to-sql.mjs simchas-gallery-d1-2026-10-30.json.gz > restore.sql
//
// אין כאן שחזור אוטומטי, בכוונה: הקובץ רק יוצר טבלאות שחסרות (IF NOT EXISTS)
// ומכניס את השורות ב-INSERT OR REPLACE — אינו מוחק שום טבלה או שורה. הדרך
// הבטוחה היא לשחזר למסד D1 חדש, לבדוק, ורק אז להחליף את החיבור (ראו
// "גיבוי D1 יומי ושחזור ידני" ב-README).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function readBackupFile(bytes) {
    const buffer = Buffer.from(bytes);
    const text = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
    const backup = JSON.parse(text);
    if (backup?.format !== 'simchas-gallery-d1-backup' || !Array.isArray(backup.tables)) throw new Error('הקובץ אינו גיבוי D1 של הגלריה.');
    return backup;
}

export function sqlLiteral(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('ערך מספרי לא תקין בגיבוי.');
        return String(value);
    }
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'object' && typeof value.$base64 === 'string') {
        return `X'${Buffer.from(value.$base64, 'base64').toString('hex')}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
}

function ifNotExists(sql, kind) {
    const pattern = kind === 'table'
        ? /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i
        : /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i;
    if (!pattern.test(sql)) throw new Error(`הגדרת ${kind} לא צפויה בגיבוי.`);
    return sql.replace(pattern, (_, unique = '') => kind === 'table' ? 'CREATE TABLE IF NOT EXISTS ' : `CREATE ${unique.toUpperCase()}INDEX IF NOT EXISTS `);
}

export function backupToSql(backup) {
    const lines = [`-- שחזור מגיבוי ${backup.createdAt || ''} (גרסת סכימה ${backup.schemaVersion ?? '?'})`];
    for (const table of backup.tables) {
        if (!IDENTIFIER.test(table.name) || !table.columns.every(column => IDENTIFIER.test(column))) throw new Error(`שם לא תקין בגיבוי: ${table.name}`);
        if (table.sql) lines.push(`${ifNotExists(table.sql, 'table')};`);
        const columns = table.columns.map(column => `"${column}"`).join(', ');
        for (const row of table.rows) {
            if (!Array.isArray(row) || row.length !== table.columns.length) throw new Error(`שורה לא תקינה בטבלה ${table.name}.`);
            lines.push(`INSERT OR REPLACE INTO "${table.name}" (${columns}) VALUES (${row.map(sqlLiteral).join(', ')});`);
        }
    }
    for (const index of backup.indexes || []) {
        if (index.sql) lines.push(`${ifNotExists(index.sql, 'index')};`);
    }
    return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const file = process.argv[2];
    if (!file) {
        console.error('שימוש: node scripts/backup-to-sql.mjs <קובץ-גיבוי.json.gz> > restore.sql');
        process.exitCode = 1;
    } else {
        process.stdout.write(backupToSql(readBackupFile(readFileSync(file))));
    }
}
