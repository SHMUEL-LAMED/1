/** @type {import('tailwindcss').Config} */
// התצורה מכוונת להיות זהה לברירת המחדל של Play CDN שהוחלף, כדי שהמראה
// יישאר כפי שהיה. אין כאן theme מותאם: העיצוב המותאם כולו יושב ב-styles.css.
// הסריקה כוללת גם את קובצי ה-JS, משום שחלק ניכר מה-HTML נבנה שם כמחרוזות.
module.exports = {
  content: ["./index.html", "./admin.html", "./admin-messages.html", "./app.js", "./session-ui.js", "./gallery.js", "./admin.js", "./admin-ui.js", "./admin-app.js", "./popup-announcement.js", "./popup-admin.js", "./chat.js", "./chat-admin.js", "./session-auth.js", "./drive-sync.js", "./face-search.js", "./face-index.js"],
  theme: { extend: {} },
  plugins: []
};
