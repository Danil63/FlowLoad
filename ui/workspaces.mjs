import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SwaggerCatalog } from './swagger-catalog.mjs';

const initial = { id: 'default', name: 'Основной', baseUrl: 'https://entreporgneur-big-journey-7b03.twc1.net' };
export class Workspaces {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'ui', '.local', 'workspaces');
    this.queue = Promise.resolve();
    this.catalogs = new Map();
  }
  async list() {
    try { return JSON.parse(await fs.readFile(path.join(this.dir, 'index.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return [{ ...initial }]; }
  }
  async get(id = 'default') {
    const metadata = (await this.list()).find(item => item.id === id);
    if (!metadata) throw new Error('Рабочее пространство не найдено.');
    const legacy = id === 'default';
    const dir = path.join(this.dir, id);
    const k6Dir = legacy ? path.join(this.root, 'load-testing', 'k6') : dir;
    if (!this.catalogs.has(id)) this.catalogs.set(id, new SwaggerCatalog(legacy
      ? path.join(this.root, 'ui', '.local', 'swagger-catalog.json') : path.join(dir, 'swagger-catalog.json')));
    return { ...metadata, k6Dir, tokensFile: path.join(k6Dir, 'tokens.txt'), resultsDir: path.join(k6Dir, 'results'),
      routesDir: legacy ? path.join(this.root, 'load-testing', 'routes', 'local') : path.join(dir, 'routes'),
      loadProfilesDir: legacy ? path.join(this.root, 'load-testing', 'load-profiles', 'local') : path.join(dir, 'load-profiles'),
      swaggerCatalog: this.catalogs.get(id) };
  }
  save(input, id) {
    const task = this.queue.then(async () => {
      const name = String(input.name || '').trim();
      if (!name || name.length > 80) throw new Error('Название проекта должно содержать от 1 до 80 символов.');
      const raw = String(input.baseUrl || '').trim();
      let url;
      try { url = new URL(raw); } catch { throw new Error('Укажите полный адрес API: https://example.com'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\s"'`$\\]/.test(raw) || url.hash || url.search) {
        throw new Error('Адрес API должен быть HTTP/HTTPS без логина, пароля, параметров и специальных символов.');
      }
      const items = await this.list();
      const existing = id ? items.find(item => item.id === id) : null;
      if (id && !existing) throw new Error('Рабочее пространство не найдено.');
      const metadata = { id: id || randomUUID(), name, baseUrl: url.href.replace(/\/$/, '') };
      if (existing) items[items.indexOf(existing)] = metadata; else items.push(metadata);
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const file = path.join(this.dir, 'index.json');
      await fs.writeFile(`${file}.tmp`, JSON.stringify(items), { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
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
