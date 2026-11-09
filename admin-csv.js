// admin-csv.js — הורדת קובץ CSV בדפדפן. עוזר משותף למסך המשתמשים
// (admin-users-view.js) ולמרכז הפעילות (admin-activity.js); אין כאן בקשה
// לשרת — הקובץ נבנה בדפדפן מהשורות שהתקבלו.

// ייצוא CSV שמנטרל נוסחאות (=, +, -, @) — שמות המשתמשים מגיעים מחשבונות Google.
import { csvText } from './admin-users-model.js';

export function downloadCsv(rows, filename) {
    // BOM כדי שאקסל יזהה עברית ב-UTF-8. תא שמתחיל בסימן של נוסחה נפתח בגרש (csvText).
    const csv = '﻿' + csvText(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(link.href);
    }, 100);
}
