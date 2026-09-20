import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentRevision, readDocumentSnapshot, requireDocumentRevision } from './document-revisions.mjs';
import { revisionForSave } from './public/editor-revision.js';

test('legacy files get content revisions without modifying the stored format', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-revision-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'legacy.route.json');
  const initial = '{"name":"legacy","steps":[]}';
  await requireDocumentRevision(file, null, { create: true });
  await fs.writeFile(file, initial);
  const snapshot = await readDocumentSnapshot(file);
  assert.equal(snapshot.revision, documentRevision(initial));
  assert.equal(await fs.readFile(file, 'utf8'), initial);
  await requireDocumentRevision(file, snapshot.revision);
  await assert.rejects(requireDocumentRevision(file, null, { create: true }), { status: 409, code: 'REVISION_CONFLICT' });
  await fs.writeFile(file, initial + '\n');
  await assert.rejects(requireDocumentRevision(file, snapshot.revision), { code: 'REVISION_CONFLICT' });
  const changed = await readDocumentSnapshot(file);
  assert.notEqual(changed.revision, snapshot.revision);
  await requireDocumentRevision(file, changed.revision);
  await fs.unlink(file);
  await assert.rejects(requireDocumentRevision(file, changed.revision, { create: true }), { code: 'REVISION_CONFLICT' });
  await requireDocumentRevision(file, null, { create: true });
});

test('a revision can protect deletion even when JSON is malformed', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-revision-bad-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bad.json');
  await fs.writeFile(file, '{broken');
  const { revision } = await readDocumentSnapshot(file);
  await requireDocumentRevision(file, revision);
  await fs.writeFile(file, '{}');
  await assert.rejects(requireDocumentRevision(file, revision), { code: 'REVISION_CONFLICT' });
});

test('renaming creates a copy without borrowing the original revision', () => {
  const base = { name: 'original', revision: 'observed-version' };
  assert.equal(revisionForSave(base, 'original'), 'observed-version');
  assert.equal(revisionForSave(base, 'copy'), null);
  assert.equal(revisionForSave(null, 'original'), null);
  assert.equal(revisionForSave(JSON.parse(JSON.stringify(base)), 'original'), 'observed-version');
});
