import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));
const dd = (root, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });

function fresh(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-init-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  return root;
}

// A project opts into DD with its .dd/ folder (docs/DD.md): init writes the
// opt-in, ignores what is derived, and compiles an empty index so the first tool
// call is served; run twice it changes nothing.
test('deltadictum init opts the project in: config, ignore file, memories folder, index; a second run changes nothing', t => {
  const root = fresh(t);
  const first = dd(root, 'init');
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.deepEqual(report.created, ['.dd/config.json', '.dd/.gitignore', '.dd/memories/']);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')), { project_id: basename(root) });
  const ignored = readFileSync(join(root, '.dd', '.gitignore'), 'utf8').split('\n');
  for (const entry of ['local/', 'memories/manifest.json', 'inbox/']) assert.ok(ignored.includes(entry), entry);
  assert.ok(existsSync(join(root, '.dd', 'memories')));
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', 'index.json')));
  assert.match(report.next, /git add \.dd/);
  const second = dd(root, 'init');
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout).created, []);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')), { project_id: basename(root) });
});

test('init takes the project id, and leaves an existing config alone', t => {
  const root = fresh(t);
  assert.equal(dd(root, 'init', '--project-id', 'my-app').status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')).project_id, 'my-app');
  writeFileSync(join(root, '.dd', 'config.json'), '{ "auto_accept": false }\n');
  assert.equal(dd(root, 'init', '--project-id', 'other').status, 0);
  assert.equal(readFileSync(join(root, '.dd', 'config.json'), 'utf8'), '{ "auto_accept": false }\n');
});

