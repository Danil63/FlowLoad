import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SwaggerCatalog } from './swagger-catalog.mjs';
import { RecoverableJson } from './recoverable-json.mjs';

const initial = { id: 'default', name: 'Основной', baseUrl: 'https://entreporgneur-big-journey-7b03.twc1.net' };
function apiUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Укажите полный адрес API: https://example.com'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\s"'`$\\]/.test(raw) || url.hash || url.search) {
    throw new Error('Адрес API должен быть HTTP/HTTPS без логина, пароля, параметров и специальных символов.');
  }
  return url.href.replace(/\/$/, '');
}
function validateWorkspaces(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Invalid workspace registry');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !/^(?:default|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.test(item.id)
        || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
        || typeof item.baseUrl !== 'string') throw new Error('Invalid workspace');
    apiUrl(item.baseUrl);
    ids.add(item.id);
  }
  if (!ids.has('default')) throw new Error('Missing default workspace');
}

export class Workspaces {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'ui', '.local', 'workspaces');
    this.queue = Promise.resolve();
    this.catalogs = new Map();
    this.storage = new RecoverableJson(path.join(this.dir, 'index.json'), { initial: [{ ...initial }],
      validate: validateWorkspaces, label: 'Реестр окружений', scope: 'workspaces' });
  }
  list() { return this.storage.read(); }
  async get(id = 'default') {
    const metadata = (await this.list()).find(item => item.id === id);
    if (!metadata) throw Object.assign(new Error('Рабочее пространство не найдено.'), { status: 404 });
    const legacy = id === 'default';
    const dir = path.join(this.dir, id);
    const k6Dir = legacy ? path.join(this.root, 'load-testing', 'k6') : dir;
    if (!this.catalogs.has(id)) this.catalogs.set(id, new SwaggerCatalog(legacy
      ? path.join(this.root, 'ui', '.local', 'swagger-catalog.json') : path.join(dir, 'swagger-catalog.json'), `catalog:${id}`));
    return { ...metadata, k6Dir, tokensFile: path.join(k6Dir, 'tokens.txt'), resultsDir: path.join(k6Dir, 'results'),
      routesDir: legacy ? path.join(this.root, 'load-testing', 'routes', 'local') : path.join(dir, 'routes'),
      loadProfilesDir: legacy ? path.join(this.root, 'load-testing', 'load-profiles', 'local') : path.join(dir, 'load-profiles'),
      swaggerCatalog: this.catalogs.get(id) };
  }
  save(input, id) {
    const task = this.queue.then(async () => {
      const name = String(input.name || '').trim();
      if (!name || name.length > 80) throw new Error('Название проекта должно содержать от 1 до 80 символов.');
      const metadata = { id: id || randomUUID(), name, baseUrl: apiUrl(String(input.baseUrl || '').trim()) };
      await this.storage.update(items => {
        const index = id ? items.findIndex(item => item.id === id) : -1;
        if (id && index < 0) throw new Error('Рабочее пространство не найдено.');
        if (index >= 0) items[index] = metadata; else items.push(metadata);
      });
      const workspace = await this.get(metadata.id);
      await fs.mkdir(workspace.k6Dir, { recursive: true, mode: 0o700 });
      const handle = await fs.open(workspace.tokensFile, 'a', 0o600);
      await handle.close();
      return metadata;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
