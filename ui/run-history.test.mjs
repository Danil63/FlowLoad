import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneRunHistory } from './run-history.mjs';

test('history keeps recent runs and never evicts the active generator', () => {
  const runs = new Map(Array.from({ length: 100 }, (_, id) => [id, { id, status: 'passed', startedAt: id, finishedAt: id + 1 }]));
  runs.set('active', { id: 'active', status: 'running', startedAt: 0 });
  pruneRunHistory(runs, { now: 101, limit: 30, ttl: 1000 });
  assert.equal(runs.size, 30);
  assert.equal(runs.has(70), false);
  assert.equal(runs.has(71), true);
  assert.equal(runs.has('active'), true);
});

test('expired completed runs are removed even below the count limit', () => {
  const runs = new Map([
    ['old', { id: 'old', status: 'failed', startedAt: 0, finishedAt: 10 }],
    ['new', { id: 'new', status: 'passed', startedAt: 15, finishedAt: 25 }],
    ['active', { id: 'active', status: 'running', startedAt: 0 }],
  ]);
  pruneRunHistory(runs, { now: 30, ttl: 20 });
  assert.deepEqual([...runs.keys()], ['new', 'active']);
  pruneRunHistory(runs, { now: 100, ttl: 20, limit: 0 });
  assert.deepEqual([...runs.keys()], ['active']);
});
