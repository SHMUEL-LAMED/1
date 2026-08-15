/** @type {import('tailwindcss').Config} */
// התצורה מכוונת להיות זהה לברירת המחדל של Play CDN שהוחלף, כדי שהמראה
// יישאר כפי שהיה. אין כאן theme מותאם: העיצוב המותאם כולו יושב ב-styles.css.
// הסריקה כוללת גם את קובצי ה-JS, משום שחלק ניכר מה-HTML נבנה שם כמחרוזות.
module.exports = {
  content: ["./index.html", "./admin-messages.html", "./app.js", "./gallery.js", "./admin.js", "./chat.js", "./drive-sync.js", "./face-search.js", "./face-index.js"],
  theme: { extend: {} },
  plugins: []
};
