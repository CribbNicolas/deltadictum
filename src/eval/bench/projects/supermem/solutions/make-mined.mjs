// Writes, for each mined task, the fix's test file under hidden/ and the fix's non-test changes as its
// correct overlay under solutions/<task>/correct/. Run from the repository root:
//   node src/eval/bench/projects/supermem/solutions/make-mined.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINED_TASKS } from '../mined.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 << 20 });

const FILES = {
  'supermem-crlf-edit-check': 'tests/hooks/v2-checks.test.js', 'supermem-run-is-not-edit': 'tests/capture/turn-checks.test.js',
  'supermem-pattern-empty-class': 'tests/engine/v2/check-pattern.test.js', 'supermem-glob-star-chain': 'tests/engine/v2/clause.test.js',
  'supermem-telemetry-locked': 'tests/maintenance/telemetry.test.js', 'supermem-session-cwd': 'tests/hooks/v2-events.test.js',
  'supermem-compile-overlap': 'tests/engine/v2/compile.test.js', 'supermem-rename-retry': 'tests/engine/v2/compile.test.js',
  'supermem-dead-symbol': 'tests/engine/v2/compile.test.js', 'supermem-skills-npx': null,
  'supermem-claim-delivered': 'tests/hooks/v2-hook.test.js',
  'supermem-subfolder-committed': 'tests/capture/turn-checks.test.js', 'supermem-symbols-not-prompts': 'tests/engine/v2/clause.test.js',
  'supermem-inbox-ignored': 'tests/capture/inbox.test.js',
};

for (const task of MINED_TASKS) {
  const fix = task.source;
  const test = FILES[task.id];
  if (test) {
    const file = join(HERE, '..', 'hidden', `${fix}-${basename(test)}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, git('show', `${fix}:${test}`));
  }
  const out = join(HERE, task.id, 'correct');
  rmSync(out, { recursive: true, force: true });
  const changed = git('diff', '--name-only', '--diff-filter=AM', `${fix}^`, fix).toString().trim().split('\n').filter(path => path && !path.startsWith('tests/'));
  for (const path of changed) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), git('show', `${fix}:${path}`));
  }
  console.log(`${task.id}: ${changed.join(' ')}`);
}
