// Cloudflare Stream בדפדפן (stream-player.js) ותצוגה מקדימה בריחוף
// (video-hover-preview.js): המסלול האופציונלי של Stream — בלי stream ברשומה
// הכול כמו קודם, ועם stream כל תקלה נופלת למקור ב-R2 — והתנאים שבהם
// התצוגה המקדימה פועלת. ה-<video> וה-matchMedia מדומים.
import test from "node:test";
import assert from "node:assert/strict";
import { pickStreamSource, attachVideoPlayback, HLS_JS_URL } from "./stream-player.js";
import { hoverPreviewAllowed, installVideoHoverPreview } from "./video-hover-preview.js";

const HLS = "https://customer-xyz.cloudflarestream.com/abc123/manifest/video.m3u8";
const R2 = "https://api.example/media/approved/u/vid.mp4";

function fakeVideo({ nativeHls = false } = {}) {
  const listeners = new Map();
  return {
    src: "",
    loads: 0,
    canPlayType: type => (nativeHls && type === "application/vnd.apple.mpegurl" ? "maybe" : ""),
    load() { this.loads += 1; },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    fire(name) { listeners.get(name)?.(); }
  };
}

function fakeHlsLibrary({ supported = true } = {}) {
  const instances = [];
  class Hls {
    static isSupported() { return supported; }
    constructor(config) { this.config = config; this.handlers = {}; this.destroyed = false; instances.push(this); }
    on(event, handler) { this.handlers[event] = handler; }
    loadSource(url) { this.source = url; }
    attachMedia(video) { this.media = video; }
    destroy() { this.destroyed = true; }
  }
  Hls.Events = { ERROR: "hlsError" };
  return { Hls, instances };
}

test("מקור Stream: רק כתובת m3u8 של Stream נחשבת; רשומה בלי stream — אין", () => {
  assert.equal(pickStreamSource({ stream: { uid: "abc123", hls: HLS } }), HLS);
  assert.equal(pickStreamSource({ stream: { hls: "https://videodelivery.net/abc/manifest/video.m3u8" } }), "https://videodelivery.net/abc/manifest/video.m3u8");
  assert.equal(pickStreamSource({}), "");
  assert.equal(pickStreamSource({ stream: { hls: "https://evil.example/x.m3u8" } }), "");
  assert.equal(pickStreamSource({ stream: { hls: "javascript:alert(1)" } }), "");
  assert.match(HLS_JS_URL, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/hls\.js\/\d+\.\d+\.\d+\/hls\.min\.js$/);
});

test("בלי Stream: המקור ב-R2 בדיוק כמו קודם, ו-hls.js אינו נטען", async () => {
  const video = fakeVideo();
  let loaded = false;
  await attachVideoPlayback(video, { record: { id: "v" }, fallbackUrl: R2, loadLibrary: async () => { loaded = true; } });
  assert.equal(video.src, R2);
  assert.equal(loaded, false);
});

test("Safari (HLS מובנה): הכתובת של Stream ישירות; שגיאה — חזרה למקור", async () => {
  const video = fakeVideo({ nativeHls: true });
  let loaded = false;
  await attachVideoPlayback(video, { record: { stream: { hls: HLS } }, fallbackUrl: R2, loadLibrary: async () => { loaded = true; } });
  assert.equal(video.src, HLS);
  assert.equal(loaded, false);
  video.fire("error");
  assert.equal(video.src, R2);
});

test("שאר הדפדפנים: hls.js נטען לפי דרישה; שגיאה קטלנית (סרטון שעוד בעיבוד) — חזרה למקור", async () => {
  const video = fakeVideo();
  const { Hls, instances } = fakeHlsLibrary();
  const release = await attachVideoPlayback(video, { record: { stream: { hls: HLS } }, fallbackUrl: R2, loadLibrary: async () => Hls });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].source, HLS);
  assert.equal(instances[0].media, video);
  instances[0].handlers.hlsError("hlsError", { fatal: false });
  assert.equal(video.src, "");
  instances[0].handlers.hlsError("hlsError", { fatal: true });
  assert.equal(instances[0].destroyed, true);
  assert.equal(video.src, R2);
  release();
});

test("hls.js שלא נטען או שאינו נתמך — המקור ב-R2", async () => {
  const failed = fakeVideo();
  await attachVideoPlayback(failed, { record: { stream: { hls: HLS } }, fallbackUrl: R2, loadLibrary: async () => { throw new Error("blocked"); } });
  assert.equal(failed.src, R2);
  const unsupported = fakeVideo();
  const { Hls } = fakeHlsLibrary({ supported: false });
  await attachVideoPlayback(unsupported, { record: { stream: { hls: HLS } }, fallbackUrl: R2, loadLibrary: async () => Hls });
  assert.equal(unsupported.src, R2);
});

function fakeWindow({ hover = true, reduced = false } = {}) {
  return {
    matchMedia: query => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : hover
    }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
  };
}

test("תצוגה מקדימה: רק עם עכבר ובלי בקשה לפחות תנועה", () => {
  assert.equal(hoverPreviewAllowed(fakeWindow()), true);
  assert.equal(hoverPreviewAllowed(fakeWindow({ reduced: true })), false);
  assert.equal(hoverPreviewAllowed(fakeWindow({ hover: false })), false);
  assert.equal(hoverPreviewAllowed({}), false);
});

// כרטיס מדומה עם closest/contains/querySelector, ו-root שמפיץ אירועים.
function fakeGrid() {
  const handlers = {};
  const video = {
    muted: false, preload: "none", currentTime: 0, readyState: 0, plays: 0, pauses: 0, loads: 0,
    play() { this.plays += 1; this.readyState = 2; this.currentTime = 1; return Promise.resolve(); },
    pause() { this.pauses += 1; },
    load() { this.loads += 1; this.readyState = 0; }
  };
  const classes = new Set();
  const card = {
    isConnected: true,
    dataset: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    querySelector: () => video,
    contains: node => node === card || node === inner,
    closest: () => card
  };
  const inner = { closest: () => card };
  const root = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    removeEventListener: name => { delete handlers[name]; },
    fire: (name, event) => handlers[name]?.(event)
  };
  return { root, card, inner, video, classes };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("ריחוף מפעיל את הסרטון מושתק, ויציאה עוצרת ומחזירה לפוסטר", async () => {
  const { root, card, inner, video, classes } = fakeGrid();
  const preview = installVideoHoverPreview(root, { win: fakeWindow(), startDelayMs: 1, previewMs: 1000 });
  root.fire("pointerover", { target: inner, pointerType: "mouse" });
  await wait(10);
  assert.equal(video.plays, 1);
  assert.equal(video.muted, true);
  assert.equal(video.preload, "auto");
  assert.ok(classes.has("is-previewing"));
  assert.equal(preview.activeCard, card);
  root.fire("pointerout", { target: inner, relatedTarget: null });
  assert.equal(video.pauses, 1);
  assert.equal(video.currentTime, 0);
  assert.equal(video.preload, "none");
  assert.equal(video.loads, 1);
  assert.ok(!classes.has("is-previewing"));
  preview.destroy();
});

test("התצוגה המקדימה נעצרת מעצמה אחרי כמה שניות, ומיקוד מקלדת מפעיל אותה", async () => {
  const { root, inner, video } = fakeGrid();
  installVideoHoverPreview(root, { win: fakeWindow(), startDelayMs: 1, previewMs: 15 });
  root.fire("focusin", { target: inner });
  await wait(5);
  assert.equal(video.plays, 1);
  await wait(30);
  assert.equal(video.pauses, 1);
});

test("מגע, או בקשה לפחות תנועה — אין ניגון", async () => {
  const touch = fakeGrid();
  installVideoHoverPreview(touch.root, { win: fakeWindow(), startDelayMs: 1 });
  touch.root.fire("pointerover", { target: touch.inner, pointerType: "touch" });
  const reduced = fakeGrid();
  installVideoHoverPreview(reduced.root, { win: fakeWindow({ reduced: true }), startDelayMs: 1 });
  reduced.root.fire("pointerover", { target: reduced.inner, pointerType: "mouse" });
  await wait(10);
  assert.equal(touch.video.plays, 0);
  assert.equal(reduced.video.plays, 0);
});
