// ההיגיון הטהור של "אנשים בגלריה" (people-model.js), והחיבור שלו לאתר:
// נתיבי ה-hash, חיתוך הפרצוף, תמונת הפרופיל של Google, נרמול התשובות,
// ההבטחות שבהסבר הפרטיות, הרישום של המודול העצל ומעטפת ה-Service Worker.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIND_ME_PRIVACY_NOTE,
  boxFromDetection,
  faceCountLabel,
  faceCropStyle,
  filterPeople,
  imageCountLabel,
  largerGooglePhotoUrl,
  normalizeNameForSearch,
  normalizePersonsResponse,
  orderRecordsByIds,
  parsePeopleRoute,
  personHash
} from "./people-model.js";

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const percent = value => Number(String(value).replace("%", ""));

test("נתיבי ה-hash: רשימת האנשים, אלבום של אדם, וכל השאר נדחה", () => {
  assert.deepEqual(parsePeopleRoute("#people"), { view: "directory" });
  assert.deepEqual(parsePeopleRoute("#person/fp_abc-123"), { view: "person", personId: "fp_abc-123" });
  for (const hash of ["", "#", "#person/", "#person/a b", "#person/../x", "#person/%E0%A4%A", `#person/${"a".repeat(65)}`, "#folder-1", "#peoples"]) {
    assert.equal(parsePeopleRoute(hash), null, hash);
  }
  assert.equal(personHash("fp_1"), "#person/fp_1");
  assert.equal(personHash("<script>"), "");
});

test("חיתוך הפרצוף: הריבוע סביב הפנים ממלא את המסגרת ואינו חורג מהתמונה", () => {
  // תמונה רוחבית 3:2, פרצוף במרכז.
  const style = faceCropStyle({ x: 0.45, y: 0.4, w: 0.1, h: 0.15, a: 1.5 });
  const width = percent(style.width);
  const height = percent(style.height);
  const left = percent(style.left);
  const top = percent(style.top);
  // הריבוע: צלע = 1.6 × max(0.1×1.5, 0.15) = 0.24 גובה = 0.16 רוחב.
  assert.ok(Math.abs(width - 100 / 0.16) < 0.01);
  assert.ok(Math.abs(height - 100 / 0.24) < 0.01);
  // מרכז הפרצוף (0.5, 0.475) נמצא במרכז המסגרת.
  const centerX = (0.5 * width + left) / 100;
  const centerY = (0.475 * height + top) / 100;
  assert.ok(Math.abs(centerX - 0.5) < 0.001);
  assert.ok(Math.abs(centerY - 0.5) < 0.001);
  // היחס בין הרוחב לגובה המוצגים שומר על היחס המקורי של התמונה.
  assert.ok(Math.abs((width / height) - 1.5) < 0.001);

  // פרצוף בפינה: החיתוך נצמד לקצה ואינו יוצא מהתמונה.
  const corner = faceCropStyle({ x: 0, y: 0, w: 0.1, h: 0.1, a: 1 });
  assert.equal(percent(corner.left), 0);
  assert.equal(percent(corner.top), 0);
  // פרצוף שממלא כמעט את כל התמונה: הריבוע מוקטן לגבולות התמונה.
  const huge = faceCropStyle({ x: 0.05, y: 0.05, w: 0.9, h: 0.9, a: 1 });
  assert.equal(percent(huge.width), 100);
  assert.equal(percent(huge.left), 0);

  for (const box of [null, {}, { x: 0, y: 0, w: 0, h: 0.1, a: 1 }, { x: 0.95, y: 0, w: 0.2, h: 0.1, a: 1 }, { x: "a", y: 0, w: 0.1, h: 0.1, a: 1 }]) {
    assert.equal(faceCropStyle(box), null);
  }
});

test("מיקום מתוך תוצאת הזיהוי: יחסי, בגבולות התמונה, עם יחס הממדים", () => {
  assert.deepEqual(boxFromDetection({ x: 300, y: 100, width: 150, height: 200 }, 1500, 1000), { x: 0.2, y: 0.1, w: 0.1, h: 0.2, a: 1.5 });
  assert.deepEqual(boxFromDetection({ x: -20, y: 950, width: 100, height: 100 }, 1000, 1000), { x: 0, y: 0.95, w: 0.1, h: 0.05, a: 1 });
  assert.equal(boxFromDetection(null, 100, 100), null);
  assert.equal(boxFromDetection({ x: 0, y: 0, width: 10, height: 10 }, 0, 100), null);
});

test("תמונת הפרופיל של Google מוגדלת לזיהוי, וכתובת לא מאובטחת נדחית", () => {
  assert.equal(largerGooglePhotoUrl("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c"), "https://lh3.googleusercontent.com/a/ACg8ocK=s512-c");
  assert.equal(largerGooglePhotoUrl("https://lh3.googleusercontent.com/a-/AOh14Gi/s96-c/photo.jpg"), "https://lh3.googleusercontent.com/a-/AOh14Gi/s512-c/photo.jpg");
  assert.equal(largerGooglePhotoUrl("https://lh3.googleusercontent.com/a/ACg8ocK"), "https://lh3.googleusercontent.com/a/ACg8ocK=s512-c");
  assert.equal(largerGooglePhotoUrl("https://media.example/me.jpg"), "https://media.example/me.jpg");
  assert.equal(largerGooglePhotoUrl("http://lh3.googleusercontent.com/a/x=s96-c"), "");
  assert.equal(largerGooglePhotoUrl("javascript:alert(1)"), "");
  assert.equal(largerGooglePhotoUrl(""), "");
});

test("נרמול רשימת האנשים: רק רשומות תקינות עם שם, ממוינות לפי שם, וכתובות https בלבד", () => {
  const people = normalizePersonsResponse({
    persons: [
      { personId: "p2", name: "שמעון", imageCount: 3, cover: { imageId: "a", url: "https://m.example/a.webp", box: { x: 0, y: 0, w: 1, h: 1, a: 1 } } },
      { personId: "p1", name: "אברהם", imageCount: "2", cover: { imageId: "b", url: "javascript:alert(1)" } },
      { personId: "bad id", name: "x" },
      { personId: "p3", name: "  " },
      { personId: "p4", name: "בנימין", faceCount: -4 }
    ]
  }, value => String(value));
  assert.deepEqual(people.map(person => person.name), ["אברהם", "בנימין", "שמעון"]);
  assert.equal(people[0].cover, null, "כתובת שאינה https אינה מוצגת");
  assert.equal(people[0].imageCount, 2);
  assert.equal(people[1].faceCount, 0);
  assert.equal(people[2].cover.url, "https://m.example/a.webp");
  assert.deepEqual(normalizePersonsResponse(null), []);
});

test("חיפוש שם: בלי ניקוד, גרשיים ואותיות סופיות", () => {
  const people = [{ personId: "1", name: "ר׳ שִׁמְעוֹן" }, { personId: "2", name: "נחום" }, { personId: "3", name: "Moshe" }];
  assert.equal(normalizeNameForSearch("שִׁמְעוֹן"), "שמעונ");
  assert.deepEqual(filterPeople(people, "שמעו").map(person => person.personId), ["1"]);
  assert.deepEqual(filterPeople(people, "ר שמעון").map(person => person.personId), ["1"]);
  assert.deepEqual(filterPeople(people, "נחומ").map(person => person.personId), ["2"]);
  assert.deepEqual(filterPeople(people, "moshe").map(person => person.personId), ["3"]);
  assert.equal(filterPeople(people, "").length, 3);
});

test("תוויות בעברית וסדר הרשומות לפי השרת", () => {
  assert.equal(imageCountLabel(0), "אין תמונות");
  assert.equal(imageCountLabel(1), "תמונה אחת");
  assert.equal(imageCountLabel(7), "7 תמונות");
  assert.equal(faceCountLabel(1), "פרצוף אחד");
  assert.equal(faceCountLabel(3), "3 פרצופים");
  const records = [{ id: "b" }, { id: "a" }, { id: "c" }];
  assert.deepEqual(orderRecordsByIds(["c", "x", "a"], records).map(record => record.id), ["c", "a"]);
});

test("הסבר הפרטיות בחלון זהה לטקסט שבקוד, ומבטיח בדיוק את מה שהקוד עושה", () => {
  const html = read("index.html");
  const note = /<p id="findMePrivacyNote"[^>]*>([^<]+)<\/p>/.exec(html)?.[1];
  assert.equal(note, FIND_ME_PRIVACY_NOTE);
  assert.match(FIND_ME_PRIVACY_NOTE, /רק טביעה מספרית/);
  assert.match(FIND_ME_PRIVACY_NOTE, /אינה נשמרת, אלא אם סימנת „זכור אותי”/);
  assert.match(FIND_ME_PRIVACY_NOTE, /„שכח אותי”/);
  assert.match(FIND_ME_PRIVACY_NOTE, /ואינו מועלה/);
  // "זכור אותי" כבוי כברירת מחדל.
  assert.match(html, /<input type="checkbox" id="findMeRemember">/);
});

test("people.js נטען עצלה, וכל נקודת כניסה שלו רשומה במעטפת", () => {
  const appJs = read("app.js");
  const peopleJs = read("people.js");
  const start = appJs.indexOf("const ensurePeopleModule = defineLazyModule(");
  assert.ok(start > -1);
  const registered = [...appJs.slice(start, appJs.indexOf("]);", start)).matchAll(/'(\w+)'/g)].map(match => match[1]);
  const defined = [...peopleJs.matchAll(/^window\.(\w+)\s*=/gm)].map(match => match[1]);
  assert.deepEqual([...registered].sort(), [...defined].sort());
  // כל מטפל ב-HTML שפונה למודול רשום במעטפת.
  const html = read("index.html");
  for (const name of ["openPeopleDirectory", "openFindMe", "findMeFromProfile", "findMeFromSelfie", "findMeWithSaved", "forgetFindMe", "filterPeopleDirectory"]) {
    assert.ok(html.includes(`${name}(`), `${name} אינו מופעל מה-HTML`);
    assert.ok(registered.includes(name), `${name} חסר ברשימת המעטפת`);
  }
  // אין ייבוא סטטי של המודול: אורח שאינו לוחץ אינו מוריד אותו.
  assert.equal(/import\s+[^;]*['"]\.\/people\.js['"]/.test(appJs), false);
});

test("המודולים החדשים במעטפת ה-Service Worker ובבדיקת התחביר", () => {
  const sw = read("sw.js");
  assert.match(sw, /"\.\/people\.js"/);
  assert.match(sw, /"\.\/people-model\.js"/);
  const pkg = JSON.parse(read("package.json"));
  for (const file of ["people.js", "people-model.js", "face-people.js"]) {
    assert.ok(pkg.scripts["check:syntax"].includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
  }
});
