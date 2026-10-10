import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }
  bind(...values) {
    this.bindings = values.map(normalizeBinding);
    return this;
  }
  async first() {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    return row === undefined ? null : row;
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); }
  prepare(sql) { return new SqliteD1Statement(this.database, sql); }
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

// R2 מדומה: אותם קריאות שה-Worker משתמש בהן, כולל list עם prefix.
class MockR2 {
  constructor() { this.objects = new Map(); }
  async toBytes(body) {
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (typeof body === "string") return new TextEncoder().encode(body);
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  async put(key, body, options = {}) {
    this.objects.set(key, {
      key,
      bytes: await this.toBytes(body),
      httpMetadata: { ...(options.httpMetadata || {}) },
      customMetadata: { ...(options.customMetadata || {}) }
    });
    return {};
  }
  wrap(stored, withBody) {
    return {
      key: stored.key,
      size: stored.bytes.length,
      httpEtag: `"${stored.key}"`,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      body: withBody ? stored.bytes : undefined,
      async arrayBuffer() { return stored.bytes.slice().buffer; },
      writeHttpMetadata(headers) {
        if (stored.httpMetadata.contentType) headers.set("Content-Type", stored.httpMetadata.contentType);
      }
    };
  }
  async get(key) {
    const stored = this.objects.get(key);
    return stored ? this.wrap(stored, true) : null;
  }
  async head(key) {
    const stored = this.objects.get(key);
    return stored ? this.wrap(stored, false) : null;
  }
  async delete(keys) {
    for (const key of [].concat(keys)) this.objects.delete(key);
  }
  async list({ prefix = "" } = {}) {
    const objects = [...this.objects.values()]
      .filter(stored => stored.key.startsWith(prefix))
      .map(stored => ({ key: stored.key, size: stored.bytes.length, customMetadata: stored.customMetadata }));
    return { objects, truncated: false };
  }
  keys() { return [...this.objects.keys()].sort(); }
}

const database = new SqliteD1();
const bucket = new MockR2();
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket, OPENAI_API_KEY: "mock-key", SESSION_SIGNING_SECRET: "background-test-signing-secret-long" };
let oidcKeys;
let aiCalls = 0;
let aiResponse = "בחורים רוקדים במעגל";
let aiStatus = 200;
let onAiCall = null;

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "viewer2-token": { sub: "google-viewer-2", email: "viewer2@example.com", name: "Viewer Two" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

const originalFetch = globalThis.fetch;

test.before(async () => {
  oidcKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  globalThis.fetch = async url => {
    const href = String(url);
    if (href === "https://token.actions.githubusercontent.com/.well-known/jwks") return Response.json({ keys: [{ ...await crypto.subtle.exportKey("jwk", oidcKeys.publicKey), kid: "test-background" }] });
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const token = decodeURIComponent(new URL(href).searchParams.get("id_token") || "");
      const account = ACCOUNTS[token];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({
        ...account,
        email_verified: "true",
        aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com"
      });
    }
    if (href === "https://api.openai.com/v1/responses") {
      aiCalls += 1;
      if (onAiCall) onAiCall();
      return Response.json({ output: [{ content: [{ type: "output_text", text: aiResponse }] }] }, { status: aiStatus });
    }
    return new Response("not mocked", { status: 500 });
  };
  // הקריאה הראשונה יוצרת את הסכימה.
  const health = await worker.fetch(jsonRequest("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.ok(payload.features.includes("media-variants"));
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  aiCalls = 0; aiResponse = "בחורים רוקדים במעגל"; aiStatus = 200; onAiCall = null;
  bucket.objects.clear();
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "face_people", "image_face_descriptors", "image_face_index_state", "media_variant_files"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer");
  seedProfile("google-viewer-2", "viewer2@example.com", "viewer");
  seedProfile("google-uploader", "uploader@example.com", "uploader");
  seedProfile("google-admin", "admin@example.com", "admin");
  seedProfile("google-super", "super@example.com", "super_admin");
});

function putDocument(collection, id, data, ownerUid = "google-admin") {
  const now = Date.now();
  database.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), ownerUid, now, now);
}

function readDocument(collection, id) {
  const row = database.database
    .prepare("SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?")
    .get(collection, id);
  return row ? JSON.parse(row.data_json) : null;
}

function seedProfile(uid, email, role) {
  putDocument("userProfiles", uid, { uid, email, role, status: "approved" }, uid);
}

function headersFor(token, extra = {}) {
  return { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function jsonRequest(path, method = "GET", body, token = "admin-token") {
  return new Request(`${API}${path}`, {
    method,
    headers: headersFor(token, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}


const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
async function oidc(overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  const header = encode({alg:'RS256',kid:'test-background'});
  const payload = encode({ iss:'https://token.actions.githubusercontent.com', aud: API+'/background', repository:'SHMUEL-LAMED/1', repository_id:'1308950667', repository_owner_id:'295421676', workflow_ref:'SHMUEL-LAMED/1/.github/workflows/background-jobs.yml@refs/heads/main', ref:'refs/heads/main', event_name:'schedule', iat:now, exp:now+300, run_id:'12345', ...overrides });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', oidcKeys.privateKey, new TextEncoder().encode(header+'.'+payload));
  return header+'.'+payload+'.'+Buffer.from(signature).toString('base64url');
}
async function session() {
  const response = await worker.fetch(jsonRequest('/background/session','POST',undefined,await oidc()),environment);
  assert.equal(response.status,200,await response.clone().text());
  return (await response.json()).token;
}
test('trusted scheduled workflow receives scoped session and can persist continuation', async () => {
  const token = await session();
  assert.ok(token.startsWith('bg1.'));
  assert.equal((await worker.fetch(jsonRequest('/data/images','GET',undefined,token),environment)).status,200);
  assert.equal((await worker.fetch(jsonRequest('/background/status','POST',{phase:'idle',cursor:{lastDriveAt:123},jobs:{titles:{processed:2}}},token),environment)).status,200);
  const response = await worker.fetch(jsonRequest('/background/status','GET',undefined,token),environment);
  const state = (await response.json()).state;
  assert.equal(state.cursor.lastDriveAt,123);
  assert.equal(state.jobs.titles.processed,2);
});
test('background capability cannot change users, delete files, configure itself, or become a user session', async () => {
  const token = await session();
  for (const [path,method] of [['/data/userProfiles','GET'],['/data/images/photo1','DELETE'],['/background/config','PUT'],['/face/index/reset','POST']]) {
    assert.equal((await worker.fetch(jsonRequest(path,method,method==='GET'?undefined:{},token),environment)).status,403,path);
  }
  assert.equal((await worker.fetch(jsonRequest('/background/config','GET',undefined,token.replace('bg1.','v1.')),environment)).status,401);
});
test('fork, PR, wrong audience, wrong repository ID, and expired OIDC are rejected', async () => {
  for (const overrides of [{repository:'attacker/1'},{repository_id:'2'},{ref:'refs/pull/1/merge'},{event_name:'pull_request'},{aud:'other'},{workflow_ref:'SHMUEL-LAMED/1/.github/workflows/other.yml@refs/heads/main'},{exp:1}]) {
    assert.equal((await worker.fetch(jsonRequest('/background/session','POST',undefined,await oidc(overrides)),environment)).status,403);
  }
  const token = await oidc();
  assert.equal((await worker.fetch(jsonRequest('/background/session','POST',undefined,token.slice(0,-10)+'AAAAAAAAAA'),environment)).status,401);
});
test('only admin can pause cloud processing and runner observes saved configuration', async () => {
  assert.equal((await worker.fetch(jsonRequest('/background/config','PUT',{enabled:{titles:false}},'viewer-token'),environment)).status,403);
  assert.equal((await worker.fetch(jsonRequest('/background/config','PUT',{enabled:{titles:false}},'admin-token'),environment)).status,200);
  const response = await worker.fetch(jsonRequest('/background/config','GET',undefined,await session()),environment);
  assert.equal((await response.json()).config.enabled.titles,false);
});
test('large continuation fails cleanly without truncating JSON', async () => {
  const token=await session();
  assert.equal((await worker.fetch(jsonRequest('/background/status','POST',{cursor:{data:'x'.repeat(200001)}},token),environment)).status,400);
});

test('replaced Drive media resets old derived data so every job processes the new file', async () => {
  putDocument('images','driveimage_abc12345678',{id:'driveimage_abc12345678',driveFileId:'abc12345678',driveModifiedTime:'old',title:'old AI title',originalTitle:'old.jpg',aiTitleVersion:1,variants:{thumb:{url:API+'/media/variants/old.webp'}},variantsVersion:1,takenAt:123456789,takenAtSource:'exif',caption:'כיתוב של הקובץ הקודם',sceneTags:['dance'],captionSource:'ai',aiCaptionVersion:1,aiCaptionGeneratedAt:123});
  const response = await worker.fetch(jsonRequest('/data/images/driveimage_abc12345678','PUT',{data:{driveFileId:'abc12345678',driveModifiedTime:'new',originalTitle:'new.jpg',title:'new',takenAt:null,takenAtSource:null},merge:true},await session()),environment);
  assert.equal(response.status,200,await response.clone().text());
  const saved = readDocument('images','driveimage_abc12345678');
  assert.equal(saved.aiTitleVersion,0);
  assert.equal(saved.variantsVersion,0);
  assert.equal(saved.title,'new');
  assert.equal(saved.takenAt,null);
  for (const field of ['caption','sceneTags','captionSource','aiCaptionVersion','aiCaptionGeneratedAt']) assert.equal(saved[field],undefined,field);
});

test('replaced Drive media keeps a caption an admin edited by hand', async () => {
  putDocument('images','driveimage_def12345678',{id:'driveimage_def12345678',driveFileId:'def12345678',driveModifiedTime:'old',title:'old',originalTitle:'old.jpg',aiTitleVersion:1,caption:'כיתוב שהמנהל כתב',sceneTags:['lesson'],captionSource:'manual',captionEditedAt:456});
  const response = await worker.fetch(jsonRequest('/data/images/driveimage_def12345678','PUT',{data:{driveFileId:'def12345678',driveModifiedTime:'new',originalTitle:'new.jpg',title:'new'},merge:true},await session()),environment);
  assert.equal(response.status,200,await response.clone().text());
  const saved = readDocument('images','driveimage_def12345678');
  assert.equal(saved.aiTitleVersion,0);
  assert.equal(saved.caption,'כיתוב שהמנהל כתב');
  assert.deepEqual(saved.sceneTags,['lesson']);
  assert.equal(saved.captionSource,'manual');
});
