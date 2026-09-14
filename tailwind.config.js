/** @type {import("tailwindcss").Config} */
// כל גוון ניטרלי או מודגש מצביע על משתנה CSS שמוגדר ב-styles.css, ולא על
// ערך קבוע. `bg-white/5`, `text-slate-400` או `border-amber-400/20` מקבלים
// בזכות זה ערך מתאים בכל אחד משני מצבי התצוגה — בלי שכבת דריסות של
// !important, שהייתה מקור הסתירות בין המצב הבהיר לעיצוב הרגיל.
//
// הסולם במצב הבהיר הוא הסולם הכהה בסדר הפוך: 950 הופך ל-50, 400 ל-600 וכן
// הלאה. כך כל צמד של רקע כהה וטקסט בהיר הופך מאליו לרקע בהיר וטקסט כהה,
// והניגודיות נשמרת בכל רכיב — גם ברכיבים שנבנים כמחרוזת ב-JS.
//
// הסריקה כוללת את קובצי ה-JS, משום שחלק ניכר מה-HTML נבנה שם.
module.exports = {
  content: ["./index.html", "./admin.html", "./admin-messages.html", "./app.js", "./session-ui.js", "./gallery.js", "./admin.js", "./admin-ui.js", "./admin-app.js", "./popup-announcement.js", "./popup-admin.js", "./chat.js", "./chat-admin.js", "./session-auth.js", "./drive-sync.js", "./face-search.js", "./face-index.js"],
  theme: {
    extend: {
      colors: {
        "white": "rgb(var(--p-white) / <alpha-value>)",
        "black": "rgb(var(--p-black) / <alpha-value>)",
        "slate": {
              "50": "rgb(var(--p-slate-50) / <alpha-value>)",
              "100": "rgb(var(--p-slate-100) / <alpha-value>)",
              "200": "rgb(var(--p-slate-200) / <alpha-value>)",
              "300": "rgb(var(--p-slate-300) / <alpha-value>)",
              "400": "rgb(var(--p-slate-400) / <alpha-value>)",
              "500": "rgb(var(--p-slate-500) / <alpha-value>)",
              "600": "rgb(var(--p-slate-600) / <alpha-value>)",
              "700": "rgb(var(--p-slate-700) / <alpha-value>)",
              "800": "rgb(var(--p-slate-800) / <alpha-value>)",
              "900": "rgb(var(--p-slate-900) / <alpha-value>)",
              "950": "rgb(var(--p-slate-950) / <alpha-value>)"
        },
        "amber": {
              "50": "rgb(var(--p-amber-50) / <alpha-value>)",
              "100": "rgb(var(--p-amber-100) / <alpha-value>)",
              "200": "rgb(var(--p-amber-200) / <alpha-value>)",
              "300": "rgb(var(--p-amber-300) / <alpha-value>)",
              "400": "rgb(var(--p-amber-400) / <alpha-value>)",
              "500": "rgb(var(--p-amber-500) / <alpha-value>)",
              "600": "rgb(var(--p-amber-600) / <alpha-value>)",
              "700": "rgb(var(--p-amber-700) / <alpha-value>)",
              "800": "rgb(var(--p-amber-800) / <alpha-value>)",
              "900": "rgb(var(--p-amber-900) / <alpha-value>)",
              "950": "rgb(var(--p-amber-950) / <alpha-value>)"
        },
        "red": {
              "50": "rgb(var(--p-red-50) / <alpha-value>)",
              "100": "rgb(var(--p-red-100) / <alpha-value>)",
              "200": "rgb(var(--p-red-200) / <alpha-value>)",
              "300": "rgb(var(--p-red-300) / <alpha-value>)",
              "400": "rgb(var(--p-red-400) / <alpha-value>)",
              "500": "rgb(var(--p-red-500) / <alpha-value>)",
              "600": "rgb(var(--p-red-600) / <alpha-value>)",
              "700": "rgb(var(--p-red-700) / <alpha-value>)",
              "800": "rgb(var(--p-red-800) / <alpha-value>)",
              "900": "rgb(var(--p-red-900) / <alpha-value>)",
              "950": "rgb(var(--p-red-950) / <alpha-value>)"
        },
        "cyan": {
              "50": "rgb(var(--p-cyan-50) / <alpha-value>)",
              "100": "rgb(var(--p-cyan-100) / <alpha-value>)",
              "200": "rgb(var(--p-cyan-200) / <alpha-value>)",
              "300": "rgb(var(--p-cyan-300) / <alpha-value>)",
              "400": "rgb(var(--p-cyan-400) / <alpha-value>)",
              "500": "rgb(var(--p-cyan-500) / <alpha-value>)",
              "600": "rgb(var(--p-cyan-600) / <alpha-value>)",
              "700": "rgb(var(--p-cyan-700) / <alpha-value>)",
              "800": "rgb(var(--p-cyan-800) / <alpha-value>)",
              "900": "rgb(var(--p-cyan-900) / <alpha-value>)",
              "950": "rgb(var(--p-cyan-950) / <alpha-value>)"
        },
        "emerald": {
              "50": "rgb(var(--p-emerald-50) / <alpha-value>)",
              "100": "rgb(var(--p-emerald-100) / <alpha-value>)",
              "200": "rgb(var(--p-emerald-200) / <alpha-value>)",
              "300": "rgb(var(--p-emerald-300) / <alpha-value>)",
              "400": "rgb(var(--p-emerald-400) / <alpha-value>)",
              "500": "rgb(var(--p-emerald-500) / <alpha-value>)",
              "600": "rgb(var(--p-emerald-600) / <alpha-value>)",
              "700": "rgb(var(--p-emerald-700) / <alpha-value>)",
              "800": "rgb(var(--p-emerald-800) / <alpha-value>)",
              "900": "rgb(var(--p-emerald-900) / <alpha-value>)",
              "950": "rgb(var(--p-emerald-950) / <alpha-value>)"
        },
        "purple": {
              "50": "rgb(var(--p-purple-50) / <alpha-value>)",
              "100": "rgb(var(--p-purple-100) / <alpha-value>)",
              "200": "rgb(var(--p-purple-200) / <alpha-value>)",
              "300": "rgb(var(--p-purple-300) / <alpha-value>)",
              "400": "rgb(var(--p-purple-400) / <alpha-value>)",
              "500": "rgb(var(--p-purple-500) / <alpha-value>)",
              "600": "rgb(var(--p-purple-600) / <alpha-value>)",
              "700": "rgb(var(--p-purple-700) / <alpha-value>)",
              "800": "rgb(var(--p-purple-800) / <alpha-value>)",
              "900": "rgb(var(--p-purple-900) / <alpha-value>)",
              "950": "rgb(var(--p-purple-950) / <alpha-value>)"
        },
        "orange": {
              "50": "rgb(var(--p-orange-50) / <alpha-value>)",
              "100": "rgb(var(--p-orange-100) / <alpha-value>)",
              "200": "rgb(var(--p-orange-200) / <alpha-value>)",
              "300": "rgb(var(--p-orange-300) / <alpha-value>)",
              "400": "rgb(var(--p-orange-400) / <alpha-value>)",
              "500": "rgb(var(--p-orange-500) / <alpha-value>)",
              "600": "rgb(var(--p-orange-600) / <alpha-value>)",
              "700": "rgb(var(--p-orange-700) / <alpha-value>)",
              "800": "rgb(var(--p-orange-800) / <alpha-value>)",
              "900": "rgb(var(--p-orange-900) / <alpha-value>)",
              "950": "rgb(var(--p-orange-950) / <alpha-value>)"
        },
        "blue": {
              "50": "rgb(var(--p-blue-50) / <alpha-value>)",
              "100": "rgb(var(--p-blue-100) / <alpha-value>)",
              "200": "rgb(var(--p-blue-200) / <alpha-value>)",
              "300": "rgb(var(--p-blue-300) / <alpha-value>)",
              "400": "rgb(var(--p-blue-400) / <alpha-value>)",
              "500": "rgb(var(--p-blue-500) / <alpha-value>)",
              "600": "rgb(var(--p-blue-600) / <alpha-value>)",
              "700": "rgb(var(--p-blue-700) / <alpha-value>)",
              "800": "rgb(var(--p-blue-800) / <alpha-value>)",
              "900": "rgb(var(--p-blue-900) / <alpha-value>)",
              "950": "rgb(var(--p-blue-950) / <alpha-value>)"
        }
  },
      fontFamily: {
        sans: ["Assistant", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
};
