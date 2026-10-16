import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import supermem from '../../src/eval/bench/projects/supermem.js';
import { proveTasks } from './prove.js';

// BENCH_TASKS=a,b proves only those tasks.
proveTasks(supermem, new URL('../../src/eval/bench/projects/supermem/solutions/', import.meta.url), { only: process.env.BENCH_TASKS?.split(',') ?? null });

// The calibration's three runs all wrote "Do not run `npx deltadictum`" beside the plugin CLI: a sentence
// that forbids npx is prose, not something the skill runs.
test('supermem-skills-npx: npx named only to forbid it passes; npx the skill runs fails', async t => {
  const task = supermem.tasks.find(x => x.id === 'supermem-skills-npx');
  const dir = mkdtempSync(join(tmpdir(), 'dd-skills-npx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (recall, review) => {
    for (const [name, text] of [['recall', recall], ['review', review]]) {
      mkdirSync(join(dir, 'skills', name), { recursive: true });
      writeFileSync(join(dir, 'skills', name, 'SKILL.md'), text);
    }
  };
  const cli = sub => `Run \`node "\${CLAUDE_PLUGIN_ROOT}/src/cli.js" ${sub}\` from the project.`;
  write(`${cli('recall')}\n\nDo not run \`npx deltadictum\`: it fetches a copy from npm.\n`,
    `${cli('ui')} Relay \`DD - review UI: <address>\`. Do not substitute \`npx deltadictum ui\`, which may serve another version.\n`);
  assert.equal((await task.check(dir)).passed, true);
  write(`${cli('recall')}\n\nIf that fails, run \`npx deltadictum recall\`.\n`, cli('ui'));
  assert.equal((await task.check(dir)).passed, false);
  write(`${cli('recall')}\n\n\`\`\`\nnpx deltadictum recall "x"  # do not use\n\`\`\`\n`, cli('ui'));
  assert.equal((await task.check(dir)).passed, false);
});
