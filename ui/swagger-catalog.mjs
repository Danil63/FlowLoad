import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const key = item => `${String(item.method).toUpperCase()} ${item.path}`;
export class SwaggerCatalog {
  constructor(file) { this.file = file; this.pending = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { initialized: false, sources: [], deleted: [] };
    }
  }
  update(change) {
    const task = this.pending.then(async () => {
      const state = await this.read();
      await change(state);
      state.initialized = true;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(`${this.file}.tmp`, this.file);
      return state;
    });
    this.pending = task.catch(() => {});
    return task;
  }
  add(name, endpoints, migrate = false) {
    if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some(e => !e.method || !e.path)) {
      throw new Error('Документ не содержит корректных методов.');
    }
    return this.update(state => {
      if (migrate && state.initialized) return;
      const sourceId = randomUUID();
      state.sources.push({ id: sourceId, name: String(name || 'Swagger'),
        endpoints: endpoints.map(e => ({ ...e, id: randomUUID(), sourceId, catalogMethodId: randomUUID() })) });
    });
  }
  remove(sourceId, methodId) {
    return this.update(state => {
      const source = state.sources.find(s => s.id === sourceId);
      if (!source) throw new Error('Документ уже удалён.');
      const removed = source.endpoints.filter(e => !methodId || e.catalogMethodId === methodId);
      if (methodId && !removed.length) throw new Error('Метод уже удалён.');
      state.deleted.push(...removed.map(e => ({ sourceId, catalogMethodId: e.catalogMethodId, key: key(e) })));
      if (methodId) source.endpoints = source.endpoints.filter(e => e.catalogMethodId !== methodId);
      else state.sources = state.sources.filter(s => s.id !== sourceId);
    });
  }
  async invalid(items = []) {
    const state = await this.read();
    return items.some(item => state.deleted.some(d => item.catalogMethodId
      ? d.catalogMethodId === item.catalogMethodId : d.key === key(item)));
  }
}
