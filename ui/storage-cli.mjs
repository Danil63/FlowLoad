import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspaces } from './workspaces.mjs';
import { acquireServerLock } from './server-lock.mjs';

const states = { healthy: 'исправно, копия актуальна', empty: 'ещё нет данных',
  unprotected: 'исправно, копии пока нет', 'recovery-required': 'требуется восстановление' };
const files = { valid: 'исправен', invalid: 'повреждён', missing: 'отсутствует' };

export async function maintainStorage(root, { action, target, workspaceId = 'default', confirm = false }, log = console.log) {
  if (!['check', 'backup', 'recover'].includes(action)) throw new Error('Неизвестная команда обслуживания.');
  const release = await acquireServerLock(root);
  try {
    const workspaces = new Workspaces(root);
    if (action === 'recover') {
      let storage;
      if (target === 'workspaces') storage = workspaces.storage;
      else if (target === 'catalog') storage = (await workspaces.get(workspaceId)).swaggerCatalog.storage;
      else throw new Error('Укажите STORE=workspaces или STORE=catalog WORKSPACE=<id>.');
      const status = await storage.inspect();
      log(`${path.relative(root, storage.file)}: ${states[status.state]}.`);
      if (status.state === 'healthy') { log('Восстановление не требуется.'); return; }
      if (!status.recoverable) throw new Error('Исправной копии нет. Исходные файлы оставлены без изменений.');
      log('Будет применена последняя подготовленная запись, включая прерванное сохранение. Исходный файл будет сохранён отдельно.');
      if (!confirm) throw new Error('Для подтверждения повторите команду с CONFIRM=1.');
      const result = await storage.recover();
      if (result.archive) log(`Исходный файл: ${path.relative(root, result.archive)}`);
      log('Восстановлено. Можно запустить make web.');
      return;
    }
    let failed = false;
    const visit = async storage => {
      const relative = path.relative(root, storage.file);
      try {
        if (action === 'backup') await storage.checkpoint();
        const status = await storage.inspect();
        log(`${relative}: ${states[status.state]} (файл: ${files[status.current]}, копия: ${files[status.backup]}).`);
        if (status.state === 'recovery-required') failed = true;
      } catch (error) { failed = true; log(`${relative}: ${error.message}`); }
    };
    await visit(workspaces.storage);
    // A damaged registry cannot be trusted to enumerate workspace directories.
    const registry = await workspaces.storage.inspect();
    if (registry.state !== 'recovery-required') {
      for (const item of await workspaces.list()) await visit((await workspaces.get(item.id)).swaggerCatalog.storage);
    }
    if (failed) throw new Error('Обнаружены проблемы. Сначала восстановите реестр, если он повреждён, затем каталог нужного окружения.');
  } finally { await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await maintainStorage(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), {
      action: process.argv[2], target: process.env.FLOWLOAD_STORE,
      workspaceId: process.env.FLOWLOAD_WORKSPACE || 'default', confirm: process.env.FLOWLOAD_CONFIRM === '1',
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
