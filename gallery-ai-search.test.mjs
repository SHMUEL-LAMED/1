import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./gallery.js', import.meta.url), 'utf8');
const execute = source.slice(source.indexOf('window.executeAiImageSearch = async function()'), source.indexOf('// חשיפה ל-window'));

test('AI search loads remaining pages and searches images beyond the former 80 limit', async () => {
  const records = Array.from({ length: 81 }, (_, i) => ({ id: `photo${i}`, url: `https://example.com/${i}.jpg` }));
  const elements = new Map([
    ['aiImageSearchQuery', { value: 'ריקודים באולם' }],
    ['aiImageSearchSubmitBtn', { disabled: false }],
    ['aiImageSearchStatus', { classList: { remove() {} } }]
  ]);
  const batches = [];
  const window = {
    state: { images: records.slice(0, 10), imagesHasMore: true, folders: [], activeFolderId: 'all' },
    async loadMoreImages() { this.state.images = records; this.state.imagesHasMore = false; return { added: 71, done: true }; },
    isVideoRecord: () => false, safeRecordId: x => x, safeImageUrl: x => x,
    renderImages() {}, closeModal() {}, showNotification() {}
  };
  new Function('window', 'document', 'requestAiSearchBatch', 'aiSearchDelay', 'AI_SEARCH_BATCH_SIZE', 'AI_SEARCH_BATCH_DELAY_MS', 'showAiSearchResultBanner', execute)(
    window, { getElementById: id => elements.get(id) },
    async (_query, batch) => { batches.push(batch); return { matches: batch.some(x => x.id === 'photo80') ? ['photo80'] : [] }; },
    async () => {}, 8, 0, () => {}
  );
  await window.executeAiImageSearch();
  assert.equal(batches.flat().length, 81);
  assert.deepEqual(window.state.tempSearchResults.map(x => x.id), ['photo80']);
  assert.equal(elements.get('aiImageSearchSubmitBtn').disabled, false);
});
