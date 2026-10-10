let running = false;
let stopped = false;
let candidates = [];
const element = id => document.getElementById(id);

async function refresh() {
    const { collection, getDocs } = window.firestoreModules;
    const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images'));
    const records = [];
    snapshot.forEach(item => records.push({ ...item.data(), id: item.id }));
    const images = records.filter(record => record.mediaType !== 'video');
    candidates = images.filter(record => record.aiTitleVersion !== 1 && String(record.r2Key || '').startsWith('approved/'));
    element('aiTitlesSummary').textContent = `${images.filter(record => record.aiTitleVersion === 1).length} תמונות עם שם AI · ${candidates.length} תמונות ממתינות`;
}

async function start() {
    if (running) return;
    running = true;
    stopped = false;
    element('aiTitlesStart').disabled = true;
    element('aiTitlesStop').disabled = false;
    element('aiTitlesFailures').replaceChildren();
    let done = 0;
    let failed = 0;
    try {
        await refresh();
        const queue = [...candidates];
        for (const record of queue) {
            if (stopped) break;
            element('aiTitlesStatus').textContent = `מעבד תמונה ${done + failed + 1} מתוך ${queue.length}…`;
            try {
                const result = await window.r2Request('/ai-title', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageId: record.id })
                });
                done += 1;
                const local = window.state.images?.find(image => image.id === record.id);
                if (local) {
                    local.title = result.title;
                    local.aiTitleVersion = 1;
                    window.noteGalleryImageUpserted?.(local);
                }
            } catch (error) {
                failed += 1;
                const line = document.createElement('p');
                line.textContent = `${record.title || record.id}: ${error.message || 'העיבוד נכשל'}`;
                element('aiTitlesFailures').append(line);
                // אין טעם לשלוח את שאר הגלריה לספק שאינו זמין או למכסה מלאה.
                if ([429, 502, 503].includes(error.status) || /מכסה|יתרה|מפתח|עמוס|מנוע ה־AI/.test(error.message || '')) {
                    stopped = true;
                }
            }
        }
        element('aiTitlesStatus').textContent = `${stopped ? 'הריצה נעצרה' : 'הריצה הסתיימה'} · ${done} שמות נשמרו · ${failed} נכשלו. אפשר להמשיך; תמונות שכבר עובדו ידולגו.`;
        await refresh();
        window.renderImages?.();
    } catch (error) {
        element('aiTitlesStatus').textContent = error.message || 'לא ניתן לקרוא את התמונות. נסה שוב.';
    } finally {
        running = false;
        element('aiTitlesStart').disabled = false;
        element('aiTitlesStop').disabled = true;
    }
}

export async function openAiTitles() {
    element('aiTitlesStart').onclick = start;
    element('aiTitlesStop').onclick = () => {
        stopped = true;
        element('aiTitlesStop').disabled = true;
        element('aiTitlesStatus').textContent = 'מסיים את התמונה הנוכחית ועוצר…';
    };
    if (running) return;
    try {
        await refresh();
        element('aiTitlesStatus').textContent = 'מוכן. השם המקורי נשמר לצד שם ה־AI.';
    } catch (error) {
        element('aiTitlesStatus').textContent = error.message || 'החיבור לענן עדיין לא מוכן. פתח את המסך שוב.';
    }
}
