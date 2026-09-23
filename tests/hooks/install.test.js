import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDependencies, missingDependencies, INSTALL_FAILED, INSTALL_LOCK, LOCK_STALE_MS } from '../../src/deps.js';
import { residentNotice } from '../../src/hooks/session-start.js';
import { ephemeralRoot, planCodexInstall } from '../../scripts/install-codex.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('a checkout with its packages needs no install', () => {
  assert.deepEqual(missingDependencies(ROOT), []);
  assert.equal(ensureDependencies({ start: () => assert.fail('started an install') }).state, 'present');
});

// Grok Build copies a plugin without node_modules (its docs: plugins deliver
// files, not runtimes). Found 2026-09-23 by installing DD from GitHub into an
// isolated Grok home: the MCP handshake failed and the resident had no model.
test('a plugin directory without its packages starts one background install at a time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-deps-'));
  await writeFile(join(root, 'package.json'), '{"name":"copy","type":"module"}');
  assert.deepEqual(missingDependencies(root).sort(), ['@huggingface/transformers', '@modelcontextprotocol/sdk', 'zod']);

  const started = [];
  const first = ensureDependencies({ root, start: dir => started.push(dir) });
  assert.deepEqual([first.state, first.failed, started], ['installing', null, [root]]);

  // An install holding the lock is left alone; one that died long ago is not.
  await writeFile(join(root, INSTALL_LOCK), '');
  assert.equal(ensureDependencies({ root, start: dir => started.push(dir) }).state, 'installing');
  assert.equal(started.length, 1);
  const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  await utimes(join(root, INSTALL_LOCK), old, old);
  ensureDependencies({ root, start: dir => started.push(dir) });
  assert.equal(started.length, 2);

  await writeFile(join(root, INSTALL_FAILED), 'npm ci exited with code 1\n');
  const failed = ensureDependencies({ root, start: () => {}, now: Date.now() + LOCK_STALE_MS * 2 });
  assert.equal(failed.failed, 'npm ci exited with code 1');
  assert.match(residentNotice(failed), /DD - Inactive: installing DD's packages failed \(npm ci exited with code 1\)/);
  assert.match(residentNotice(failed), /npm ci --omit=dev --ignore-scripts/);
  assert.match(residentNotice({ state: 'installing', root }), /DD - Inactive for now: DD is installing its packages/);
});

// `npx deltadictum install` runs from npm's npx cache; the Codex config it
// writes would point every later session at a directory npm may delete.
test('the Codex installer refuses to write paths into the npx cache', async () => {
  assert.equal(ephemeralRoot('C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\3f2a\\node_modules\\deltadictum'), true);
  assert.equal(ephemeralRoot('/home/x/.npm/_npx/3f2a/node_modules/deltadictum'), true);
  assert.equal(ephemeralRoot('/usr/lib/node_modules/deltadictum'), false);
  assert.equal(ephemeralRoot(ROOT), false);
  await assert.rejects(planCodexInstall(tmpdir(), { root: '/home/x/.npm/_npx/3f2a/node_modules/deltadictum' }),
    /ephemeral_install: .*npm install -g deltadictum/);
});

// Grok Build ignores an inline mcpServers object in .grok-plugin/plugin.json
// and falls back to the root .mcp.json, whose relative path resolves in the
// user's project; it does not expand ${VAR:-default}. A path to a file of its
// own, anchored at ${GROK_PLUGIN_ROOT}, is what connected (grok mcp doctor,
// 2026-09-23). Its marketplace refuses a plugin source of "./".
test('the Grok plugin names an MCP file anchored at the plugin root, and a marketplace source it accepts', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, '.grok-plugin', 'plugin.json'), 'utf8'));
  assert.equal(typeof manifest.mcpServers, 'string');
  const servers = JSON.parse(await readFile(join(ROOT, manifest.mcpServers), 'utf8')).mcpServers;
  assert.deepEqual(servers.dd.args, ['${GROK_PLUGIN_ROOT}/mcp.js']);
  for (const hook of Object.values(manifest.hooks).flat().flatMap(entry => entry.hooks)) {
    assert.match(hook.command, /^node "\$\{GROK_PLUGIN_ROOT\}\/hooks\/run\.cjs" [a-z-]+$/);
  }
  const marketplace = JSON.parse(await readFile(join(ROOT, '.grok-plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(marketplace.plugins[0].source, { source: 'url', url: 'https://github.com/CribbNicolas/deltadictum.git' });
});
