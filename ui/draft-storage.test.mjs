import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftWriter } from './public/draft-storage.js';
import { browserDraftStorage, workspaceDraftKey } from './public/storage-keys.js';

test('blocked browser storage does not prevent initialization or migration', () => {
  const storage = browserDraftStorage(() => { throw new Error('SecurityError'); });
  assert.equal(workspaceDraftKey(storage, 'route', 'default'), 'flowload:route');
  let errors = 0;
  const writer = createDraftWriter(storage, { schedule: () => 1, cancel() {}, onError: () => errors++ });
  writer.save('flowload:route', () => ({ route: [] }));
  assert.doesNotThrow(() => writer.flush());
  assert.equal(errors, 1);
});

function fixture(options = {}) {
  const values = new Map();
  const callbacks = new Map();
  let sequence = 0;
  let writes = 0;
  const writer = createDraftWriter({ setItem(key, value) { writes++; values.set(key, value); } }, {
    schedule(callback) { const id = ++sequence; callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); }, ...options,
  });
  return { writer, values, callbacks, writes: () => writes };
}

test('rapid edits coalesce before serialization and identical drafts are not written again', () => {
  const f = fixture();
  let snapshots = 0;
  let value = 0;
  const snapshot = () => { snapshots++; return { value }; };
  for (; value < 100; value++) f.writer.save('workspace-a', snapshot);
  assert.equal(f.callbacks.size, 1);
  assert.equal(snapshots, 0);
  [...f.callbacks.values()][0]();
  assert.equal(snapshots, 1);
  assert.equal(f.writes(), 1);
  assert.deepEqual(JSON.parse(f.values.get('workspace-a')), { value: 100 });
  f.writer.save('workspace-a', snapshot);
  f.writer.flush();
  assert.equal(f.writes(), 1);
  assert.equal(f.callbacks.size, 0);
});

test('explicit flush saves both pending workspace drafts before navigation', () => {
  const f = fixture();
  f.writer.save('route:a', () => ({ steps: [1] }));
  f.writer.save('profile:a', () => ({ vus: 50 }));
  f.writer.flush();
  assert.equal(f.values.size, 2);
  assert.equal(f.callbacks.size, 0);
  f.writer.save('route:b', () => ({ steps: [2] }));
  f.writer.flush();
  assert.deepEqual(JSON.parse(f.values.get('route:a')), { steps: [1] });
});

test('quota failure preserves the previous draft and retries without throwing', () => {
  const values = new Map([['draft', 'previous']]);
  let fail = true;
  let errors = 0;
  let successes = 0;
  const writer = createDraftWriter({ setItem(key, value) {
    if (fail) throw new Error('QuotaExceededError');
    values.set(key, value);
  } }, { schedule: () => 1, cancel() {}, onError: () => errors++, onSuccess: () => successes++ });
  writer.save('draft', () => ({ latest: true }));
  assert.doesNotThrow(() => writer.flush());
  assert.equal(values.get('draft'), 'previous');
  assert.equal(errors, 1);
  assert.equal(successes, 0);
  fail = false;
  writer.flush();
  assert.deepEqual(JSON.parse(values.get('draft')), { latest: true });
  assert.equal(successes, 1);
});
