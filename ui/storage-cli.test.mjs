import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspaces } from './workspaces.mjs';
import { maintainStorage } from './storage-cli.mjs';
import { acquireServerLock } from './server-lock.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('maintenance requires server stop, explicit confirmation and never touches tokens or other workspaces', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-maintenance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Workspaces(root);
  const a = await store.get((await store.save({ name: 'A', baseUrl: 'https://a.example.com' })).id);
  const b = await store.get((await store.save({ name: 'B', baseUrl: 'https://b.example.com' })).id);
  await fs.writeFile(a.tokensFile, 'test-only-secret');
  const { sources: [source] } = await a.swaggerCatalog.add('api', [{ method: 'GET', path: '/items' }]);
  await a.swaggerCatalog.remove(source.id);
  await b.swaggerCatalog.add('api', [{ method: 'GET', path: '/other' }]);
  const bBefore = await fs.readFile(b.swaggerCatalog.file, 'utf8');
  const log = [];
  const command = options => maintainStorage(root, options, line => log.push(line));
  const release = await acquireServerLock(root);
  try { await assert.rejects(command({ action: 'recover', target: 'catalog', workspaceId: a.id, confirm: true }), /уже запущен/); }
  finally { await release(); }
  await command({ action: 'check' });
  // Emulate an old installation without recovery files.
  await fs.unlink(b.swaggerCatalog.storage.backupFile);
  await command({ action: 'backup' });
  assert.equal((await b.swaggerCatalog.storage.inspect()).state, 'healthy');
  await fs.writeFile(a.swaggerCatalog.file, '{broken');
  await assert.rejects(command({ action: 'check' }), /Обнаружены проблемы/);
  await assert.rejects(command({ action: 'recover', target: 'catalog', workspaceId: a.id }), /CONFIRM=1/);
  assert.equal(await fs.readFile(a.swaggerCatalog.file, 'utf8'), '{broken');
  await command({ action: 'recover', target: 'catalog', workspaceId: a.id, confirm: true });
  assert.equal(await a.swaggerCatalog.invalid(source.endpoints), true);
  assert.equal(await a.swaggerCatalog.invalid([{ method: 'GET', path: '/items' }]), true);
  assert.equal((await a.swaggerCatalog.read()).sources.length, 0);
  assert.equal(await fs.readFile(b.swaggerCatalog.file, 'utf8'), bBefore);
  assert.equal(await fs.readFile(a.tokensFile, 'utf8'), 'test-only-secret');
  assert.ok(!log.join('\n').includes('test-only-secret'));
  await fs.writeFile(store.storage.file, '[]');
  await assert.rejects(command({ action: 'check' }), /Обнаружены проблемы/);
  await command({ action: 'recover', target: 'workspaces', confirm: true });
  assert.equal((await new Workspaces(root).list()).length, 3);
  assert.equal((await store.get(a.id)).name, 'A');
  await assert.rejects(command({ action: 'recover', target: 'catalog', workspaceId: '../../outside', confirm: true }));
  await command({ action: 'check' });
});

test('make maintenance commands work end-to-end in an isolated project', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-make-maintenance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ui = path.join(root, 'ui');
  await fs.mkdir(path.join(ui, 'public'), { recursive: true });
  for (const file of ['storage-cli.mjs', 'workspaces.mjs', 'swagger-catalog.mjs', 'recoverable-json.mjs', 'atomic-file.mjs', 'server-lock.mjs', 'package.json', 'public/catalog-state.js']) {
    await fs.copyFile(path.join(here, file), path.join(ui, file));
  }
  await fs.symlink(path.join(here, 'node_modules'), path.join(ui, 'node_modules'));
  await fs.copyFile(path.join(here, '../Makefile'), path.join(root, 'Makefile'));
  const make = (...args) => spawnSync('make', args, { cwd: root, encoding: 'utf8', timeout: 5000 });
  const store = new Workspaces(root);
  await store.save({ name: 'A', baseUrl: 'https://example.com' });
  assert.equal(make('storage-check').status, 0);
  await fs.unlink(store.storage.backupFile);
  assert.equal(make('storage-backup').status, 0);
  await fs.writeFile(store.storage.file, '[]');
  assert.notEqual(make('storage-check').status, 0);
  const preview = make('storage-recover', 'STORE=workspaces');
  assert.notEqual(preview.status, 0);
  assert.match(preview.stderr, /CONFIRM=1/);
  assert.equal(await fs.readFile(store.storage.file, 'utf8'), '[]');
  const restored = make('storage-recover', 'STORE=workspaces', 'CONFIRM=1');
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal((await store.list()).length, 2);
  assert.equal(make('storage-check').status, 0);
});
