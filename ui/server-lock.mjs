import { promises as fs } from 'node:fs';
import path from 'node:path';
import lockfile from 'proper-lockfile';

export async function acquireServerLock(root) {
  const directory = path.join(await fs.realpath(root), 'ui', '.local');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    return await lockfile.lock(directory, {
      lockfilePath: path.join(directory, 'server.lock'),
      stale: 30000,
      update: 5000,
      retries: 0,
    });
  } catch (error) {
    if (error.code !== 'ELOCKED') throw error;
    throw new Error('FlowLoad уже запущен для этой папки проекта. Откройте существующий веб или остановите его через Ctrl+C. После аварийного завершения подождите 30 секунд.');
  }
}
