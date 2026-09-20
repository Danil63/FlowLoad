import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecoverableJson } from './recoverable-json.mjs';

const validate = value => {
  if (!value || !Number.isInteger(value.count) || value.count < 0) throw new Error('Bad structure');
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new RecoverableJson(path.join(dir, 'state.json'), { initial: { count: 0 }, validate, label: 'Test', scope: 'test' });
}
const recoveryError = { code: 'STORAGE_RECOVERY_REQUIRED', status: 503 };

test('fresh storage and legacy JSON remain compatible; checkpoint protects legacy data', async t => {
  const store = await fixture(t);
  const first = await store.read();
  first.count = 10;
  assert.equal((await store.read()).count, 0);
  assert.equal((await store.inspect()).state, 'empty');
  assert.equal(await store.checkpoint(), false);
  await fs.writeFile(store.file, '{ "count": 9 }');
  assert.equal((await store.inspect()).state, 'unprotected');
  assert.equal(await store.checkpoint(), true);
  assert.equal((await store.inspect()).state, 'healthy');
  assert.equal((await store.read()).count, 9);
  assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(store.backupFile)).mode & 0o777, 0o600);
});

test('corrupt or absent primary never becomes empty and explicit recovery preserves original bytes', async t => {
  const store = await fixture(t);
  await store.update(value => { value.count = 7; });
  for (const raw of ['{"secret-fragment":', '[]', '{"count":3}']) {
    await fs.writeFile(store.file, raw);
    await assert.rejects(store.read(), recoveryError);
    await assert.rejects(store.update(value => { value.count = 0; }), recoveryError);
    assert.equal(await fs.readFile(store.file, 'utf8'), raw);
    const result = await store.recover();
    assert.equal(await fs.readFile(result.archive, 'utf8'), raw);
    assert.equal((await fs.stat(result.archive)).mode & 0o777, 0o600);
    assert.equal((await store.read()).count, 7);
  }
  await fs.unlink(store.file);
  await assert.rejects(store.read(), recoveryError);
  assert.equal((await store.recover()).archive, null);
  assert.equal((await store.read()).count, 7);
  assert.equal((await store.recover()).changed, false);
  const binaryDamage = Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x80]);
  await fs.writeFile(store.file, binaryDamage);
  const archived = (await store.recover()).archive;
  assert.deepEqual(await fs.readFile(archived), binaryDamage);
});

test('no valid backup means fail closed, with no reset or leaked raw data', async t => {
  const store = await fixture(t);
  await fs.writeFile(store.file, 'private-fragment');
  await assert.rejects(store.read(), error => error.code === recoveryError.code && !error.message.includes('private-fragment'));
  await assert.rejects(store.recover(), recoveryError);
  assert.equal(await fs.readFile(store.file, 'utf8'), 'private-fragment');
  await fs.writeFile(store.file, '{"count":1}');
  await store.checkpoint();
  const record = JSON.parse(await fs.readFile(store.backupFile, 'utf8'));
  for (const broken of ['{', JSON.stringify({ ...record, data: { count: 2 } }), JSON.stringify({ ...record, scope: 'another-workspace' })]) {
    await fs.writeFile(store.backupFile, broken);
    await assert.rejects(store.read(), recoveryError);
    await assert.rejects(store.recover(), recoveryError);
    await assert.rejects(store.checkpoint(), recoveryError);
    assert.equal(await fs.readFile(store.file, 'utf8'), '{"count":1}');
  }
});

test('interrupted primary write recovers the new intent, not the previous state', async t => {
  const store = await fixture(t);
  await store.update(value => { value.count = 1; });
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === store.file) throw Object.assign(new Error('Simulated write failure'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(store.update(value => { value.count = 2; }), recoveryError);
  t.mock.restoreAll();
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).count, 1);
  await assert.rejects(store.read(), recoveryError);
  await store.recover();
  assert.equal((await store.read()).count, 2);
});

test('failed backup write leaves the prior complete state usable', async t => {
  const store = await fixture(t);
  await store.update(value => { value.count = 1; });
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === store.backupFile) throw Object.assign(new Error('Simulated backup failure'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(store.update(value => { value.count = 2; }), { code: 'EIO' });
  t.mock.restoreAll();
  assert.equal((await store.read()).count, 1);
  assert.equal((await store.inspect()).state, 'healthy');
  assert.equal((await fs.readdir(path.dirname(store.file))).filter(name => name.endsWith('.tmp')).length, 0);
});

test('concurrent reads do not observe half-written pairs and changes are serialized', async t => {
  const store = await fixture(t);
  const results = [];
  for (let i = 0; i < 20; i++) {
    results.push(store.update(value => { value.count += 1; }));
    results.push(store.read());
  }
  const values = await Promise.all(results);
  assert.deepEqual(values.map(value => value.count), Array.from({ length: 40 }, (_, index) => Math.floor(index / 2) + 1));
});
