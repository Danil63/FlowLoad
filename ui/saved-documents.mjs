import { promises as fs } from 'node:fs';
import path from 'node:path';
import { documentRevision } from './document-revisions.mjs';

export const savedDocumentError = 'Файл повреждён или недоступен. Восстановите его из резервной копии или удалите.';

export function validateSavedDocument(document, type) {
  const items = type === 'route' ? document?.steps : document?.targets;
  if (!document || typeof document.name !== 'string' || !Array.isArray(items) || !items.length ||
    items.some(item => !item || typeof item.method !== 'string' || !item.method.trim() ||
      typeof item.path !== 'string' || !item.path.startsWith('/') ||
      (type === 'profile' && (!Number.isFinite(Number(item.weight)) || Number(item.weight) <= 0)))) {
    throw new Error(savedDocumentError);
  }
  return document;
}

export async function readSavedDocument(file, type) {
  try {
    return validateSavedDocument(JSON.parse(await fs.readFile(file, 'utf8')), type);
  } catch {
    throw new Error(savedDocumentError);
  }
}

export async function listSavedDocuments(directory, suffix, summarize) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const documents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
    const file = path.join(directory, entry.name);
    let revision = null;
    try {
      const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      revision = documentRevision(raw);
      documents.push({ ...summarize(JSON.parse(raw)), fileName: entry.name, revision, updatedAt: stat.mtimeMs });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      documents.push({ name: entry.name.slice(0, -suffix.length), fileName: entry.name, revision,
        updatedAt: 0, stepsCount: 0, targetsCount: 0, totalWeight: 0, invalid: true,
        fileError: savedDocumentError });
    }
  }
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}
