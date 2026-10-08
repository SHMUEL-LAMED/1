// הגדרות Vite: בניית ייצור מוקטנת ומגובבת לשני הדפים (ראו site-build.mjs).
// base יחסי: אותו תוצר עובד גם תחת /1/ ב-GitHub Pages וגם בשורש של שרת
// הבדיקות, בלי לקבע את שם המאגר בקוד.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { siteBuildPlugin } from './site-build.mjs';

const page = name => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
    base: './',
    // אין תיקיית public: הקבצים הסטטיים מועתקים בתוסף, מתוך שורש המאגר.
    publicDir: false,
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
            input: {
                index: page('index.html'),
                admin: page('admin.html')
            }
        }
    },
    plugins: [siteBuildPlugin()]
});
