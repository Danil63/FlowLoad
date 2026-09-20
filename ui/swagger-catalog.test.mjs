import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SwaggerCatalog } from './swagger-catalog.mjs';

const methods = [{ method: 'GET', path: '/health', tags: [] }, { method: 'GET', path: '/items', tags: [] }];
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-catalog-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new SwaggerCatalog(path.join(dir, 'catalog.json'));
}
test('multiple documents keep distinct method identities and survive restart', async t => {
  const catalog = await fixture(t);
  await catalog.add('first.json', methods);
  const data = await catalog.add('second.yaml', methods);
  const first = data.sources[0], second = data.sources[1];
  assert.notEqual(first.endpoints[0].catalogMethodId, second.endpoints[0].catalogMethodId);
  await catalog.remove(first.id, first.endpoints[0].catalogMethodId);
  const reopened = new SwaggerCatalog(catalog.file);
  assert.equal(await reopened.invalid([first.endpoints[0]]), true);
  assert.equal(await reopened.invalid([first.endpoints[1]]), false);
  assert.equal(await reopened.invalid(second.endpoints), false);
  assert.equal((await reopened.read()).sources[0].endpoints.length, 1);
});
test('deleting a document blocks its routes and profiles, but keeps other documents', async t => {
  const catalog = await fixture(t);
  const { sources: [source] } = await catalog.add('first.json', methods);
  await catalog.add('other.json', methods);
  const data = await catalog.remove(source.id);
  assert.equal(data.sources.length, 1);
  assert.equal(await catalog.invalid(source.endpoints), true);
  assert.equal(await catalog.invalid(data.sources[0].endpoints), false);
  assert.equal(await catalog.invalid(methods), true, 'legacy scenarios are blocked conservatively');
});
test('reimport does not silently repair old scenarios; rejected import preserves catalog', async t => {
  const catalog = await fixture(t);
  const { sources: [old] } = await catalog.add('api.json', methods);
  await catalog.remove(old.id);
  const { sources: [fresh] } = await catalog.add('api.json', methods);
  assert.equal(await catalog.invalid(old.endpoints), true);
  assert.equal(await catalog.invalid(fresh.endpoints), false);
  await assert.rejects(async () => catalog.add('wrong.json', []));
  assert.equal((await catalog.read()).sources.length, 1);
});
test('migration runs once and concurrent imports are retained', async t => {
  const catalog = await fixture(t);
  await Promise.all([catalog.add('legacy', methods, true), catalog.add('legacy', methods, true)]);
  assert.equal((await catalog.read()).sources.length, 1);
  await Promise.all([catalog.add('A', methods), catalog.add('B', methods)]);
  assert.equal((await catalog.read()).sources.length, 3);
});
test('rejects missing and mismatched references, even without tombstones', async t => {
  const catalog = await fixture(t);
  const { sources: [source] } = await catalog.add('api', methods);
  const item = source.endpoints[0];
  assert.equal(await catalog.invalid([{ ...item, catalogMethodId: 'unknown' }]), true);
  assert.equal(await catalog.invalid([{ ...item, sourceId: 'other-workspace' }]), true);
  assert.equal(await catalog.invalid([{ ...item, path: '/changed' }]), true);
  const invalid = await catalog.validator();
  assert.equal(invalid(item), false);
  await catalog.remove(source.id);
  assert.equal(await catalog.invalid([item]), true);
});

test('catalog schema rejects lost tombstones, duplicate identities and mismatched sources', async t => {
  const catalog = await fixture(t);
  const data = await catalog.add('api', methods);
  const original = data.sources[0].endpoints[0];
  const variants = [
    { initialized: true, sources: [] },
    { ...data, sources: [data.sources[0], data.sources[0]] },
    { ...data, sources: [{ ...data.sources[0], endpoints: [original, original] }] },
    { ...data, sources: [{ ...data.sources[0], endpoints: [{ ...original, sourceId: 'wrong' }] }] },
    { ...data, deleted: [{ sourceId: original.sourceId, catalogMethodId: original.catalogMethodId, key: 'GET /health' }] },
  ];
  for (const variant of variants) {
    await fs.writeFile(catalog.file, JSON.stringify(variant));
    assert.equal((await catalog.storage.inspect()).current, 'invalid');
    await assert.rejects(catalog.read(), { code: 'STORAGE_RECOVERY_REQUIRED' });
    await catalog.storage.recover();
    assert.equal(await catalog.invalid([original]), false);
  }
});
