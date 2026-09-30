import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const cliPath = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function run(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
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

// 0.8.2 printed "ddDir is not defined" for status: the command had never run.
test('deltadictum status reports the project and where its files live', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-cli-status-'));
  await mkdir(join(root, '.git'));
  const { code, stdout, stderr } = await run(['status'], { cwd: root });
  assert.equal(code, 0, stderr);
  const status = JSON.parse(stdout);
  assert.match(status.project_id, /^dd-cli-status-/);
  // The physical path: macOS reaches its temporary directory through a symlink.
  assert.ok(status.dd_dir.endsWith(join(basename(root), '.dd')), status.dd_dir);
  assert.ok(status.data_dir);
  assert.equal(status.total, 0);
});

// A typo, --help or --version used to open a store first, creating .dd/ in
// whatever directory the person happened to be in.
test('help, version and an unknown command leave the current directory untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-cli-help-'));
  await mkdir(join(root, '.git'));
  const help = await run(['--help'], { cwd: root });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: deltadictum/);
  const version = await run(['--version'], { cwd: root });
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version);
  const unknown = await run(['statsu'], { cwd: root });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command: statsu/);
  await assert.rejects(access(join(root, '.dd')));
});
