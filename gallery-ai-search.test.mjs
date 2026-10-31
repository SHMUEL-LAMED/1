import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./gallery.js', import.meta.url), 'utf8');
const execute = source.slice(source.indexOf('window.executeAiImageSearch = async function()'), source.indexOf('// חשיפה ל-window'));
function setup(result) {
  const requests = [], messages = [];
  const elements = new Map([
    ['aiImageSearchQuery', { value: 'ריקודים באולם' }],
    ['aiImageSearchSubmitBtn', { disabled: false }],
    ['aiImageSearchStatus', { classList: { remove() {} } }]
  ]);
  const window = {
    state: { images: [], imagesHasMore: true, activeFolderId: 'all', currentUser: { uid: 'viewer' } },
    async loadMoreImages() { throw new Error('Search must not load the gallery'); },
    async r2Request(path, options) { requests.push({path, body: JSON.parse(options.body)}); return typeof result === 'function' ? result(window) : result; },
    safeRecordId: x => x, renderImages() {}, closeModal() {}, showNotification(...args) { messages.push(args); }
  };
  new Function('window', 'document', 'showAiSearchResultBanner', execute)(window, { getElementById: id => elements.get(id) }, () => {});
  return { window, requests, elements, messages };
}
test('one index query returns records that were never loaded, without sending images', async () => {
  const { window, requests, elements } = setup({ mode: 'indexed', indexed: 1000, pending: 0, documents: [{ id: 'photo999', data: { title: 'לימוד' } }] });
  await window.executeAiImageSearch();
  assert.deepEqual(requests, [{path: '/ai-search', body: {query: 'ריקודים באולם'}}]);
  assert.deepEqual(window.state.tempSearchResults.map(x => x.id), ['photo999']);
  assert.equal(elements.get('aiImageSearchSubmitBtn').disabled, false);
});
test('unprepared index explains the background preparation and keeps the modal open', async () => {
  const { window, elements } = setup({ mode: 'indexed', indexed: 0, pending: 100 });
  await window.executeAiImageSearch();
  assert.match(elements.get('aiImageSearchStatus').textContent, /100.*ממתינות/);
  assert.equal(window.state.tempSearchResults, undefined);
});
test('account switch discards in-flight results', async () => {
  const { window } = setup(window => { window.state.currentUser = {uid: 'other'}; return { mode: 'indexed', indexed: 1, documents: [{id:'private',data:{}}] }; });
  await window.executeAiImageSearch();
  assert.equal(window.state.tempSearchResults, undefined);
});
test('folder scope is sent to the server', async () => {
  const { window, requests } = setup({ mode: 'indexed', indexed: 0, pending: 0, documents: [] });
  window.state.activeFolderId = 'folderA';
  await window.executeAiImageSearch();
  assert.equal(requests[0].body.folderId, 'folderA');
});
