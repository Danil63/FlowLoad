import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspaces } from './workspaces.mjs';

test('legacy project paths stay intact; new projects and catalogs are isolated', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspaces-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Workspaces(root);
  assert.equal((await store.get()).tokensFile, path.join(root, 'load-testing/k6/tokens.txt'));
  const projects = await Promise.all(['A', 'B'].map(name => store.save({ name, baseUrl: 'https://example.com/v1/' })));
  const [a, b] = await Promise.all(projects.map(p => store.get(p.id)));
  assert.notEqual(a.tokensFile, b.tokensFile);
  assert.notEqual(a.routesDir, b.routesDir);
  assert.notEqual(a.resultsDir, b.resultsDir);
  await fs.writeFile(a.tokensFile, 'test-token');
  assert.equal(await fs.readFile(b.tokensFile, 'utf8'), '');
  await a.swaggerCatalog.add('api', [{ method: 'GET', path: '/' }]);
  assert.equal((await b.swaggerCatalog.read()).sources.length, 0);
  await store.save({ name: 'Renamed', baseUrl: 'https://new.example.com' }, a.id);
  const reopened = new Workspaces(root);
  assert.equal((await reopened.list()).length, 3);
  assert.equal((await reopened.get(a.id)).name, 'Renamed');
  assert.equal(await fs.readFile((await reopened.get(a.id)).tokensFile, 'utf8'), 'test-token');
  await assert.rejects(store.get('../../outside'));
});

test('rejects unsafe API URLs and invalid names', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspaces-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Workspaces(root);
  for (const baseUrl of ['file:///tmp', 'https://user:secret@example.com', 'https://example.com/$(echo)', 'https://example.com/`echo`', 'https://example.com?q=a']) {
    await assert.rejects(store.save({ name: 'test', baseUrl }));
  }
  await assert.rejects(store.save({ name: '', baseUrl: 'https://example.com' }));
  assert.equal((await store.list()).length, 1);
});
