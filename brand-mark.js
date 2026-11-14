// brand-mark.js — הלוגו של הגלריה: חותם (מעוין פליז בתוך טבעת כפולה) וטקסט.
//
// הלוגו הזה מצויר בשלושה מקומות, ותמיד מאותו קוד:
//   • סימן המים בתמונות שיורדות (download-privacy-ui.js),
//   • הסרטון שנוצר מתמונות האלבום (video-maker-ui.js),
//   • התצוגה המקדימה במסך "הורדות ופרטיות" בלוח הניהול.
//
// החלק העליון של הקובץ טהור (בלי DOM, נבדק ב-Node): נרמול ההגדרות ומיקום
// הלוגו בתמונה. drawBrandMark מקבל הקשר ציור של Canvas 2D, ולכן גם הוא נבדק
// ב-Node מול הקשר מדומה שרושם את הקריאות.

export const BRAND_STYLES = Object.freeze(['seal', 'badge', 'text']);
export const BRAND_POSITIONS = Object.freeze(['bottom-left', 'bottom-right', 'top-left', 'top-right', 'center']);
export const BRAND_SIZES = Object.freeze(['s', 'm', 'l']);

export const DEFAULT_BRAND_STYLE = 'seal';
export const DEFAULT_BRAND_POSITION = 'bottom-left';
export const DEFAULT_BRAND_SIZE = 'm';
export const DEFAULT_BRAND_OPACITY = 0.82;
export const BRAND_OPACITY_MIN = 0.25;
export const BRAND_OPACITY_MAX = 1;

// היחס בין גובה הלוגו לצלע הקצרה של התמונה, לפי הגודל שנבחר.
const SIZE_RATIO = { s: 0.032, m: 0.045, l: 0.064 };
export const BRAND_MIN_FONT = 11;
export const BRAND_MAX_FONT = 120;

export const BRAND_LABELS = Object.freeze({
    style: { seal: 'חותם וטקסט', badge: 'תווית זכוכית', text: 'טקסט בלבד' },
    position: {
        'bottom-left': 'למטה משמאל',
        'bottom-right': 'למטה מימין',
        'top-left': 'למעלה משמאל',
        'top-right': 'למעלה מימין',
        center: 'במרכז'
    },
    size: { s: 'קטן', m: 'בינוני', l: 'גדול' }
});

const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);

export function normalizeBrandOpacity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_BRAND_OPACITY;
    const clamped = Math.min(BRAND_OPACITY_MAX, Math.max(BRAND_OPACITY_MIN, number));
    return Math.round(clamped * 100) / 100;
}

// ההגדרות של הלוגו מתוך מסמך ההורדות (שדות watermark*). ערך לא מוכר חוזר
// לברירת המחדל, כך שמסמך ישן (בלי השדות החדשים) מצייר את החותם הרגיל.
export function normalizeBrandOptions(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        style: pick(source.watermarkStyle ?? source.style, BRAND_STYLES, DEFAULT_BRAND_STYLE),
        position: pick(source.watermarkPosition ?? source.position, BRAND_POSITIONS, DEFAULT_BRAND_POSITION),
        size: pick(source.watermarkSize ?? source.size, BRAND_SIZES, DEFAULT_BRAND_SIZE),
        opacity: normalizeBrandOpacity(source.watermarkOpacity ?? source.opacity)
    };
}

// המידות של הלוגו בתמונה בגודל width×height.
// measure(fontSize) מחזיר את רוחב הטקסט בגופן הזה. טקסט ארוך מהתמונה מוקטן
// עד שהלוגו כולו נכנס (ולא מתחת למינימום הקריא).
export function brandMarkLayout(width, height, options = {}, measure = () => 0) {
    const { style, position, size } = normalizeBrandOptions(options);
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const shortSide = Math.min(w, h);
    let fontSize = Math.round(shortSide * SIZE_RATIO[size]);
    fontSize = Math.max(BRAND_MIN_FONT, Math.min(BRAND_MAX_FONT, fontSize));

    const geometry = font => {
        const seal = style === 'text' ? 0 : Math.round(font * 1.9);
        const gap = style === 'text' ? 0 : Math.round(font * 0.6);
        const padX = style === 'badge' ? Math.round(font * 0.9) : 0;
        const padY = style === 'badge' ? Math.round(font * 0.55) : 0;
        const textWidth = Math.max(0, Number(measure(font)) || 0);
        const boxWidth = padX * 2 + seal + gap + textWidth;
        const boxHeight = Math.max(seal, Math.round(font * 1.3)) + padY * 2;
        return { seal, gap, padX, padY, textWidth, boxWidth, boxHeight };
    };

    const margin = Math.max(6, Math.round(shortSide * 0.028));
    const available = Math.max(1, w - margin * 2);
    let g = geometry(fontSize);
    if (g.boxWidth > available) {
        fontSize = Math.max(BRAND_MIN_FONT, Math.floor(fontSize * available / g.boxWidth));
        g = geometry(fontSize);
    }

    let x;
    let y;
    if (position === 'center') {
        x = Math.round((w - g.boxWidth) / 2);
        y = Math.round((h - g.boxHeight) / 2);
    } else {
        x = position.endsWith('left') ? margin : w - margin - g.boxWidth;
        y = position.startsWith('top') ? margin : h - margin - g.boxHeight;
    }
    return { style, position, fontSize, margin, x, y, width: g.boxWidth, height: g.boxHeight, ...g };
}

// --- הציור ---

function roundedRect(context, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.arcTo(x + width, y, x + width, y + r, r);
    context.lineTo(x + width, y + height - r);
    context.arcTo(x + width, y + height, x + width - r, y + height, r);
    context.lineTo(x + r, y + height);
    context.arcTo(x, y + height, x, y + height - r, r);
    context.lineTo(x, y + r);
    context.arcTo(x, y, x + r, y, r);
    context.closePath();
}

function gold(context, x, y, size) {
    if (typeof context.createLinearGradient !== 'function') return '#E7C27D';
    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, '#FBE7B5');
    gradient.addColorStop(0.45, '#E2B866');
    gradient.addColorStop(1, '#A8742C');
    return gradient;
}

// החותם: טבעת כפולה, ובמרכזה מעוין (ה"סרגל" של מערכת העיצוב) עם ניצוץ.
function drawSeal(context, cx, cy, size) {
    const radius = size / 2;
    const fill = gold(context, cx - radius, cy - radius, size);
    context.save();
    // רקע כהה שקוף, כדי שהחותם ייקרא גם על שמיים לבנים.
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(12, 14, 28, 0.55)';
    context.fill();

    context.lineWidth = Math.max(1, size * 0.06);
    context.strokeStyle = fill;
    context.beginPath();
    context.arc(cx, cy, radius - context.lineWidth / 2, 0, Math.PI * 2);
    context.stroke();

    context.lineWidth = Math.max(0.75, size * 0.025);
    context.beginPath();
    context.arc(cx, cy, radius * 0.74, 0, Math.PI * 2);
    context.stroke();

    // המעוין
    const d = radius * 0.46;
    context.beginPath();
    context.moveTo(cx, cy - d);
    context.lineTo(cx + d * 0.78, cy);
    context.lineTo(cx, cy + d);
    context.lineTo(cx - d * 0.78, cy);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    // ניצוץ קטן בפינת המעוין
    const s = radius * 0.16;
    const sx = cx + radius * 0.34;
    const sy = cy - radius * 0.34;
    context.beginPath();
    context.moveTo(sx, sy - s);
    context.quadraticCurveTo(sx, sy, sx + s, sy);
    context.quadraticCurveTo(sx, sy, sx, sy + s);
    context.quadraticCurveTo(sx, sy, sx - s, sy);
    context.quadraticCurveTo(sx, sy, sx, sy - s);
    context.fillStyle = '#FFF6DE';
    context.fill();
    context.restore();
}

// מצייר את הלוגו על הקשר Canvas 2D בגודל width×height. מחזיר את המידות.
// הטקסט עברי ומצויר מימין לשמאל; החותם בצד ה"התחלה" של השורה (מימין).
export function drawBrandMark(context, width, height, text, options = {}, fontFamily = 'sans-serif') {
    const fontFor = size => `700 ${size}px ${fontFamily}`;
    const layout = brandMarkLayout(width, height, options, size => {
        context.font = fontFor(size);
        return context.measureText(text).width;
    });
    const { opacity } = normalizeBrandOptions(options);
    context.save();
    context.globalAlpha = opacity;

    if (layout.style === 'badge') {
        roundedRect(context, layout.x, layout.y, layout.width, layout.height, layout.height / 2);
        context.fillStyle = 'rgba(10, 12, 26, 0.48)';
        context.fill();
        context.lineWidth = Math.max(1, layout.fontSize * 0.06);
        context.strokeStyle = 'rgba(255, 236, 196, 0.45)';
        context.stroke();
    }

    const innerX = layout.x + layout.padX;
    const centerY = layout.y + layout.height / 2;
    const textRight = layout.x + layout.width - layout.padX - (layout.seal ? layout.seal + layout.gap : 0);

    if (layout.seal) drawSeal(context, layout.x + layout.width - layout.padX - layout.seal / 2, centerY, layout.seal);

    context.font = fontFor(layout.fontSize);
    context.direction = 'rtl';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = Math.max(2, Math.round(layout.fontSize * 0.25));
    context.shadowOffsetY = Math.max(1, Math.round(layout.fontSize * 0.05));
    context.fillStyle = layout.style === 'text' ? 'rgba(255, 255, 255, 0.92)' : '#FFF4DC';
    context.fillText(text, Math.max(innerX + layout.textWidth, textRight), centerY);
    context.restore();
    return layout;
}
