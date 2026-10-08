import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER = fileURLToPath(new URL('../../src/engine/ledger.cjs', import.meta.url));
const IDS = ['m1', 'm2', 'm3', 'm4', 'm5'];

function claimer(path) {
  const script = `const { openLedger } = require(${JSON.stringify(LEDGER)}); process.stdout.write(JSON.stringify(openLedger(${JSON.stringify(path)}).claim(${JSON.stringify(IDS)})));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(JSON.parse(out || '[]')) : reject(new Error(`exit ${code}`))));
  });
}

test('concurrent hooks claiming the same memories deliver each exactly once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-ledger-stress-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (let round = 0; round < 5; round += 1) {
    const path = join(dir, `round-${round}.jsonl`);
    const results = await Promise.all(Array.from({ length: 8 }, () => claimer(path)));
    const won = results.flat();
    for (const id of IDS) assert.equal(won.filter(x => x === id).length, 1, `round ${round}: ${id} delivered ${won.filter(x => x === id).length} times`);
  }
});
