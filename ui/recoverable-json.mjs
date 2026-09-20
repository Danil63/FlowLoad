import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeAtomic } from './atomic-file.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class StorageRecoveryRequired extends Error {
  constructor(label, reason) {
    super(`${label}: ${reason}. Данные не сброшены. Остановите FlowLoad и выполните make storage-check.`);
    this.status = 503;
    this.code = 'STORAGE_RECOVERY_REQUIRED';
  }
}

async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export class RecoverableJson {
  constructor(file, { initial, validate, label, scope }) {
    Object.assign(this, { file, initial, validate, label, scope });
    this.backupFile = `${file}.recovery.json`;
    this.pending = Promise.resolve();
  }
  exclusive(action) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  decode(raw, backup = false) {
    if (raw === null) return { status: 'missing' };
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      const value = backup ? parsed.data : parsed;
      this.validate(value);
      const hash = digest(value);
      if (backup && (parsed.version !== 1 || parsed.scope !== this.scope || parsed.hash !== hash)) {
        throw new Error('Invalid recovery record');
      }
      return { status: 'valid', value, hash };
    } catch { return { status: 'invalid' }; }
  }
  async snapshot() {
    const raw = await readOptional(this.file);
    const backupRaw = await readOptional(this.backupFile);
    const current = this.decode(raw);
    const backup = this.decode(backupRaw, true);
    let state = 'recovery-required';
    if (current.status === 'missing' && backup.status === 'missing') state = 'empty';
    else if (current.status === 'valid' && backup.status === 'missing') state = 'unprotected';
    else if (current.status === 'valid' && backup.status === 'valid' && current.hash === backup.hash) state = 'healthy';
    return { raw, current, backup, state };
  }
  assertReadable(snapshot) {
    if (snapshot.state !== 'recovery-required') return;
    const reason = snapshot.current.status === 'missing' ? 'основной файл отсутствует, но есть запись восстановления'
      : snapshot.current.status === 'invalid' ? 'основной файл повреждён или имеет неверную структуру'
        : snapshot.backup.status === 'invalid' ? 'повреждена запись восстановления'
          : 'основной файл не совпадает с последней подготовленной записью';
    throw new StorageRecoveryRequired(this.label, reason);
  }
  async readCurrent() {
    const snapshot = await this.snapshot();
    this.assertReadable(snapshot);
    return snapshot.state === 'empty' ? structuredClone(this.initial) : snapshot.current.value;
  }
  read() { return this.exclusive(() => this.readCurrent()); }
  async persist(value) {
    this.validate(value);
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    // Persist the intended state first: recovery must not undo a prepared deletion.
    const record = { version: 1, scope: this.scope, hash: digest(value), data: value };
    await writeAtomic(this.backupFile, JSON.stringify(record));
    try { await writeAtomic(this.file, JSON.stringify(value)); }
    catch { throw new StorageRecoveryRequired(this.label, 'запись прервана; новая версия сохранена для восстановления'); }
  }
  update(change) {
    return this.exclusive(async () => {
      const value = await this.readCurrent();
      await change(value);
      await this.persist(value);
      return value;
    });
  }
  inspect() {
    return this.exclusive(async () => {
      const { current, backup, state } = await this.snapshot();
      return { state, current: current.status, backup: backup.status, recoverable: backup.status === 'valid' };
    });
  }
  checkpoint() {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot();
      this.assertReadable(snapshot);
      if (snapshot.state !== 'unprotected') return false;
      await this.persist(snapshot.current.value);
      return true;
    });
  }
  recover() {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot();
      if (snapshot.state === 'healthy') return { changed: false };
      if (snapshot.backup.status !== 'valid') {
        throw new StorageRecoveryRequired(this.label, 'нет исправной копии, автоматическое восстановление невозможно');
      }
      let archive = null;
      if (snapshot.raw !== null) {
        archive = `${this.file}.damaged-${Date.now()}-${randomUUID()}`;
        await fs.writeFile(archive, snapshot.raw, { flag: 'wx', mode: 0o600 });
      }
      await writeAtomic(this.file, JSON.stringify(snapshot.backup.value));
      return { changed: true, archive };
    });
  }
}
