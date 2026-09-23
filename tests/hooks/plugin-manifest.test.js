import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Claude Code reads a plugin's hooks from hooks/hooks.json at the plugin root and
// runs them from the user's project directory. A relative command (node run.cjs)
// fails there with MODULE_NOT_FOUND on every event: found 2026-09-23 by loading
// the plugin into a fresh project, after `claude plugin validate` had passed.
test('every plugin hook command is anchored at the plugin root and names a real file', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.values(manifest.hooks).flat().flatMap(entry => entry.hooks.map(hook => hook.command));
  assert.ok(commands.length >= 5);
  for (const command of commands) {
    assert.match(command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.cjs" [a-z-]+$/, command);
  }
  await access(join(ROOT, 'hooks', 'run.cjs'));
});
