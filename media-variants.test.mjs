// בדיקות העזרים הטהורים של התצוגות המקדימות: בחירת המקור להצגה, בחירת
// הפריטים שחסרות להם תצוגות, והלולאה של ריצת ההשלמה — בלי DOM ובלי רשת.
import test from "node:test";
import assert from "node:assert/strict";
import {
    MEDIA_VARIANTS_VERSION,
    needsMediaVariants,
    pickCardSource,
    pickLightboxSource,
    pickPosterSource,
    pickBackdropSource,
    CARD_IMAGE_SIZES,
    selectVariantCandidates,
    runVariantBackfill
} from "./media-variants.js";

const API = "https://simchas-gallery-api.example/media";

function variants(imageId, names = ["thumb", "medium"]) {
    const dims = { thumb: [480, 320], medium: [1280, 853], poster: [1280, 720] };
    return Object.fromEntries(names.map(name => [name, {
        key: `variants/${imageId}/${name}.webp`,
        url: `${API}/variants/${imageId}/${name}.webp`,
        width: dims[name][0],
        height: dims[name][1],
        type: "image/webp"
    }]));
}

// אותן תצוגות, וכל אחת עם עותק AVIF כפי שה-Worker רושם אותו.
function variantsWithAvif(imageId, names = ["thumb", "medium"], avifNames = names) {
    const entries = variants(imageId, names);
    for (const name of avifNames) {
        entries[name].avif = { key: `variants/${imageId}/${name}.avif`, url: `${API}/variants/${imageId}/${name}.avif`, type: "image/avif" };
    }
    return entries;
}

function image(id, extra = {}) {
    return { id, title: `תמונה ${id}`, url: `${API}/approved/u/${id}.jpg`, mediaType: "image", ...extra };
}

function video(id, extra = {}) {
    return { id, title: `סרטון ${id}`, url: `${API}/approved/u/${id}.mp4`, mediaType: "video", ...extra };
}

test("כרטיס: בלי תצוגות מוצג המקור, ועם תצוגות — thumb עם נפילה אל המקור", () => {
    const plain = pickCardSource(image("a"));
    assert.equal(plain.url, `${API}/approved/u/a.jpg`);
    assert.equal(plain.isVariant, false);
    assert.equal(plain.fallbackUrl, "");

    const withThumb = pickCardSource(image("b", { variants: variants("b"), variantsVersion: 1 }));
    assert.equal(withThumb.url, `${API}/variants/b/thumb.webp`);
    assert.equal(withThumb.isVariant, true);
    assert.equal(withThumb.fallbackUrl, `${API}/approved/u/b.jpg`);

    const mediumOnly = pickCardSource(image("c", { variants: variants("c", ["medium"]) }));
    assert.equal(mediumOnly.url, `${API}/variants/c/medium.webp`);

    // כתובת תצוגה שאינה https אינה נחשבת.
    const insecure = pickCardSource(image("d", { variants: { thumb: { url: "http://evil.example/x.webp" } } }));
    assert.equal(insecure.url, `${API}/approved/u/d.jpg`);
    assert.equal(insecure.isVariant, false);

    // הסניטציה של הגלריה מועברת פנימה (למשל קישורי Drive ישנים).
    const sanitized = pickCardSource({ id: "e", url: "https://drive.example/file" }, () => "https://cdn.example/e.jpg");
    assert.equal(sanitized.url, "https://cdn.example/e.jpg");
});

test("כרטיס של סרטון: thumb, ואם אין poster, ואם אין התמונה המקדימה הישנה", () => {
    const legacy = pickCardSource(video("v1", { thumbnailUrl: `${API}/approved/u/v1_thumb.jpg` }));
    assert.equal(legacy.url, `${API}/approved/u/v1_thumb.jpg`);
    assert.equal(legacy.isVariant, false);

    const posterOnly = pickCardSource(video("v2", { variants: variants("v2", ["poster"]) }));
    assert.equal(posterOnly.url, `${API}/variants/v2/poster.webp`);

    const full = pickCardSource(video("v3", { variants: variants("v3", ["poster", "thumb"]) }));
    assert.equal(full.url, `${API}/variants/v3/thumb.webp`);

    assert.equal(pickCardSource(video("v4")).url, "");
    assert.equal(pickPosterSource(video("v3", { variants: variants("v3", ["poster", "thumb"]) })), `${API}/variants/v3/poster.webp`);
    assert.equal(pickPosterSource(video("v3", { variants: variants("v3", ["poster", "thumb"]) }), undefined, { small: true }), `${API}/variants/v3/thumb.webp`);
    assert.equal(pickPosterSource(image("x", { variants: variants("x") })), "");
});

test("תצוגה מלאה: medium עם srcset של thumb ו-medium, והמקור נשאר להורדה", () => {
    const plain = pickLightboxSource(image("a"));
    assert.deepEqual(plain, { url: `${API}/approved/u/a.jpg`, srcset: "", avifSrcset: "", sizes: "", original: `${API}/approved/u/a.jpg`, fallbackUrl: "" });

    const full = pickLightboxSource(image("b", { variants: variants("b") }));
    assert.equal(full.url, `${API}/variants/b/medium.webp`);
    assert.equal(full.srcset, `${API}/variants/b/thumb.webp 480w, ${API}/variants/b/medium.webp 1280w`);
    assert.equal(full.sizes, "100vw");
    assert.equal(full.original, `${API}/approved/u/b.jpg`);
    assert.equal(full.fallbackUrl, `${API}/approved/u/b.jpg`);

    // תצוגה בלי רוחב ידוע אינה נכנסת ל-srcset.
    const noWidth = pickLightboxSource(image("c", { variants: { medium: { url: `${API}/variants/c/medium.webp` } } }));
    assert.equal(noWidth.url, `${API}/variants/c/medium.webp`);
    assert.equal(noWidth.srcset, "");
    assert.equal(noWidth.sizes, "");

    // סרטון: המקור עצמו, תמיד.
    const clip = pickLightboxSource(video("v", { variants: variants("v", ["poster", "thumb"]) }));
    assert.equal(clip.url, `${API}/approved/u/v.mp4`);
    assert.equal(clip.srcset, "");
});

test("רקע התצוגה המלאה: התצוגה הקטנה ביותר שקיימת, ואם אין — כמו קודם", () => {
    assert.equal(pickBackdropSource(image("a")), `${API}/approved/u/a.jpg`);
    assert.equal(pickBackdropSource(image("b", { variants: variants("b") })), `${API}/variants/b/thumb.webp`);
    assert.equal(pickBackdropSource(image("c", { variants: variants("c", ["medium"]) })), `${API}/variants/c/medium.webp`);
    assert.equal(pickBackdropSource(video("v", { thumbnailUrl: `${API}/approved/u/v_thumb.jpg` })), `${API}/approved/u/v_thumb.jpg`);
    assert.equal(pickBackdropSource(video("w", { variants: variants("w", ["poster"]) })), `${API}/variants/w/poster.webp`);
    assert.equal(pickBackdropSource(video("x")), "");
});

test("needsMediaVariants: תמונה דורשת thumb ו-medium, סרטון דורש poster", () => {
    assert.equal(needsMediaVariants(image("a")), true);
    assert.equal(needsMediaVariants(image("b", { variants: variants("b"), variantsVersion: MEDIA_VARIANTS_VERSION })), false);
    assert.equal(needsMediaVariants(image("c", { variants: variants("c", ["thumb"]), variantsVersion: 1 })), true);
    assert.equal(needsMediaVariants(image("d", { variants: variants("d"), variantsVersion: 0 })), true);
    assert.equal(needsMediaVariants(video("v", { variants: variants("v", ["poster"]), variantsVersion: 1 })), false);
    assert.equal(needsMediaVariants(video("w", { variants: variants("w", ["thumb"]), variantsVersion: 1 })), true);
    assert.equal(needsMediaVariants(null), false);
});

test("ריצת ההשלמה בוחרת רק פריטים בלי תצוגות, בלי כפילויות, ומדלגת על מקורות שאינם נתמכים", () => {
    const records = [
        image("a"),
        image("a"),
        image("b", { variants: variants("b"), variantsVersion: 1 }),
        video("v"),
        { id: "", url: `${API}/approved/u/none.jpg` },
        image("x", { url: "" }),
        { id: "ext", url: "https://lh3.googleusercontent.com/d/abc=w1600", mediaType: "image" }
    ];
    const { candidates, unsupported } = selectVariantCandidates(records, {
        isSupported: candidate => candidate.url.startsWith(API)
    });
    assert.deepEqual(candidates.map(candidate => [candidate.imageId, candidate.isVideo]), [["a", false], ["v", true]]);
    assert.deepEqual(unsupported.map(candidate => candidate.imageId), ["ext"]);
});

test("הריצה אידמפוטנטית: אחרי סבב מוצלח אין יותר מועמדים, וריצה חוזרת אינה מעבדת דבר", async () => {
    const records = [image("a"), image("b"), video("v"), image("done", { variants: variants("done"), variantsVersion: 1 })];
    const processed = [];
    const processItem = async candidate => {
        processed.push(candidate.imageId);
        const record = records.find(item => item.id === candidate.imageId);
        record.variants = variants(candidate.imageId, candidate.isVideo ? ["poster", "thumb"] : ["thumb", "medium"]);
        record.variantsVersion = MEDIA_VARIANTS_VERSION;
    };

    const first = await runVariantBackfill(selectVariantCandidates(records).candidates, processItem, { concurrency: 2 });
    assert.deepEqual(processed.sort(), ["a", "b", "v"]);
    assert.equal(first.succeeded, 3);
    assert.equal(first.failed, 0);
    assert.equal(first.remaining, 0);
    assert.equal(first.stopped, false);

    const again = selectVariantCandidates(records).candidates;
    assert.deepEqual(again, []);
    const second = await runVariantBackfill(again, processItem, { concurrency: 2 });
    assert.equal(second.total, 0);
    assert.equal(processed.length, 3);
});

test("הלולאה מכבדת את המקביליות, ממשיכה אחרי כישלון, ונעצרת בין פריטים", async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => ({ imageId: `img-${index}`, url: `${API}/approved/u/img-${index}.jpg`, isVideo: false, title: `#${index}` }));
    let inFlight = 0;
    let maxInFlight = 0;
    const progress = [];
    const summary = await runVariantBackfill(candidates, async candidate => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight -= 1;
        if (candidate.imageId === "img-2") throw new Error("קובץ פגום");
    }, { concurrency: 3, onProgress: state => progress.push(state.processed) });

    assert.ok(maxInFlight <= 3, `רצו ${maxInFlight} פריטים במקביל`);
    assert.ok(maxInFlight >= 2, "המקביליות לא נוצלה כלל");
    assert.equal(summary.total, 7);
    assert.equal(summary.processed, 7);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.failures, [{ imageId: "img-2", title: "#2", message: "קובץ פגום" }]);
    assert.deepEqual(progress, [1, 2, 3, 4, 5, 6, 7]);

    // עצירה: אחרי הפריט הראשון שהושלם לא מתחילים פריט חדש, והנותרים מדווחים.
    let stop = false;
    const stopped = await runVariantBackfill(candidates, async () => { stop = true; }, {
        concurrency: 1,
        shouldStop: () => stop
    });
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.processed, 1);
    assert.equal(stopped.remaining, 6);
});

test("כרטיס: srcset של thumb ו-medium עם sizes לפי רוחב העמודה", () => {
    const card = pickCardSource(image("s", { variants: variants("s") }));
    assert.equal(card.url, `${API}/variants/s/thumb.webp`);
    assert.equal(card.srcset, `${API}/variants/s/thumb.webp 480w, ${API}/variants/s/medium.webp 1280w`);
    assert.equal(card.sizes, CARD_IMAGE_SIZES);
    assert.equal(card.avifSrcset, "");

    // תצוגה אחת בלבד: אין מה לבחור, ולכן אין srcset.
    const single = pickCardSource(image("t", { variants: variants("t", ["thumb"]) }));
    assert.equal(single.srcset, "");
    assert.equal(single.sizes, "");

    // תמונה בלי תצוגות ממשיכה בדיוק כמו קודם.
    const plain = pickCardSource(image("u"));
    assert.equal(plain.srcset, "");
    assert.equal(plain.sizes, "");
});

test("AVIF: מוצע כ-srcset נפרד רק כשלכל התצוגות שברשימה יש עותק כזה", () => {
    const full = pickCardSource(image("a", { variants: variantsWithAvif("a") }));
    assert.equal(full.avifSrcset, `${API}/variants/a/thumb.avif 480w, ${API}/variants/a/medium.avif 1280w`);
    assert.equal(full.srcset, `${API}/variants/a/thumb.webp 480w, ${API}/variants/a/medium.webp 1280w`);
    assert.equal(full.url, `${API}/variants/a/thumb.webp`);

    // עותק AVIF רק ל-thumb: רשימה חלקית הייתה מטעה את הדפדפן — אין AVIF.
    const partial = pickCardSource(image("b", { variants: variantsWithAvif("b", ["thumb", "medium"], ["thumb"]) }));
    assert.equal(partial.avifSrcset, "");

    // תצוגה יחידה עם AVIF: כתובת אחת בלי מתאר רוחב.
    const single = pickCardSource(image("c", { variants: variantsWithAvif("c", ["thumb"]) }));
    assert.equal(single.avifSrcset, `${API}/variants/c/thumb.avif`);

    const lightbox = pickLightboxSource(image("a", { variants: variantsWithAvif("a") }));
    assert.equal(lightbox.avifSrcset, `${API}/variants/a/thumb.avif 480w, ${API}/variants/a/medium.avif 1280w`);
    assert.equal(lightbox.url, `${API}/variants/a/medium.webp`);
    assert.equal(lightbox.fallbackUrl, `${API}/approved/u/a.jpg`);

    // כתובת AVIF שאינה https נזרקת, והתצוגה הרגילה נשארת.
    const insecure = variants("d");
    insecure.thumb.avif = { url: "http://evil.example/thumb.avif" };
    insecure.medium.avif = { url: "javascript:alert(1)" };
    const guarded = pickCardSource(image("d", { variants: insecure }));
    assert.equal(guarded.avifSrcset, "");
    assert.equal(guarded.url, `${API}/variants/d/thumb.webp`);

    // סרטון: אין AVIF בכרטיס; הפוסטר נשאר WebP/JPEG.
    assert.equal(pickCardSource(video("v", { variants: variantsWithAvif("v", ["poster", "thumb"]) })).avifSrcset, "");
});
