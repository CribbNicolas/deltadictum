import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));
const atom = { id: 'one', project_id: 'p', schema_version: 7, capture_origin: 'model_initiated', capture_source: 'agent',
  memory_type: 'decision', scope: 'project', title: 'One decision', topic_key: 'area/one', trigger: 't', behavior_delta: 'Do it.',
  what: 'Do it.', why: 'Because.', tags: [], trigger_variants: [], applies_to: { files: ['src/a.js'], components: [], operations: [] },
  anchors: { keywords: [], not_when: [], files: [] }, assumptions: [], revisit_when: [], alternatives: [], evidence_refs: [],
  authority: 'inferred', lifecycle_state: 'active', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' };

test('deltadictum migrate reports a dry run, then converts the project it runs in', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-migrate-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.dd', 'atoms', 'area'), { recursive: true });
  writeFileSync(join(root, '.dd', 'atoms', 'area', 'one.json'), JSON.stringify(atom));
  const dry = spawnSync(process.execPath, [CLI, 'migrate', '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).converted, 1);
  assert.equal(existsSync(join(root, '.dd', 'memories')), false);
  const real = spawnSync(process.execPath, [CLI, 'migrate'], { cwd: root, encoding: 'utf8' });
  assert.equal(real.status, 0, real.stderr);
  assert.deepEqual(JSON.parse(real.stdout).removed, ['atoms']);
  assert.equal(existsSync(join(root, '.dd', 'memories', 'one.json')), true);
});
