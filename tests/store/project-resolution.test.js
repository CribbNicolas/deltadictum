import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot } from '../../src/project.js';

// A synthetic boundary stands in for the user's home directory, so these tests
// exercise the real rule without creating anything under the actual home.
async function sandbox() {
  const boundary = await mkdtemp(join(tmpdir(), 'dd-boundary-'));
  return { boundary, under: async (...segments) => {
    const path = join(boundary, ...segments);
    await mkdir(path, { recursive: true });
    return path;
  } };
}

describe('project resolution', () => {
  test('a plain directory resolves to itself, never to the boundary', async () => {
    // The incident this guards against: the per-user data base used to live at
    // ~/.dd, which findRepoRoot accepted as a project marker, so any store
    // opened from a non-repository path under the home resolved to the home and
    // two unrelated directories shared one project.
    const box = await sandbox();
    await box.under('.dd');
    await writeFile(join(box.boundary, '.dd', 'config.json'), '{"project_id":"stray"}');
    const work = await box.under('scratch', 'work');

    assert.equal(await findRepoRoot(work, { stopAt: box.boundary }), work);
  });

  test('the boundary cannot capture a directory below it, however complete its own .dd', async () => {
    // Being captured from below is the accident. Starting at the boundary is the
    // user pointing at it deliberately, and stays their choice.
    const box = await sandbox();
    await box.under('.dd', 'atoms');
    await box.under('.dd', 'registry');
    await writeFile(join(box.boundary, '.dd', 'config.json'), '{"project_id":"stray"}');
    const sibling = await box.under('unrelated');

    assert.equal(await findRepoRoot(sibling, { stopAt: box.boundary }), sibling);
    assert.equal(await findRepoRoot(box.boundary, { stopAt: box.boundary }), box.boundary);
  });

  test('a git repository resolves from any depth inside it', async () => {
    const box = await sandbox();
    const repo = await box.under('projects', 'app');
    await mkdir(join(repo, '.git'), { recursive: true });
    const deep = await box.under('projects', 'app', 'src', 'engine');

    assert.equal(await findRepoRoot(deep, { stopAt: box.boundary }), repo);
  });

  test('a project carrying .dd but no .git still resolves', async () => {
    const box = await sandbox();
    const project = await box.under('projects', 'notes');
    await mkdir(join(project, '.dd', 'atoms'), { recursive: true });
    const deep = await box.under('projects', 'notes', 'docs');

    assert.equal(await findRepoRoot(deep, { stopAt: box.boundary }), project);
  });

  test('a cache directory is not a project, however much it looks like one from outside', async () => {
    // The per-user data base holds one directory per project, each containing a
    // rebuildable index. It carries none of the markers that make a .dd a project.
    const box = await sandbox();
    const dataBase = await box.under('.dd-data');
    await mkdir(join(dataBase, 'app-3892c3ad040f'), { recursive: true });
    await writeFile(join(dataBase, 'app-3892c3ad040f', 'index.sqlite'), '');
    const work = await box.under('.dd-data', 'app-3892c3ad040f');

    assert.equal(await findRepoRoot(work, { stopAt: box.boundary }), work);
  });

  test('the innermost project wins when projects are nested', async () => {
    const box = await sandbox();
    const outer = await box.under('workspace');
    await mkdir(join(outer, '.git'), { recursive: true });
    const inner = await box.under('workspace', 'packages', 'inner');
    await mkdir(join(inner, '.dd', 'atoms'), { recursive: true });

    assert.equal(await findRepoRoot(inner, { stopAt: box.boundary }), inner);
  });
});
