import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

export async function writeAtomic(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
