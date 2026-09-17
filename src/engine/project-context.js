import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { estimateTokens, boundedBudget } from './budget.js';
import { retrieveMemories } from './retrieve.js';
import { projectFile } from './evidence.js';

const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'project.godot', 'README.md'];
const OMIT = new Set(['.git', '.dd', 'node_modules', 'vendor', 'dist', 'build', '.venv', '__pycache__']);

async function readSource(root, path) {
  try { return (await readFile(await projectFile(root, path), 'utf8')).slice(0, 16000); }
  catch { return null; }
}

export async function projectContext(store) {
  const root = store.repoRoot;
  const stamps = await Promise.all(MANIFESTS.map(async path => {
    try { const s = await stat(join(root, path)); return `${path}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
    catch { return `${path}:missing`; }
  }));
  const entries = (await readdir(root, { withFileTypes: true })).filter(e => !OMIT.has(e.name) && !e.name.startsWith('.'));
  const key = stamps.join('|') + entries.map(e => e.name).sort().join('|');
  if (store.projectContextCache?.key === key) return store.projectContextCache.value;
  const sources = [];
  const facts = {};
  const commands = {};
  let name = basename(root);
  let purpose = '';
  const pkg = await readSource(root, 'package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      name = parsed.name || name; purpose = parsed.description || '';
      facts['runtime'] = 'node'; facts['package.type'] = parsed.type || 'commonjs';
      if (parsed.engines?.node) facts['runtime.node'] = parsed.engines.node;
      for (const command of ['test', 'lint', 'build', 'typecheck', 'test:stress']) if (parsed.scripts?.[command]) commands[command] = `npm run ${command}`;
      sources.push('package.json');
    } catch { /* Invalid manifests are not interpreted as facts. */ }
  }
  for (const [file, language] of [['pyproject.toml', 'python'], ['Cargo.toml', 'rust'], ['go.mod', 'go'], ['project.godot', 'godot']]) {
    if (await readSource(root, file)) { facts[`uses.${language}`] = true; sources.push(file); }
  }
  if (!purpose) {
    const readme = await readSource(root, 'README.md');
    if (readme) {
      // Preserve source attribution; do not manufacture architecture from names.
      purpose = readme.split(/\r?\n/).find(line => line.trim() && !/^[#<![|`]/.test(line.trim()))?.slice(0, 240) ?? '';
      sources.push('README.md');
    }
  }
  const structure = entries.filter(e => e.isDirectory()).map(e => `${e.name}/`).sort().slice(0, 12);
  const pointers = entries.filter(e => e.isFile() && /^(README|AGENTS|CONTRIBUTING|ARCHITECTURE)/i.test(e.name)).map(e => e.name);
  const value = { name, purpose: String(purpose).slice(0, 300), facts, commands, structure, sources, pointers };
  store.projectContextCache = { key, value };
  return value;
}

export async function orientProject(request, { store, projectId }) {
  const budget = boundedBudget(request.budget_tokens, 600);
  const map = await projectContext(store);
  const result = { project: map.name, sources: map.sources, facts: map.facts,
    purpose: map.purpose, structure: map.structure, commands: map.commands, pointers: map.pointers, memories: [] };
  // Project orientation and action-specific knowledge share one payload budget.
  for (const key of ['structure', 'pointers', 'commands', 'purpose']) {
    if (estimateTokens(result) > budget / 2) delete result[key];
  }
  for (const key of ['facts', 'sources']) if (estimateTokens(result) > budget) delete result[key];
  if (estimateTokens(result) > budget) result.project = 'project';
  if (request.action && estimateTokens(result) + 150 < budget) {
    const remaining = budget - estimateTokens(result) - 16;
    const recalled = await retrieveMemories({ ...request, project_id: projectId, budget_tokens: remaining,
      facts: { ...request.facts, ...map.facts }, telemetry: request.telemetry }, { store });
    for (const memory of recalled.memories ?? []) {
      if (estimateTokens({ ...result, memories: [...result.memories, memory] }) <= budget) result.memories.push(memory);
    }
  }
  return result;
}
