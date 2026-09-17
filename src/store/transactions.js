import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ownership = new AsyncLocalStorage();

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx');
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; }
      catch (err) {
        if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        await delay(20 * (attempt + 1));
      }
    }
  } finally { await rm(temp, { force: true }); }
}

export function createWriteLock(ddDir) {
  const key = resolve(ddDir);
  const path = join(key, '.write-lock');
  return async function withWriteLock(work) {
    if (ownership.getStore()?.has(key)) return work();
    await mkdir(key, { recursive: true });
    const token = randomUUID();
    const deadline = Date.now() + 10000;
    for (;;) {
      try {
        const handle = await open(path, 'wx');
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); }
        finally { await handle.close(); }
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          const owner = await readJson(path, null);
          let dead = false;
          if (owner?.pid) {
            try { process.kill(owner.pid, 0); }
            catch (probe) { dead = probe.code === 'ESRCH'; }
          }
          if (dead && (await readJson(path, null))?.token === owner.token) await rm(path, { force: true });
        } catch (readError) {
          if (readError instanceof SyntaxError && Date.now() - (await stat(path)).mtimeMs > 30000) {
            await rm(path, { force: true });
          }
        }
        if (Date.now() >= deadline) throw new Error('memory_store_busy');
        await delay(20);
      }
    }
    try { return await ownership.run(new Set([...(ownership.getStore() ?? []), key]), work); }
    finally {
      if ((await readJson(path, null))?.token === token) await rm(path, { force: true });
    }
  };
}

function operationPath(ddDir, path) {
  if (!/^(?:(?:atoms|candidates|archive)\/[a-zA-Z0-9_/-]+\.json|registry\/topics\.json|relations\.json|config\.json)$/.test(path)
      || path.split('/').includes('..')) throw new Error('invalid_journal_path');
  return join(ddDir, ...path.split('/'));
}

// The durable journal is the commit point. Recovery rolls forward idempotently.
// Callers hold the project write lock while publishing and indexing a transaction.
export async function recoverTransaction(ddDir) {
  const journalPath = join(ddDir, '.pending-write.json');
  const journal = await readJson(journalPath, null);
  if (!journal) return false;
  const operations = journal.operations.map(op => ({ ...op, absolute: operationPath(ddDir, op.path) }));
  for (const op of operations) {
    if (op.value === null) await rm(op.absolute, { force: true });
    else await writeJson(op.absolute, op.value);
  }
  await rm(journalPath, { force: true });
  return true;
}

export async function commitTransaction(ddDir, operations) {
  for (const op of operations) operationPath(ddDir, op.path);
  await writeJson(join(ddDir, '.pending-write.json'), { version: 1, operations });
  await recoverTransaction(ddDir);
}
