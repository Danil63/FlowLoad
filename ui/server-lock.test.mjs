import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireServerLock } from './server-lock.mjs';

test('lock is exclusive per real project directory and released cleanly', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-lock-'));
  const releases = [];
  t.after(async () => { for (const release of releases) await release(); await fs.rm(parent, { recursive: true, force: true }); });
  const a = path.join(parent, 'a');
  const b = path.join(parent, 'b');
  const alias = path.join(parent, 'alias');
  await fs.mkdir(a);
  await fs.mkdir(b);
  await fs.symlink(a, alias);
  const release = await acquireServerLock(a);
  try {
    await assert.rejects(acquireServerLock(a), /FlowLoad уже запущен/);
    await assert.rejects(acquireServerLock(alias), /FlowLoad уже запущен/);
    releases.push(await acquireServerLock(b));
  } finally { await release(); }
  releases.push(await acquireServerLock(a));
});

test('an abandoned lock older than the heartbeat timeout can be recovered', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-stale-lock-'));
  const lock = path.join(root, 'ui/.local/server.lock');
  await fs.mkdir(lock, { recursive: true });
  const old = new Date(Date.now() - 60000);
  await fs.utimes(lock, old, old);
  const release = await acquireServerLock(root);
  t.after(async () => { await release(); await fs.rm(root, { recursive: true, force: true }); });
  await assert.rejects(acquireServerLock(root), /FlowLoad уже запущен/);
});
