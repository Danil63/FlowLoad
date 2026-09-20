import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from './atomic-file.mjs';
test('concurrent saves always expose complete JSON and clean up temporary files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowload-atomic-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'route.json');
  await writeAtomic(file, JSON.stringify({ index: -1 }));
  await Promise.all(Array.from({ length: 40 }, async (_, index) => {
    await writeAtomic(file, JSON.stringify({ index, content: 'x'.repeat(20000) }));
    assert.equal(typeof JSON.parse(await fs.readFile(file, 'utf8')).index, 'number');
  }));
  assert.deepEqual(await fs.readdir(dir), ['route.json']);
});
