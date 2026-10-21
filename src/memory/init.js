import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileProject } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { ensureIgnored } from './ignore.js';

// `deltadictum init`: a project opts into DD with its .dd/ folder (docs/DD.md).
// Writes the opt-in a team commits (config.json with the project id, the ignore
// file for what is derived, the memories folder) and compiles an empty index, so
// the first tool call of the next session is served. Nothing that exists is
// touched: run twice, it reports what was there.
export async function initProject(root, { projectId = null } = {}) {
  const paths = localPaths(root);
  const created = [];
  const existed = [];
  const configPath = join(paths.dd, 'config.json');
  if (existsSync(configPath)) existed.push('.dd/config.json');
  else {
    mkdirSync(paths.dd, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ project_id: projectId ?? basename(root) }, null, 2)}\n`);
    created.push('.dd/config.json');
  }
  (await ensureIgnored(paths.dd) ? created : existed).push('.dd/.gitignore');
  if (existsSync(paths.memories)) existed.push('.dd/memories/');
  else {
    mkdirSync(paths.memories, { recursive: true });
    created.push('.dd/memories/');
  }
  await compileProject(root);
  return { project: root, created, existed,
    next: created.length ? 'Commit the opt-in (git add .dd && git commit): DD records this project and asks for memories from the next session.' : 'This project is already opted in.' };
}
