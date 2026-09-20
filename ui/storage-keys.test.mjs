import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDraftKey, browserDraftStorage } from './public/storage-keys.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('open tabs keep independent drafts and a new tab restores the latest backup', () => {
  const disk = memoryStorage();
  const sessionA = memoryStorage();
  const sessionB = memoryStorage();
  const a = browserDraftStorage(() => disk, () => sessionA);
  const b = browserDraftStorage(() => disk, () => sessionB);
  a.setItem('flowload:route:a', 'A draft with old base revision');
  assert.equal(b.getItem('flowload:route:a'), 'A draft with old base revision');
  b.setItem('flowload:route:a', 'B draft with new base revision');
  assert.equal(a.getItem('flowload:route:a'), 'A draft with old base revision');
  assert.equal(browserDraftStorage(() => disk, () => sessionA).getItem('flowload:route:a'), 'A draft with old base revision');
  a.setItem('flowload:route:b', 'Other workspace');
  assert.equal(b.getItem('flowload:route:a'), 'B draft with new base revision');
  const sessionC = memoryStorage();
  const newTab = browserDraftStorage(() => disk, () => sessionC);
  assert.equal(newTab.getItem('flowload:route:a'), 'B draft with new base revision');
});

test('a failed shared backup does not destroy the tab working copy', () => {
  const own = memoryStorage();
  const unavailable = () => { throw new Error('denied'); };
  const storage = browserDraftStorage(unavailable, () => own);
  assert.throws(() => storage.setItem('draft', 'retained'), /denied/);
  assert.equal(storage.getItem('draft'), 'retained');
});

test('migrates drafts without overwriting newer FlowLoad data or crossing workspaces', () => {
  const values = new Map([
    ['bigJourneyK6RouteBuilder', 'default draft'],
    ['bigJourneyK6RouteBuilder:a', 'a draft'],
    ['bigJourneyK6RouteBuilder:b', 'b draft'],
    ['flowload:route:b', 'new b draft'],
    ['bigJourneyK6LoadProfileBuilder:a', 'a profile'],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  assert.equal(values.get(workspaceDraftKey(storage, 'route', 'default')), 'default draft');
  assert.equal(values.get(workspaceDraftKey(storage, 'route', 'a')), 'a draft');
  assert.equal(values.get(workspaceDraftKey(storage, 'route', 'b')), 'new b draft');
  assert.equal(values.get(workspaceDraftKey(storage, 'profile', 'a')), 'a profile');
  assert.equal(storage.getItem(workspaceDraftKey(storage, 'profile', 'b')), null);
  assert.equal(values.has('bigJourneyK6RouteBuilder:a'), false);
});

test('does not remove legacy data if browser storage refuses a write', () => {
  let removed = false;
  workspaceDraftKey({ getItem: key => key.startsWith('flowload:') ? null : 'draft', setItem() { throw new Error('quota'); }, removeItem() { removed = true; } }, 'route', 'default');
  assert.equal(removed, false);
});
