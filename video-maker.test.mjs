import test from "node:test";
import assert from "node:assert/strict";
import {
    normalizeVideoOptions, DEFAULT_VIDEO_OPTIONS, prepareVideoItems, buildTimeline, frameAt,
    TRANSITION_SECONDS, TITLE_SECONDS, OUTRO_SECONDS, transitionFor, TRANSITION_IDS,
    kenBurnsPlan, kenBurnsAt, coverRect, easeInOutCubic, seededRandom, hashSeed,
    pickRecorderType, videoFileName, formatDuration, VIDEO_MAX_ITEMS
} from "./video-maker.js";

const photo = (id, extra = {}) => ({ id, url: `https://cdn.example/${id}.jpg`, mimeType: "image/jpeg", ...extra });

test("אפשרויות: ערכים לא מוכרים חוזרים לברירת המחדל", () => {
    assert.deepEqual(normalizeVideoOptions(null), { ...DEFAULT_VIDEO_OPTIONS });
    const options = normalizeVideoOptions({ transition: "cube", aspect: "portrait", theme: "ivory", slideSeconds: "6", kenBurns: false, logo: false });
    assert.equal(options.transition, "cube");
    assert.equal(options.aspect, "portrait");
    assert.equal(options.theme, "ivory");
    assert.equal(options.slideSeconds, 6);
    assert.equal(options.kenBurns, false);
    assert.equal(options.logo, false);
    assert.equal(options.titleCard, true);
    assert.equal(normalizeVideoOptions({ transition: "<script>", slideSeconds: 99 }).transition, "mix");
    assert.equal(normalizeVideoOptions({ slideSeconds: 99 }).slideSeconds, 4);
});

test("הפריטים: בלי כפילויות, לפי סדר הצילום, סרטון — הפוסטר, ובלי http", () => {
    const records = [
        photo("b", { capturedAt: "2026-10-02T10:00:00Z" }),
        photo("a", { capturedAt: "2026-10-01T10:00:00Z", caption: "  ריקוד   בחצר " }),
        photo("a"),
        { id: "v1", mimeType: "video/mp4", url: "https://cdn.example/v1.mp4", variants: { poster: { url: "https://cdn.example/v1-poster.jpg" } } },
        { id: "v2", mimeType: "video/mp4", url: "https://cdn.example/v2.mp4" },
        { id: "x", url: "http://insecure.example/x.jpg" }
    ];
    const result = prepareVideoItems(records);
    assert.deepEqual(result.items.map(item => item.id).sort(), ["a", "b", "v1"]);
    assert.equal(result.items.find(item => item.id === "v1").src, "https://cdn.example/v1-poster.jpg");
    assert.equal(result.items.find(item => item.id === "a").caption, "ריקוד בחצר");
    assert.equal(result.skipped, 2);
    const many = prepareVideoItems(Array.from({ length: VIDEO_MAX_ITEMS + 5 }, (_, i) => photo(`p${i}`)));
    assert.equal(many.items.length, VIDEO_MAX_ITEMS);
    assert.equal(many.truncated, 5);
});

test("ציר הזמן: פתיחה, תמונות וסיום, עם חפיפה של זמן המעבר", () => {
    const timeline = buildTimeline(3, { slideSeconds: 4 }, 7);
    assert.deepEqual(timeline.slides.map(slide => slide.kind), ["title", "photo", "photo", "photo", "outro"]);
    const expected = TITLE_SECONDS + 3 * 4 + OUTRO_SECONDS - 4 * TRANSITION_SECONDS;
    assert.ok(Math.abs(timeline.duration - expected) < 1e-9);
    assert.equal(timeline.slides.at(-1).transition, null);
    for (let index = 1; index < timeline.slides.length; index += 1) {
        const previous = timeline.slides[index - 1];
        assert.ok(Math.abs(timeline.slides[index].start - (previous.end - TRANSITION_SECONDS)) < 1e-9);
    }
    const bare = buildTimeline(2, { titleCard: false, slideSeconds: 3 }, 1);
    assert.deepEqual(bare.slides.map(slide => slide.kind), ["photo", "photo"]);
    assert.equal(buildTimeline(0, {}, 1).duration, 0);
});

test("frameAt: שקופית אחת באמצע, ושתיים בזמן המעבר", () => {
    const timeline = buildTimeline(2, { titleCard: false, slideSeconds: 4, transition: "circle" }, 1);
    const middle = frameAt(timeline, 1);
    assert.equal(middle.current.item, 0);
    assert.equal(middle.next, null);
    const during = frameAt(timeline, 4 - TRANSITION_SECONDS / 2);
    assert.equal(during.current.item, 0);
    assert.equal(during.next.item, 1);
    assert.equal(during.transition, "circle");
    assert.ok(Math.abs(during.progress - 0.5) < 1e-9);
    const end = frameAt(timeline, 999);
    assert.equal(end.current.item, 1);
    assert.ok(Math.abs(end.local - 1) < 1e-9);
});

test("מגוון מעברים: דטרמיניסטי, בלי חזרה ברצף, ומתוך הרשימה", () => {
    const options = { transition: "mix" };
    const run = Array.from({ length: 30 }, (_, i) => transitionFor(options, i, 42));
    assert.deepEqual(run, Array.from({ length: 30 }, (_, i) => transitionFor(options, i, 42)));
    run.forEach((id, i) => {
        assert.ok(TRANSITION_IDS.includes(id));
        if (i) assert.notEqual(id, run[i - 1]);
    });
    assert.ok(new Set(run).size >= 6, "המגוון אמור להשתמש בהרבה מעברים");
});

test("Ken Burns ו-cover: התמונה ממלאת את המסגרת ולעולם אינה חושפת רקע", () => {
    for (let index = 0; index < 20; index += 1) {
        const plan = kenBurnsPlan(index, 99);
        for (const progress of [0, 0.3, 0.7, 1]) {
            const motion = kenBurnsAt(plan, progress);
            const rect = coverRect(1280, 853, 720, 1280, motion);
            assert.ok(rect.x <= 1e-6 && rect.y <= 1e-6, "הפינה העליונה בתוך המסגרת");
            assert.ok(rect.x + rect.width >= 720 - 1e-6 && rect.y + rect.height >= 1280 - 1e-6, "הפינה התחתונה מכסה");
        }
    }
    assert.deepEqual(kenBurnsAt(kenBurnsPlan(0, 1), 0.5, false), { scale: 1, x: 0, y: 0 });
});

test("עזרים: עקומות, זרע, סוג הקלטה, שם קובץ ומשך", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert.equal(easeInOutCubic(0.5), 0.5);
    const a = seededRandom(hashSeed("אלבום"));
    const b = seededRandom(hashSeed("אלבום"));
    assert.equal(a(), b());
    assert.equal(pickRecorderType(type => type.startsWith("video/webm")), "video/webm;codecs=vp9,opus");
    assert.equal(pickRecorderType(type => type === "video/mp4"), "video/mp4");
    assert.equal(pickRecorderType(() => false), "");
    assert.equal(videoFileName('שמחת "תורה" / תשפ״ז', "video/mp4"), "שמחת תורה תשפ״ז.mp4");
    assert.equal(videoFileName("", "video/webm"), "סרטון.webm");
    assert.equal(formatDuration(75.4), "1:15");
});
