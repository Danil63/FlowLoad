import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSavedDocuments, readSavedDocument, validateSavedDocument, savedDocumentError } from './saved-documents.mjs';

test('one broken document does not hide healthy files or expose their contents', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-documents-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'good.route.json'), JSON.stringify({ name: 'Good', steps: [{ method: 'GET', path: '/items' }] }));
  await fs.writeFile(path.join(dir, 'bad.route.json'), '{"secret-do-not-expose":');
  await fs.writeFile(path.join(dir, 'empty.route.json'), '{"name":"Empty","steps":[]}');
  await fs.writeFile(path.join(dir, 'ignore.tmp'), 'partial');
  const rows = await listSavedDocuments(dir, '.route.json', data => {
    validateSavedDocument(data, 'route');
    return { name: data.name, stepsCount: data.steps.length, invalid: false };
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Good');
  assert.equal(rows[0].invalid, false);
  assert.equal(rows.filter(row => row.fileError === savedDocumentError).length, 2);
  assert.ok(!JSON.stringify(rows).includes('secret-do-not-expose'));
  assert.equal((await readSavedDocument(path.join(dir, 'good.route.json'), 'route')).steps.length, 1);
  await assert.rejects(readSavedDocument(path.join(dir, 'bad.route.json'), 'route'), { message: savedDocumentError });
  await assert.rejects(readSavedDocument(path.join(dir, 'empty.route.json'), 'route'), { message: savedDocumentError });
  assert.equal(await fs.readFile(path.join(dir, 'bad.route.json'), 'utf8'), '{"secret-do-not-expose":');
  assert.deepEqual(await listSavedDocuments(path.join(dir, 'missing'), '.route.json', data => data), []);
  await assert.rejects(listSavedDocuments(path.join(dir, 'good.route.json'), '.route.json', data => data), { code: 'ENOTDIR' });
});

test('profile validation rejects malformed targets before launching k6', () => {
  const valid = { name: 'Load', targets: [{ method: 'GET', path: '/items', weight: 10 }] };
  assert.equal(validateSavedDocument(valid, 'profile'), valid);
  for (const target of [null, { method: '', path: '/' }, { method: 'GET', path: 'items', weight: 10 },
    { method: 'GET', path: '/', weight: -1 }, { method: 'GET', path: '/', weight: 'NaN' }]) {
    assert.throws(() => validateSavedDocument({ name: 'Bad', targets: [target] }, 'profile'));
  }
});
