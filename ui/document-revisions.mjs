import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

export const documentRevision = raw => createHash('sha256').update(raw).digest('hex');

export class RevisionConflict extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.code = 'REVISION_CONFLICT';
  }
}

export async function readDocumentSnapshot(file) {
  const raw = await fs.readFile(file, 'utf8');
  return { raw, revision: documentRevision(raw) };
}

// The server mutation queue holds this check and the subsequent write/delete together.
export async function requireDocumentRevision(file, expected, { create = false } = {}) {
  let current;
  try { current = await readDocumentSnapshot(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (create && (expected === null || expected === undefined)) return;
    throw new RevisionConflict('Файл был удалён. Черновик сохранён; сохраните его как новый сценарий или профиль.');
  }
  if (!expected) {
    throw new RevisionConflict('Файл с таким именем уже существует. Откройте его актуальную версию или сохраните копию под другим именем.');
  }
  if (expected !== current.revision) {
    throw new RevisionConflict('Файл изменён в другой вкладке или на диске. Ваш черновик не перезаписан. Откройте актуальную версию или сохраните копию.');
  }
}
