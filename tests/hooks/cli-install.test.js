import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const cliPath = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout }));
  });
}

test('deltadictum install --host codex writes Codex project files without opening the current-directory store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-cli-install-'));
  const { code, stdout } = await run(['install', '--host', 'codex', '--project', root, '--dry-run']);
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.dry_run, true);
  assert.ok(result.files.some(f => f.endsWith('.codex/config.toml') || f.endsWith('.codex\\config.toml')));
  await assert.rejects(access(join(root, '.codex')));
});
