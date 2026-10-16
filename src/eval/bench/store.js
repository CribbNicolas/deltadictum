// The store each bench project runs with, and the same knowledge as a guide for
// the documentation conditions. A bench store is written from definitions, as
// the v2 trial's was (src/eval/agent/trial-memories.js); an existing store is the
// project's own, as it stands at the base commit.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileProject } from '../../engine/compile.js';
import { initProject } from '../../memory/init.js';
import { createMemoryFiles } from '../../memory/store.js';
import { engineeringGuideV2 } from '../agent/guide.js';

const CREATED = '2026-10-16T12:00:00.000Z';
const LIVE = ['active', 'contested'];

export const benchMemoryId = (projectId, topic) => {
  const hex = createHash('sha256').update(`dd-bench-2026-10:${projectId}:${topic}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export async function materializeMemories(root, project) {
  if (project.store === 'existing') return { memories: project.memories, warnings: [] };
  const memories = [], warnings = [];
  for (const d of project.memories) {
    const evidence = [];
    for (const entry of d.evidence ?? []) {
      const path = join(root, entry.path);
      if (!existsSync(path)) { warnings.push(`${d.topic}: evidence ${entry.path} not found`); continue; }
      evidence.push({ type: 'file', path: entry.path, sha256: createHash('sha256').update(await readFile(path)).digest('hex'), summary: entry.summary });
    }
    memories.push({ schema_version: 8, id: benchMemoryId(project.id, d.topic), project_id: project.id, topic: d.topic, kind: d.kind,
      status: d.status ?? 'active', title: d.title, body: d.body, not_derivable: d.not_derivable, triggers: d.triggers, evidence,
      origin: 'user_explicit', replaces: d.replaces ? benchMemoryId(project.id, d.replaces) : null, revisit_when: [],
      review: { migrated: false, issues: [], accepted: { by: 'person', at: CREATED } }, created: CREATED, updated: CREATED });
  }
  return { memories, warnings };
}

export async function installStore(root, project) {
  const { memories, warnings } = await materializeMemories(root, project);
  const dd = join(root, '.dd');
  if (project.store === 'bench') {
    const dir = join(dd, 'memories');
    for (const name of await readdir(dir).catch(() => [])) await rm(join(dir, name), { force: true });
    if (!existsSync(join(dd, 'config.json'))) await initProject(root, { projectId: project.id });
    await createMemoryFiles(dd).commit({ put: memories });
  }
  await compileProject(root);
  const index = JSON.parse(await readFile(join(dd, 'local', 'v2', 'index.json'), 'utf8').catch(() => 'null'));
  return { memories, warnings, index_memories: index ? Object.keys(index.memories ?? {}).length : null };
}

export async function writeGuide(root, project, memories, referenced) {
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'engineering-guide.md'), engineeringGuideV2(memories.filter(m => LIVE.includes(m.status))));
  if (!referenced) return;
  const target = join(root, project.guideTarget);
  const text = existsSync(target) ? `${(await readFile(target, 'utf8')).trimEnd()}\n\n` : '';
  await writeFile(target, `${text}## Engineering guide

Conventions, pitfalls and past decisions for this codebase are in [docs/engineering-guide.md](docs/engineering-guide.md).
Read the sections that apply before changing code.
`);
}
