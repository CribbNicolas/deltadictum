import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex } from '../../src/engine/index-file.cjs';
import { importRules, parseRuleFile } from '../../src/memory/import.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

// Claude Code rules (.claude/rules/*.md, a `paths` list) and Cursor rules
// (.cursor/rules/*.mdc, `globs` as a comma list) carry the same shape as a
// trigger: files the rule applies to, and the rule.
test("a rules file's frontmatter yields its globs, its title and its body", () => {
  const claude = parseRuleFile('---\npaths:\n  - "src/api/**/*.ts"\n  - src/services/**\n---\n# API rules\n\nValidate every input.\n');
  assert.deepEqual(claude.frontmatter.paths, ['src/api/**/*.ts', 'src/services/**']);
  assert.equal(claude.title, 'API rules');
  assert.equal(claude.body, 'Validate every input.');
  const cursor = parseRuleFile('---\ndescription: RPC boilerplate\nglobs: *.ts, src/**/*.tsx\nalwaysApply: false\n---\nUse the generator.\n');
  assert.deepEqual(cursor.frontmatter.globs, ['*.ts', 'src/**/*.tsx']);
  assert.equal(cursor.frontmatter.alwaysApply, false);
  assert.deepEqual([cursor.title, cursor.body], ['RPC boilerplate', 'Use the generator.']);
  const inline = parseRuleFile("---\npaths: [\"a/*.js\", 'b/**']\n---\nBody.");
  assert.deepEqual(inline.frontmatter.paths, ['a/*.js', 'b/**']);
  assert.deepEqual(parseRuleFile('No frontmatter here.'), { frontmatter: {}, title: null, body: 'No frontmatter here.' });
});

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-import-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src', 'api'), { recursive: true });
  writeFileSync(join(root, 'src', 'api', 'users.ts'), 'export const users = [];\n');
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  const rule = (path, text) => { mkdirSync(join(root, ...path.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(root, path), text); };
  rule('.claude/rules/api.md', '---\npaths:\n  - "src/api/**/*.ts"\n---\n# API rules\n\nEvery handler validates its input with the shared schema; the framework does not.\n');
  rule('.claude/rules/always.md', '# Style\n\nUse British spelling.\n');
  rule('.claude/rules/dead.md', '---\npaths:\n  - lib/**\n---\nNothing matches this.\n');
  rule('.cursor/rules/components.mdc', '---\ndescription: Component files\nglobs: *.js\nalwaysApply: false\n---\nComponents export one default function; the loader relies on it.\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  return root;
}
const hash = (root, path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

test('import turns scoped rules into active memories with the file as evidence; always-on and dead ones are skipped', async t => {
  const root = project(t);
  const report = await importRules(root);
  assert.deepEqual(report.skipped.map(s => [basename(s.file), s.reason]).sort(), [['always.md', 'no_paths'], ['dead.md', 'no_live_paths']]);
  assert.deepEqual(report.imported.map(m => m.file).sort(), ['.claude/rules/api.md', '.cursor/rules/components.mdc']);
  const store = createMemoryFiles(join(root, '.dd'));
  const api = await store.get(report.imported.find(m => m.file === '.claude/rules/api.md').id);
  assert.deepEqual([api.status, api.topic, api.kind, api.origin, api.review.accepted.by, api.title], ['active', 'rules/claude/api', 'procedure', 'user_explicit', 'person', 'API rules']);
  assert.equal(api.body, 'Every handler validates its input with the shared schema; the framework does not.');
  assert.deepEqual(api.triggers, [{ on: ['read', 'edit', 'write'], paths: ['src/api/**/*.ts'] }]);
  assert.deepEqual(api.evidence.map(e => [e.type, e.path, e.sha256]), [['file', '.claude/rules/api.md', hash(root, '.claude/rules/api.md')]]);
  assert.deepEqual(api.revisit_when.map(r => [r.kind, r.path]), [['file_changed', '.claude/rules/api.md']]);
  assert.ok(api.not_derivable.length >= 20);
  const components = await store.get(report.imported.find(m => m.file === '.cursor/rules/components.mdc').id);
  // A bare `*.js` applies anywhere in Cursor; DD's globs stay within one folder, so it becomes `**/*.js`.
  assert.deepEqual([components.topic, components.title, components.triggers[0].paths], ['rules/cursor/components', 'Component files', ['**/*.js']]);
  assert.deepEqual(Object.keys(loadIndex(root).memories).sort(), [api.id, components.id].sort());
});

test('a second import updates a changed rule in place and leaves the rest alone; a dry run writes nothing', async t => {
  const root = project(t);
  const first = await importRules(root);
  const apiId = first.imported.find(m => m.file === '.claude/rules/api.md').id;
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths:\n  - "src/api/**/*.ts"\n---\n# API rules\n\nEvery handler validates its input with the shared schema, and logs a rejection.\n');
  const second = await importRules(root);
  assert.deepEqual(second.updated.map(m => m.file), ['.claude/rules/api.md']);
  assert.deepEqual(second.unchanged.map(m => m.file), ['.cursor/rules/components.mdc']);
  assert.equal(second.updated[0].id, apiId);
  const api = await createMemoryFiles(join(root, '.dd')).get(apiId);
  assert.match(api.body, /logs a rejection/);
  assert.equal(api.evidence[0].sha256, hash(root, '.claude/rules/api.md'));
  const dry = project(t);
  const preview = await importRules(dry, { dryRun: true });
  assert.equal(preview.dry_run, true);
  assert.equal(preview.imported.length, 2);
  assert.equal(existsSync(join(dry, '.dd')), false);
});

// A rule longer than a memory's body is cut at a paragraph and points back at
// its file, which the agent can read; the memory says it was cut.
test('a long rule is cut at a paragraph and points at its file', async t => {
  const root = project(t);
  const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: ${'rule text '.repeat(20).trim()}.`);
  writeFileSync(join(root, '.claude', 'rules', 'long.md'), `---\npaths:\n  - src/**\n---\n# Long rules\n\n${paragraphs.join('\n\n')}\n`);
  const report = await importRules(root);
  const long = await createMemoryFiles(join(root, '.dd')).get(report.imported.find(m => m.file === '.claude/rules/long.md').id);
  assert.ok(long.body.length <= 1500, `${long.body.length}`);
  assert.match(long.body, /Paragraph 0:[\s\S]*\n\n\(More in \.claude\/rules\/long\.md\.\)$/);
  assert.doesNotMatch(long.body, /Paragraph 11/);
  assert.ok(long.review.issues.includes('imported_truncated'));
});

test('deltadictum import runs from the project, with --dry-run and --from', t => {
  const root = project(t);
  const dry = spawnSync(process.execPath, [CLI, 'import', '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).imported.length, 2);
  const cursorOnly = spawnSync(process.execPath, [CLI, 'import', '--from', '.cursor/rules'], { cwd: root, encoding: 'utf8' });
  assert.equal(cursorOnly.status, 0, cursorOnly.stderr);
  assert.deepEqual(JSON.parse(cursorOnly.stdout).imported.map(m => m.file), ['.cursor/rules/components.mdc']);
});
