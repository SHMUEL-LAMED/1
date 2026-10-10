// אנשים בגלריה: קיבוץ אוטומטי, תור "לבדיקה", שמות ואישור, רשימה ציבורית,
// אלבום לכל אדם ו"התמונות שלי". המסד הוא SQLite אמיתי בזיכרון, כך שכל
// שאילתה (json_each, UPDATE ... FROM, חלונות) רצה בפועל.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { decideFaceCluster } from "./cloudflare-worker.js";

const MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.bindings = []; }
  bind(...values) {
    this.bindings = values.map(value => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value));
    return this;
  }
  async first() { return this.database.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class D1 {
  constructor() { this.database = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const database = new D1();
const sql = database.database;
const environment = {
  GALLERY_DB: database,
  GALLERY_BUCKET: {
    async list() { return { objects: [] }; },
    async head() { return null; },
    async get() { return null; },
    async put() { return {}; },
    async delete() {}
  }
};

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" }
};

const originalFetch = globalThis.fetch;
test.before(async () => {
  delete globalThis.caches;
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const account = ACCOUNTS[new URL(href).searchParams.get("id_token")];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(request("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
});
test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  for (const table of ["face_people", "face_persons", "face_cluster_marks", "face_user_descriptors", "image_face_descriptors",
    "image_face_index_state", "gallery_documents", "request_rate_limits", "user_email_index"]) {
    sql.exec(`DELETE FROM ${table}`);
  }
  sql.exec("DELETE FROM gallery_schema_meta WHERE schema_key <> 'gallery'");
  for (const [uid, email, role, status] of [
    ["google-viewer", "viewer@example.com", "viewer", "approved"],
    ["google-admin", "admin@example.com", "admin", "approved"],
    ["google-super", "super@example.com", "super_admin", "approved"],
    ["google-pending", "pending@example.com", "viewer", "pending"]
  ]) putDocument("userProfiles", uid, { uid, email, role, status }, uid);
});

function putDocument(collection, id, data, owner = "google-admin") {
  sql.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), owner);
}

function request(path, method = "GET", body, token = "admin-token") {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(path, method = "GET", body, token = "admin-token", ctx) {
  const response = await worker.fetch(request(path, method, body, token), environment, ctx);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text, headers: response.headers };
}

// טביעה סינתטית: בסיס אחיד; כל "אדם" מוזז במימד משלו, ו-jitter במימד 100
// מבדיל בין תמונות שונות של אותו אדם.
function face(person, jitter = 0, extra = []) {
  const vector = new Array(128).fill(0.08);
  if (person !== null) vector[person] += 0.6;
  vector[100] += jitter;
  for (const [dimension, amount] of extra) vector[dimension] += amount;
  return vector.map(value => Math.round(value * 1e6) / 1e6);
}
const A = 1;
const B = 2;
const C = 3;

const BOX = { x: 0.25, y: 0.2, w: 0.3, h: 0.4, a: 1.5 };

async function index(imageId, faces, { extra = {}, boxes } = {}) {
  putDocument("images", imageId, {
    id: imageId,
    title: imageId,
    url: `https://media.example/${imageId}.jpg`,
    variants: { thumb: { url: `https://media.example/${imageId}-thumb.webp` } },
    ...extra
  });
  const result = await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId, faces, ...(boxes ? { boxes } : {}) }]
  });
  assert.equal(result.status, 200, result.text);
}

async function cluster(token = "admin-token") {
  const result = await call("/face/clusters/run", "POST", {}, token);
  assert.equal(result.status, 200, result.text);
  return result.payload;
}

async function groups(query = "view=suggested") {
  const result = await call(`/face/groups?${query}`);
  assert.equal(result.status, 200, result.text);
  return result.payload;
}

async function mutate(body) {
  return call("/face/groups", "POST", body);
}

function dataVersion() {
  return Number(sql.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'data_version:facePeople'").get()?.schema_version || 0);
}

function assertNoDescriptors(text) {
  assert.equal(/descriptor|centroid/i.test(text), false, `נמצאה טביעה בתשובה: ${text.slice(0, 200)}`);
  assert.equal(text.includes("0.68"), false, "רכיב של טביעה דלף לתשובה");
}

// שלוש תמונות של A, תמונה של B ותמונה של C — הבסיס לרוב הבדיקות.
async function seedThreePeople() {
  await index("a1", [face(A, 0)], { boxes: [BOX], extra: { takenAt: Date.UTC(2025, 0, 1) } });
  await index("a2", [face(A, 0.1)], { extra: { takenAt: Date.UTC(2025, 5, 1) } });
  await index("a3", [face(A, 0.2), face(B, 0)], { extra: { takenAt: Date.UTC(2024, 0, 1) } });
  await index("b1", [face(B, 0.1)]);
  await index("c1", [face(C, 0)]);
}

// --- ההחלטה עבור פרצוף בודד ---

test("decideFaceCluster: שיוך, זוג חדש, בדיקה ובודד — ואותה תוצאה בכל הרצה", () => {
  const toArray = vector => Float64Array.from(vector);
  const persons = [{ id: "pa", centroid: toArray(face(A, 0)) }, { id: "pb", centroid: toArray(face(B, 0)) }];
  const seeds = [{ descriptor: toArray(face(C, 0)) }];

  const join = decideFaceCluster(toArray(face(A, 0.2)), persons, seeds);
  assert.equal(join.action, "join");
  assert.equal(join.person, 0);
  assert.ok(Math.abs(join.distance - 0.2) < 1e-9);

  const pair = decideFaceCluster(toArray(face(C, 0.15)), persons, seeds);
  assert.deepEqual([pair.action, pair.seed], ["pair", 0]);

  // בדיוק באמצע בין A ל-B: שניהם מתחת לסף, אבל בלי פער — לבדיקה.
  const between = decideFaceCluster(toArray(face(null, 0, [[A, 0.3], [B, 0.3]])), persons, seeds);
  assert.equal(between.action, "review");
  assert.ok(between.margin < 0.05);

  // קרוב ל-A אך מעל סף השיוך (0.54): לבדיקה, לא שיוך.
  const near = decideFaceCluster(toArray(face(A, 0, [[4, 0.54]])), persons, seeds);
  assert.equal(near.action, "review");
  assert.equal(near.person, 0);

  const stranger = decideFaceCluster(toArray(face(5, 0)), persons, seeds);
  assert.equal(stranger.action, "seed");

  // דטרמיניסטי: אותו קלט, אותה החלטה.
  for (let run = 0; run < 3; run += 1) {
    assert.deepEqual(decideFaceCluster(toArray(face(null, 0, [[A, 0.3], [B, 0.3]])), persons, seeds), between);
  }
});

test("decideFaceCluster: אדם קרוב מתחת לסף לעולם אינו מוליד קבוצה כפולה עם פרצוף בודד קרוב יותר", () => {
  const toArray = vector => Float64Array.from(vector);
  // מרכז האדם ב-0.1667 ופרצוף בודד של אותו אדם ב-0.52: הפרצוף החדש (0.6)
  // קרוב לבודד (0.08) יותר מלאדם (0.433), אבל גם האדם מתחת לסף — והבודד
  // עצמו שייך לאדם (0.353). הפרצוף מצטרף לאדם, ולא נפתחת קבוצה שנייה.
  const persons = [{ id: "pa", centroid: toArray(face(A, 0.1667)) }];
  const sameSeed = [{ descriptor: toArray(face(A, 0.52)) }];
  const joined = decideFaceCluster(toArray(face(A, 0.6)), persons, sameSeed);
  assert.deepEqual([joined.action, joined.person], ["join", 0]);

  // בודד רחוק מהאדם (0.9): הפרצוף "בין" האדם לבודד — לבדיקה, לא קבוצה חדשה.
  const farSeed = [{ descriptor: toArray(face(A, 0.9)) }];
  const between = decideFaceCluster(toArray(face(A, 0.48)), [{ id: "pa", centroid: toArray(face(A, 0)) }], farSeed);
  assert.deepEqual([between.action, between.person], ["review", 0]);

  // בלי אדם מתחת לסף, זוג חדש עם הבודד נשאר כמו קודם.
  const pair = decideFaceCluster(toArray(face(A, 0.85)), [{ id: "pa", centroid: toArray(face(A, 0)) }], farSeed);
  assert.deepEqual([pair.action, pair.seed], ["pair", 0]);
});

// --- הקיבוץ האוטומטי ---

test("הקיבוץ מאחד פרצופים דומים לקבוצה מוצעת, משאיר זרים בודדים, ואינו חוזר על עצמו", async () => {
  await seedThreePeople();
  const versionBefore = dataVersion();
  const run = await cluster();
  assert.equal(run.processed, 6);
  assert.equal(run.remaining, 0);
  assert.equal(run.created, 2, "שתי קבוצות: A ו-B");
  assert.ok(dataVersion() > versionBefore, "שינוי שיוכים מקדם את גרסת הנתונים");

  const suggested = await groups();
  assertNoDescriptors(JSON.stringify(suggested));
  assert.equal(suggested.counts.suggested, 2);
  assert.equal(suggested.counts.unclustered, 0);
  const [first, second] = suggested.persons;
  assert.equal(first.faceCount, 3, "A — שלוש תמונות");
  assert.equal(first.imageCount, 3);
  assert.equal(first.status, "suggested");
  assert.equal(second.faceCount, 2, "B — שתי תמונות");
  assert.ok(first.samples.length >= 1 && first.samples.length <= 6);
  // הפרצוף עם מיקום ידוע מועדף כתמונה הראשית, והכתובת היא של התצוגה הקטנה.
  assert.deepEqual(first.cover.box, BOX);
  assert.equal(first.cover.url, "https://media.example/a1-thumb.webp");

  const marks = sql.prepare("SELECT mark, COUNT(*) AS n FROM face_cluster_marks GROUP BY mark").all();
  assert.deepEqual(marks.map(row => [row.mark, row.n]), [["seed", 1]], "רק C נשאר בודד");

  const again = await cluster();
  assert.equal(again.processed, 0);
  assert.equal((await groups()).persons.length, 2);
});

test("פרצוף בודד מצטרף לאדם שנוצר אחריו, והאלבום מקבל גם אותו", async () => {
  // a2 רחוק 0.52 מ-a1 (מעל הסף), ולכן שניהם נשמרים כבודדים.
  await index("a1", [face(A, 0)]);
  await index("a2", [face(A, 0.52)]);
  const first = await cluster();
  assert.equal(first.seeded, 2);
  // a3 יוצר עם a1 אדם, a4 מצטרף אליו, והמרכז (0.1667) רחוק מ-a2 רק 0.353.
  await index("a3", [face(A, 0.2)]);
  await index("a4", [face(A, 0.3)]);
  const second = await cluster();
  assert.equal(second.created, 1);
  assert.equal(second.absorbed, 1, "הבודד a2 נבדק שוב מול האדם החדש");

  const { persons } = await groups();
  assert.equal(persons.length, 1);
  assert.equal(persons[0].faceCount, 4);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_cluster_marks").get().n, 0, "לא נשאר בודד");
  await mutate({ action: "approve", personId: persons[0].personId, name: "יעקב" });
  const album = await call(`/face/persons/${persons[0].personId}`, "GET", undefined, "viewer-token");
  assert.deepEqual([...album.payload.imageIds].sort(), ["a1", "a2", "a3", "a4"]);

  // תמונה חדשה ליד a2 מצטרפת לאותו אדם — לא נפתחת קבוצה כפולה.
  await index("a5", [face(A, 0.6)]);
  const third = await cluster();
  assert.equal(third.joined, 1);
  assert.equal(third.created, 0);
  assert.equal((await groups("view=approved")).persons[0].faceCount, 5);
  assert.equal((await cluster()).processed, 0);
});

test("בודד שנשאר מלפני העדכון מצטרף בריצה הבאה, ובודד שהמנהל דחה אינו מצורף מעצמו", async () => {
  await seedThreePeople();
  await cluster();
  const [personA, personB] = (await groups()).persons;
  // מצב של גלריה שקובצה לפני התיקון: פרצוף של A נשאר "בודד" למרות שהוא
  // קרוב למרכז. אין עדיין סימון של בדיקה חוזרת, כמו בפריסה הראשונה.
  await index("s1", [face(A, 0.15)]);
  const [row] = sql.prepare("SELECT updated_at, descriptor_json FROM image_face_descriptors WHERE image_id = 's1'").all();
  sql.prepare(`INSERT INTO face_cluster_marks (image_id, face_index, model_version, descriptor_json, mark, created_at)
    VALUES ('s1', 0, ?, ?, 'seed', 1)`).run(MODEL_VERSION, row.descriptor_json);
  sql.exec("DELETE FROM gallery_schema_meta WHERE schema_key = 'face_cluster_sweep'");
  // פתיחת המסך יודעת שיש בודדים לבדוק שוב, גם בלי פרצופים חדשים.
  const before = await groups();
  assert.equal(before.counts.unclustered, 0);
  assert.equal(before.counts.recheck, true);
  const healed = await cluster();
  assert.equal(healed.processed, 0);
  assert.equal(healed.absorbed, 1);
  assert.equal(sql.prepare("SELECT person_id FROM face_people WHERE image_id = 's1'").get().person_id, personA.personId);

  // פרצוף בין A ל-B נכנס לבדיקה; המנהל עונה "לא — אדם אחר".
  await index("x1", [face(null, 0, [[A, 0.3], [B, 0.3]])]);
  await cluster();
  const [x] = (await groups("view=review")).faces;
  const rejectedId = x.candidate.personId;
  const other = rejectedId === personA.personId ? personB : personA;
  assert.equal((await mutate({ action: "reject", face: x })).status, 200);
  assert.equal(sql.prepare("SELECT candidate_person_id AS c FROM face_cluster_marks WHERE image_id = 'x1'").get().c, rejectedId);
  // האדם השני נעלם (המנהל הסיר את פרצופיו), ועכשיו x1 קרוב רק לאדם שנדחה —
  // ובכל זאת אינו מצורף אליו, כי המנהל כבר אמר שזה לא הוא. גם בבדיקה מלאה.
  for (const member of (await groups(`person=${other.personId}`)).faces) {
    assert.equal((await mutate({ action: "remove", face: member })).status, 200);
  }
  sql.exec("DELETE FROM gallery_schema_meta WHERE schema_key = 'face_cluster_sweep'");
  const after = await cluster();
  assert.equal(after.absorbed, 0);
  assert.equal(sql.prepare("SELECT mark FROM face_cluster_marks WHERE image_id = 'x1'").get().mark, "seed");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_people WHERE image_id = 'x1'").get().n, 0);
});

function orphanAssignments() {
  return sql.prepare(
    "SELECT COUNT(*) AS n FROM face_people p WHERE NOT EXISTS (SELECT 1 FROM face_persons fp WHERE fp.person_id = p.person_id)"
  ).get().n;
}

test("מיזוג שמתבצע באמצע ריצת קיבוץ אינו משאיר פרצוף משויך לאדם שנמחק", async () => {
  await seedThreePeople();
  await cluster();
  const [personA, personB] = (await groups()).persons;
  await index("a4", [face(A, 0.05)]);

  // המנהל ממזג את A לתוך B בדיוק בין הקריאות של הריצה לבין הכתיבה שלה.
  let merged = null;
  database.batch = async function (statements) {
    if (statements.some(statement => statement.sql.includes("'auto'"))) {
      delete database.batch;
      merged = await mutate({ action: "merge", targetId: personB.personId, sourceId: personA.personId });
    }
    return D1.prototype.batch.call(this, statements);
  };
  let run;
  try {
    run = await cluster();
  } finally {
    delete database.batch;
  }
  assert.equal(merged?.status, 200, merged?.text);
  assert.equal(run.joined, 1, "ההחלטה התקבלה מול A, שעוד היה קיים");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_persons WHERE person_id = ?").get(personA.personId).n, 0);
  assert.equal(orphanAssignments(), 0, "אין שיוך לאדם שנמחק");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_people WHERE image_id = 'a4'").get().n, 0);

  // הפרצוף חוזר לתור, והריצה הבאה משייכת אותו לקבוצה שקיימת עכשיו.
  assert.equal((await groups()).counts.unclustered, 1);
  const next = await cluster();
  assert.equal(next.processed, 1);
  assert.equal(sql.prepare("SELECT person_id FROM face_people WHERE image_id = 'a4'").get()?.person_id, personB.personId);
  assert.equal((await groups()).persons.find(person => person.personId === personB.personId).faceCount, 6);
});

test("שיוך לקבוצה שאין לה רשומה חוזר כקבוצה מוצעת במקום להיעלם", async () => {
  await seedThreePeople();
  await cluster();
  // מצב שנשאר מגרסה קודמת של הריצה: c1 משויך למזהה שאין לו רשומת אדם.
  sql.exec("DELETE FROM face_cluster_marks WHERE image_id = 'c1'");
  sql.prepare(`INSERT INTO face_people (image_id, face_index, model_version, descriptor_json, person_id, source, assigned_at)
    SELECT image_id, face_index, model_version, descriptor_json, 'fp_orphan', 'auto', 1
    FROM image_face_descriptors WHERE image_id = 'c1'`).run();
  assert.equal(orphanAssignments(), 1);

  const suggested = await groups();
  assert.equal(orphanAssignments(), 0);
  const orphan = suggested.persons.find(person => person.personId === "fp_orphan");
  assert.equal(orphan?.faceCount, 1);
  assert.equal(orphan.status, "suggested");
});

test("פרצוף חדש מצטרף לאדם קיים אוטומטית, והאלבום שלו מתעדכן", async () => {
  await seedThreePeople();
  await cluster();
  const [personA] = (await groups()).persons;
  assert.equal((await mutate({ action: "approve", personId: personA.personId, name: "יוסי כהן" })).status, 200);

  await index("a4", [face(A, 0.05)], { extra: { takenAt: Date.UTC(2026, 0, 1) } });
  const run = await cluster();
  assert.equal(run.joined, 1);

  const album = await call(`/face/persons/${personA.personId}`, "GET", undefined, "viewer-token");
  assert.equal(album.status, 200, album.text);
  assert.equal(album.payload.person.name, "יוסי כהן");
  // מהחדש לישן לפי תאריך הצילום.
  assert.deepEqual(album.payload.imageIds, ["a4", "a2", "a1", "a3"]);
});

test("אינדוקס עם ctx מפעיל קיבוץ ברקע בלי לעכב את התשובה", async () => {
  await index("a1", [face(A, 0)]);
  const pending = [];
  const ctx = { waitUntil: promise => pending.push(promise) };
  putDocument("images", "a2", { id: "a2", url: "https://media.example/a2.jpg" });
  const saved = await call("/face/index", "POST", { modelVersion: MODEL_VERSION, images: [{ imageId: "a2", faces: [face(A, 0.1)] }] }, "admin-token", ctx);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
  const suggested = await groups();
  assert.equal(suggested.persons.length, 1);
  assert.equal(suggested.persons[0].faceCount, 2);
});

test("פרצוף בין שני אנשים, או קרוב מדי לסף, נכנס לתור \"לבדיקה\" והמנהל מכריע", async () => {
  await seedThreePeople();
  await cluster();
  await index("x1", [face(null, 0, [[A, 0.3], [B, 0.3]])]);
  await index("y1", [face(A, 0, [[4, 0.54]])]);
  const run = await cluster();
  assert.equal(run.review, 2);

  const review = await groups("view=review");
  assert.equal(review.counts.review, 2);
  assert.equal(review.faces.length, 2);
  assertNoDescriptors(JSON.stringify(review));
  for (const item of review.faces) assert.ok(item.candidate?.personId, "לכל פרצוף בבדיקה יש אדם מוצע");
  const [x, y] = ["x1", "y1"].map(id => review.faces.find(item => item.imageId === id));

  const { persons } = await groups();
  const personB = persons.find(person => person.faceCount === 2);
  const accepted = await mutate({ action: "accept", face: x, personId: personB.personId });
  assert.equal(accepted.status, 200, accepted.text);
  const rejected = await mutate({ action: "reject", face: y });
  assert.equal(rejected.status, 200, rejected.text);

  const after = await groups();
  assert.equal(after.counts.review, 0);
  assert.equal(after.persons.find(person => person.personId === personB.personId).faceCount, 3);
  // מה שנדחה חוזר להיות בודד, ולא נכנס שוב לבדיקה בריצה הבאה.
  assert.equal((await cluster()).processed, 0);
  assert.equal(sql.prepare("SELECT mark FROM face_cluster_marks WHERE image_id = 'y1'").get().mark, "seed");
});

// --- פעולות המנהל ---

test("בודדים: המנהל רואה פרצופים בלי קבוצה, פותח להם קבוצה חדשה עם שם או משייך אותם", async () => {
  await seedThreePeople();
  await index("d1", [face(5, 0)]);
  await cluster();
  const singles = await groups("view=singles");
  assertNoDescriptors(JSON.stringify(singles));
  assert.equal(singles.counts.singles, 2);
  assert.deepEqual(singles.faces.map(item => item.imageId).sort(), ["c1", "d1"]);
  const c1 = singles.faces.find(item => item.imageId === "c1");
  const d1 = singles.faces.find(item => item.imageId === "d1");
  assert.equal(c1.url, "https://media.example/c1-thumb.webp");

  // "קבוצה חדשה": אדם מוצע עם פרצוף אחד, שמופיע בהצעות ומקבל שם.
  assert.equal((await mutate({ action: "move", face: c1 })).status, 200);
  const suggested = await groups();
  assert.equal(suggested.counts.singles, 1);
  const created = suggested.persons.find(person => person.faceCount === 1);
  assert.ok(created, "הקבוצה החדשה מוצגת בהצעות");
  assert.equal((await mutate({ action: "approve", personId: created.personId, name: "זלמן" })).status, 200);
  const listed = (await call("/face/persons", "GET", undefined, "viewer-token")).payload.persons;
  assert.deepEqual(listed.map(person => person.name), ["זלמן"]);

  // שיוך בודד לאדם קיים.
  const [personA] = suggested.persons;
  assert.equal((await mutate({ action: "accept", face: d1, personId: personA.personId })).status, 200);
  const after = await groups("view=singles");
  assert.equal(after.counts.singles, 0);
  assert.equal(after.faces.length, 0);
  assert.equal((await cluster()).processed, 0);
});

test("אישור ושם: שם ריק, ארוך מדי או עם תווי כיווניות מטופל, ושינוי שם נשמר", async () => {
  await seedThreePeople();
  await cluster();
  const [person] = (await groups()).persons;

  const empty = await mutate({ action: "approve", personId: person.personId, name: "   " });
  assert.equal(empty.status, 400);
  assert.equal(empty.payload.code, "invalid_person_name");
  const long = await mutate({ action: "approve", personId: person.personId, name: "א".repeat(61) });
  assert.equal(long.status, 400);
  const badId = await mutate({ action: "approve", personId: "../../x", name: "שם" });
  assert.equal(badId.status, 400);
  assert.equal(badId.payload.code, "invalid_person_id");

  const approved = await mutate({ action: "approve", personId: person.personId, name: "‮משה‏  לוי " });
  assert.equal(approved.status, 200, approved.text);
  const list = await groups("view=approved");
  assert.equal(list.persons[0].name, "משה לוי");
  assert.equal(list.persons[0].status, "approved");
  assert.equal(list.counts.suggested, 1);

  await mutate({ action: "rename", personId: person.personId, name: "משה לוי הכהן" });
  assert.equal((await groups("view=approved")).persons[0].name, "משה לוי הכהן");

  const unknown = await mutate({ action: "explode", personId: person.personId });
  assert.equal(unknown.status, 400);
});

test("איחוד שתי קבוצות שומר את השם, והעברה והסרה של פרצוף נשמרות גם אחרי קיבוץ נוסף", async () => {
  await seedThreePeople();
  await cluster();
  const [personA, personB] = (await groups()).persons;
  await mutate({ action: "approve", personId: personB.personId, name: "דוד" });

  const merged = await mutate({ action: "merge", targetId: personA.personId, sourceId: personB.personId });
  assert.equal(merged.status, 200, merged.text);
  const approved = await groups("view=approved");
  assert.equal(approved.persons.length, 1);
  assert.equal(approved.persons[0].personId, personA.personId);
  assert.equal(approved.persons[0].name, "דוד", "השם עובר לקבוצה שנשארה");
  assert.equal(approved.persons[0].faceCount, 5);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_persons WHERE person_id = ?").get(personB.personId).n, 0);

  const members = await groups(`person=${personA.personId}`);
  assert.equal(members.faces.length, 5);
  const b1 = members.faces.find(item => item.imageId === "b1");
  const a3b = members.faces.find(item => item.imageId === "a3" && item.faceIndex === 1);

  // העברה לקבוצה חדשה, והסרה ("לא לקבץ").
  const moved = await mutate({ action: "move", face: b1 });
  assert.equal(moved.status, 200, moved.text);
  const removed = await mutate({ action: "remove", face: a3b });
  assert.equal(removed.status, 200, removed.text);
  assert.equal((await groups(`person=${personA.personId}`)).faces.length, 3);

  // הקבוצה החדשה, עם פרצוף אחד, מופיעה בהצעות — אפשר לתת לה שם ולאשר.
  const newGroupId = sql.prepare("SELECT person_id FROM face_people WHERE image_id = 'b1'").get().person_id;
  const suggestedNow = await groups();
  assert.equal(suggestedNow.persons.find(person => person.personId === newGroupId)?.faceCount, 1);
  assert.equal(suggestedNow.counts.suggested, 1);

  // ריצת קיבוץ נוספת אינה מחזירה את מה שהמנהל הסיר או העביר.
  assert.equal((await cluster()).processed, 0);
  assert.equal(sql.prepare("SELECT mark FROM face_cluster_marks WHERE image_id = 'a3' AND face_index = 1").get().mark, "ignored");
  const b1Person = sql.prepare("SELECT person_id, source FROM face_people WHERE image_id = 'b1'").get();
  assert.notEqual(b1Person.person_id, personA.personId);
  assert.equal(b1Person.source, "manual");

  // העברה בחזרה לקבוצה קיימת.
  const back = await mutate({ action: "move", face: b1, targetId: personA.personId });
  assert.equal(back.status, 200, back.text);
  assert.equal((await groups(`person=${personA.personId}`)).faces.length, 4);
});

test("בקשה מול גרסה ישנה של הפרצוף נדחית ב-409, והתמונה הראשית ניתנת לבחירה", async () => {
  await seedThreePeople();
  await cluster();
  const [person] = (await groups()).persons;
  const members = await groups(`person=${person.personId}`);
  const target = members.faces.find(item => item.imageId === "a2");

  const stale = await mutate({ action: "remove", face: { ...target, updatedAt: target.updatedAt - 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "stale_faces");

  const cover = await mutate({ action: "cover", personId: person.personId, face: target });
  assert.equal(cover.status, 200, cover.text);
  assert.equal((await groups()).persons[0].cover.imageId, "a2");

  const foreign = (await groups(`person=${(await groups()).persons[1].personId}`)).faces[0];
  const wrongCover = await mutate({ action: "cover", personId: person.personId, face: foreign });
  assert.equal(wrongCover.status, 400);
});

test("הסתרה מוציאה אדם מהרשימה ומהאלבום, וביטול ההסתרה מחזיר אותו", async () => {
  await seedThreePeople();
  await cluster();
  const [person] = (await groups()).persons;
  await mutate({ action: "approve", personId: person.personId, name: "אהרן" });
  await mutate({ action: "hide", personId: person.personId });

  const hidden = await groups("view=hidden");
  assert.equal(hidden.persons.length, 1);
  assert.equal(hidden.persons[0].hidden, true);
  assert.equal((await call("/face/persons", "GET", undefined, "viewer-token")).payload.persons.length, 0);
  assert.equal((await call(`/face/persons/${person.personId}`, "GET", undefined, "viewer-token")).status, 404);
  // מנהל עדיין רואה את האלבום (לבדיקה לפני החזרה).
  assert.equal((await call(`/face/persons/${person.personId}`)).status, 200);

  await mutate({ action: "unhide", personId: person.personId });
  assert.equal((await call("/face/persons", "GET", undefined, "viewer-token")).payload.persons.length, 1);
});

// --- הרשאות ופרטיות ---

test("ניהול וקיבוץ למנהלים בלבד; הרשימה והאלבום למשתמשים מאושרים בלבד", async () => {
  await seedThreePeople();
  for (const token of ["viewer-token", "pending-token", ""]) {
    assert.ok([401, 403].includes((await call("/face/groups", "GET", undefined, token)).status));
    assert.ok([401, 403].includes((await call("/face/groups", "POST", { action: "hide", personId: "x" }, token)).status));
    assert.ok([401, 403].includes((await call("/face/clusters/run", "POST", {}, token)).status));
    assert.ok([401, 403].includes((await call("/face/boxes", "POST", { boxes: [] }, token)).status));
  }
  for (const token of ["pending-token", ""]) {
    assert.ok([401, 403].includes((await call("/face/persons", "GET", undefined, token)).status));
    assert.ok([401, 403].includes((await call("/face/persons/abc", "GET", undefined, token)).status));
    assert.ok([401, 403].includes((await call("/face/me", "GET", undefined, token)).status));
  }
});

test("הרשימה הציבורית: רק אנשים מאושרים עם שם, עם תמונה ראשית, בלי טביעות, ועם ETag", async () => {
  await seedThreePeople();
  await cluster();
  const [personA, personB] = (await groups()).persons;
  await mutate({ action: "approve", personId: personA.personId, name: "שמואל" });

  const list = await call("/face/persons", "GET", undefined, "viewer-token");
  assert.equal(list.status, 200, list.text);
  assertNoDescriptors(list.text);
  assert.ok(list.headers.get("ETag"));
  assert.deepEqual(list.payload.persons.map(person => person.name), ["שמואל"]);
  const [entry] = list.payload.persons;
  assert.deepEqual(Object.keys(entry).sort(), ["cover", "faceCount", "imageCount", "name", "personId"]);
  assert.deepEqual(entry.cover, { imageId: "a1", box: BOX, url: "https://media.example/a1-thumb.webp" });
  assert.equal(entry.imageCount, 3);

  // קבוצה שלא אושרה אינה גלויה לצופה, גם בגישה ישירה.
  assert.equal((await call(`/face/persons/${personB.personId}`, "GET", undefined, "viewer-token")).status, 404);
  assert.equal((await call("/face/persons/bad..id", "GET", undefined, "viewer-token")).status, 400);
  assert.equal((await call("/face/persons/%E0%A4%A", "GET", undefined, "viewer-token")).status, 400);
});

test("תמונה שנמחקה יוצאת מהאלבום ומהמונים, ורק מדיה מאושרת נכללת", async () => {
  await seedThreePeople();
  await cluster();
  const [personA] = (await groups()).persons;
  await mutate({ action: "approve", personId: personA.personId, name: "חיים" });

  const removed = await call("/data/images/a2", "DELETE", undefined, "super-token");
  assert.equal(removed.status, 200, removed.text);
  const album = await call(`/face/persons/${personA.personId}`, "GET", undefined, "viewer-token");
  assert.deepEqual(album.payload.imageIds, ["a1", "a3"]);
  const listed = (await call("/face/persons", "GET", undefined, "viewer-token")).payload.persons[0];
  assert.equal(listed.imageCount, 2);
  assert.equal(listed.faceCount, 2);
});

test("חיפוש פנים מתרחב לאדם מאושר בלבד — לא לקבוצה מוצעת ולא לאדם מוסתר", async () => {
  await seedThreePeople();
  await cluster();
  const [personA] = (await groups()).persons;
  // a3 רחוק 0.2 מ-a1; עם סף החיפוש 0.48 טביעה במרחק 0.45 מ-a1 מתאימה רק לו.
  const query = face(A, -0.45);
  const search = async () => (await call("/face/search", "POST", { descriptor: query }, "viewer-token")).payload.matches.map(match => match.imageId).sort();

  assert.deepEqual(await search(), ["a1"], "קבוצה שלא אושרה אינה מרחיבה את החיפוש");
  await mutate({ action: "approve", personId: personA.personId, name: "אליהו" });
  assert.deepEqual(await search(), ["a1", "a2", "a3"]);
  await mutate({ action: "hide", personId: personA.personId });
  assert.deepEqual(await search(), ["a1"]);
});

test("\"התמונות שלי\": הטביעה נשמרת רק בהסכמה, אינה מוחזרת, ונמחקת ב\"שכח אותי\" ובמחיקת המשתמש", async () => {
  await seedThreePeople();
  const descriptor = face(A, 0.02);

  const initial = await call("/face/me", "GET", undefined, "viewer-token");
  assert.deepEqual(initial.payload, { success: true, remembered: false, savedAt: 0 });
  assert.equal((await call("/face/me/search", "POST", {}, "viewer-token")).status, 404);

  const noConsent = await call("/face/me", "PUT", { descriptor, modelVersion: MODEL_VERSION }, "viewer-token");
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.payload.code, "consent_required");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_user_descriptors").get().n, 0);

  const invalid = await call("/face/me", "PUT", { descriptor: [1, 2, 3], consent: true }, "viewer-token");
  assert.equal(invalid.status, 400);

  const saved = await call("/face/me", "PUT", { descriptor, modelVersion: MODEL_VERSION, consent: true }, "viewer-token");
  assert.equal(saved.status, 200, saved.text);
  assertNoDescriptors(saved.text);
  const status = await call("/face/me", "GET", undefined, "viewer-token");
  assert.equal(status.payload.remembered, true);
  assertNoDescriptors(status.text);

  const found = await call("/face/me/search", "POST", {}, "viewer-token");
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(found.payload.matches.map(match => match.imageId).sort(), ["a1", "a2", "a3"]);
  assertNoDescriptors(JSON.stringify(found.payload.matches));

  const forgotten = await call("/face/me", "DELETE", undefined, "viewer-token");
  assert.deepEqual(forgotten.payload, { success: true, remembered: false });
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_user_descriptors").get().n, 0);

  await call("/face/me", "PUT", { descriptor, modelVersion: MODEL_VERSION, consent: true }, "viewer-token");
  const deletedUser = await call("/data/userProfiles/google-viewer", "DELETE", undefined, "super-token");
  assert.equal(deletedUser.status, 200, deletedUser.text);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_user_descriptors").get().n, 0);
});

test("מיקום הפרצוף: נשמר באינדוקס, נבדק, ומושלם רק למי שחסר לו", async () => {
  putDocument("images", "p1", { id: "p1", url: "https://media.example/p1.jpg" });
  const invalid = await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId: "p1", faces: [face(A)], boxes: [{ x: 0.9, y: 0, w: 0.5, h: 0.2, a: 1 }] }]
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "invalid_face_box");
  const mismatch = await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId: "p1", faces: [face(A)], boxes: [BOX, BOX] }]
  });
  assert.equal(mismatch.status, 400);

  await index("p1", [face(A), face(B)]);
  const [row] = sql.prepare("SELECT updated_at AS updatedAt FROM image_face_descriptors WHERE image_id = 'p1' AND face_index = 0").all();
  const filled = await call("/face/boxes", "POST", { boxes: [
    { imageId: "p1", faceIndex: 0, updatedAt: row.updatedAt, box: BOX },
    { imageId: "p1", faceIndex: 1, updatedAt: row.updatedAt - 5, box: BOX }
  ] });
  assert.equal(filled.status, 200, filled.text);
  assert.equal(filled.payload.saved, 1, "רק פרצוף עם הגרסה הנוכחית מתעדכן");
  const boxes = sql.prepare("SELECT face_index, box_json FROM image_face_descriptors WHERE image_id = 'p1' ORDER BY face_index").all();
  assert.deepEqual(JSON.parse(boxes[0].box_json), BOX);
  assert.equal(boxes[1].box_json, "");
  // מיקום קיים אינו נדרס.
  const again = await call("/face/boxes", "POST", { boxes: [{ imageId: "p1", faceIndex: 0, updatedAt: row.updatedAt, box: { ...BOX, x: 0.1 } }] });
  assert.equal(again.payload.saved, 0);
});

test("האיחוד הידני הישן שומר את השם של אדם מאושר ואינו נדרס בקיבוץ", async () => {
  await seedThreePeople();
  await cluster();
  const [personA] = (await groups()).persons;
  await mutate({ action: "approve", personId: personA.personId, name: "נחום" });

  const legacy = await call("/face/people");
  const c1 = legacy.payload.faces.find(item => item.imageId === "c1");
  const a1 = legacy.payload.faces.find(item => item.imageId === "a1");
  const merged = await call("/face/people", "POST", { action: "merge", faces: [a1, c1] });
  assert.equal(merged.status, 200, merged.text);

  const approved = await groups("view=approved");
  assert.equal(approved.persons.length, 1);
  assert.equal(approved.persons[0].personId, personA.personId);
  assert.equal(approved.persons[0].name, "נחום");
  assert.equal(approved.persons[0].faceCount, 4);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_cluster_marks WHERE image_id = 'c1'").get().n, 0);
  assert.equal((await cluster()).processed, 0);

  // הפרדה בממשק הישן מסמנת "לא לקבץ", כדי שהקיבוץ לא יחזיר את הפרצוף.
  const refreshed = (await call(`/face/people?person=${personA.personId}`)).payload.faces.find(item => item.imageId === "c1");
  assert.equal((await call("/face/people", "POST", { action: "detach", faces: [refreshed] })).status, 200);
  assert.equal((await cluster()).processed, 0);
  assert.equal(sql.prepare("SELECT mark FROM face_cluster_marks WHERE image_id = 'c1'").get().mark, "ignored");
});

test("איפוס האינדוקס מוחק גם אנשים, סימונים ושמות", async () => {
  await seedThreePeople();
  await cluster();
  const reset = await call("/face/index/reset", "POST", { scope: "all" }, "super-token");
  assert.equal(reset.status, 200, reset.text);
  for (const table of ["face_persons", "face_cluster_marks", "face_people"]) {
    assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});
