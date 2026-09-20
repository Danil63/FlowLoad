import { randomUUID } from 'node:crypto';
import { catalogValidator } from './public/catalog-state.js';
import { RecoverableJson } from './recoverable-json.mjs';

const key = item => `${String(item.method).toUpperCase()} ${item.path}`;
const text = value => typeof value === 'string' && value.length > 0;
function validateCatalog(state) {
  if (!state || typeof state.initialized !== 'boolean' || !Array.isArray(state.sources) || !Array.isArray(state.deleted)
      || (!state.initialized && (state.sources.length || state.deleted.length))) throw new Error('Invalid catalog');
  const sources = new Set(), methods = new Set();
  for (const source of state.sources) {
    if (!source || !text(source.id) || sources.has(source.id) || typeof source.name !== 'string' || !Array.isArray(source.endpoints)) {
      throw new Error('Invalid catalog source');
    }
    sources.add(source.id);
    for (const method of source.endpoints) {
      if (!method || !text(method.catalogMethodId) || methods.has(method.catalogMethodId) || method.sourceId !== source.id
          || !text(method.method) || !text(method.path)) throw new Error('Invalid catalog method');
      methods.add(method.catalogMethodId);
    }
  }
  for (const deleted of state.deleted) {
    if (!deleted || !text(deleted.sourceId) || !text(deleted.catalogMethodId) || !text(deleted.key)
        || methods.has(deleted.catalogMethodId)) throw new Error('Invalid catalog tombstone');
    methods.add(deleted.catalogMethodId);
  }
}

export class SwaggerCatalog {
  constructor(file, scope = 'catalog') {
    this.file = file;
    this.storage = new RecoverableJson(file, { initial: { initialized: false, sources: [], deleted: [] },
      validate: validateCatalog, label: 'Каталог Swagger', scope });
  }
  read() { return this.storage.read(); }
  update(change) {
    return this.storage.update(async state => {
      await change(state);
      state.initialized = true;
    });
  }
  add(name, endpoints, migrate = false) {
    if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some(e => !e || !text(e.method) || !text(e.path))) {
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
  async validator() {
    return catalogValidator(await this.read());
  }
  async invalid(items = []) {
    return items.some(await this.validator());
  }
}
