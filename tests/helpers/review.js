import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFiles } from '../../src/memory/store.js';

// A git project with memories, for the review UI tests.
export const memory = (id, extra = {}) => ({ schema_version: 8, id, project_id: 'p', topic: `ui/${id}`, kind: 'trap', status: 'active',
  title: `Rule ${id}`, body: `Close the store in t.after (${id}).`, not_derivable: 'Hidden from the code.', triggers: [{ on: ['edit'], paths: ['src/*.js'] }],
  evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [], review: { migrated: false, issues: [] },
  created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...extra });

export async function project(t, memories) {
  const root = mkdtempSync(join(tmpdir(), 'dd-ui-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  for (const name of ['a.js', 'b.js']) writeFileSync(join(root, 'src', name), `export function ${name[0]}Thing() {}\n`);
  spawnSync('git', ['-C', root, 'add', '-A']);
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  return root;
}
