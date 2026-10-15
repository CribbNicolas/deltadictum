import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { globToRegExp } from '../engine/clause.cjs';
import { compileProject, presentFilesOf } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { BODY_MAX } from './convert-v1.js';
import { LIMITS, LIVE_STATUSES, SCHEMA_VERSION, validateMemory, validRelativePath } from './schema.js';
import { createMemoryFiles } from './store.js';

// `deltadictum import`: Claude Code's `.claude/rules/*.md` (a `paths` list in the
// frontmatter) and Cursor's `.cursor/rules/*.mdc` (`globs`) carry the shape of a
// trigger: the files a rule applies to, and the rule. Each scoped file becomes
// one active memory a person is taken to have reviewed (they wrote the rule and
// ran the import), with the file as hashed evidence, so the store can tell when
// the rule moves on. A rule with no paths is always-on knowledge, which belongs
// in CLAUDE.md or AGENTS.md, and is skipped.
export const RULE_SOURCES = [
  { dir: '.claude/rules', area: 'claude', extensions: ['.md'] },
  { dir: '.cursor/rules', area: 'cursor', extensions: ['.mdc', '.md'] },
];
const LIST_KEYS = new Set(['paths', 'globs']);

const unquote = value => String(value).trim().replace(/^(["'])(.*)\1$/, '$2');
const listOf = value => String(value).trim().replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);

// The YAML subset rules files use: `key: value`, `key:` followed by `- item`
// lines, inline `[a, b]` lists, and comma lists for the path keys.
function parseFrontmatter(text) {
  const out = {};
  let key = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && key) { (Array.isArray(out[key]) ? out[key] : (out[key] = [])).push(unquote(item[1])); continue; }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = pair[1];
    const value = pair[2];
    if (LIST_KEYS.has(key)) out[key] = value ? listOf(value) : [];
    else if (value === 'true' || value === 'false') out[key] = value === 'true';
    else out[key] = unquote(value);
  }
  return out;
}

export function parseRuleFile(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  let body = (match ? normalized.slice(match[0].length) : normalized).trim();
  let title = null;
  const heading = /^#\s+(.+)\n?/.exec(body);
  if (heading) { title = heading[1].trim(); body = body.slice(heading[0].length).trim(); }
  else if (typeof frontmatter.description === 'string' && frontmatter.description.trim()) title = frontmatter.description.trim();
  return { frontmatter, title, body };
}

// A rule's glob as a trigger glob: repository-relative, and across folders when
// the rule gave a bare file pattern (`*.ts` applies anywhere in Cursor; a DD glob
// stays within one folder).
function triggerGlob(glob) {
  let text = String(glob ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!text) return null;
  if (!text.includes('/')) text = `**/${text}`;
  return validRelativePath(text) ? text : null;
}

const slug = file => basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'rule';
const humanize = file => { const stem = basename(file, extname(file)).replace(/[-_]+/g, ' ').trim(); return stem.charAt(0).toUpperCase() + stem.slice(1); };
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// A rule longer than a body is cut at a paragraph and points at its file, which
// the agent can read; the memory records that it was cut.
function fitBody(body, file) {
  const pointer = `\n\n(More in ${file}.)`;
  if (body.length <= BODY_MAX) return { text: body, truncated: false };
  const room = BODY_MAX - pointer.length;
  const cut = body.lastIndexOf('\n\n', room);
  const head = (cut > room / 2 ? body.slice(0, cut) : body.slice(0, room)).trimEnd();
  return { text: `${head}${pointer}`, truncated: true };
}

function listRuleFiles(root, { dir, area, extensions }) {
  const found = [];
  const walk = folder => {
    let entries = [];
    try { entries = readdirSync(join(root, folder), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (extensions.includes(extname(entry.name).toLowerCase())) found.push({ file: path, area });
    }
  };
  walk(dir);
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

const areaOf = dir => (/cursor/i.test(dir) ? 'cursor' : /claude/i.test(dir) ? 'claude' : slug(dir));
const sameRule = (a, b) => a.title === b.title && a.body === b.body && a.not_derivable === b.not_derivable
  && JSON.stringify(a.triggers) === JSON.stringify(b.triggers) && a.evidence[0]?.sha256 === b.evidence[0]?.sha256;

function projectIdOf(root, memories) {
  try {
    const configured = JSON.parse(readFileSync(join(localPaths(root).dd, 'config.json'), 'utf8')).project_id;
    if (typeof configured === 'string' && configured.trim()) return configured;
  } catch { /* no config */ }
  return memories[0]?.project_id ?? basename(root);
}

export async function importRules(root, { from = null, dryRun = false, now = new Date() } = {}) {
  const sources = from
    ? [{ dir: String(from).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''), area: areaOf(from), extensions: ['.md', '.mdc'] }]
    : RULE_SOURCES;
  const files = sources.flatMap(source => listRuleFiles(root, source));
  const listing = presentFilesOf(root);
  const store = createMemoryFiles(localPaths(root).dd);
  const existing = await store.list();
  const live = existing.filter(memory => LIVE_STATUSES.includes(memory.status));
  const projectId = projectIdOf(root, existing);
  const report = { dry_run: dryRun, imported: [], updated: [], unchanged: [], skipped: [], warnings: [] };
  const put = [];
  const at = now.toISOString();
  for (const { file, area } of files) {
    const { frontmatter, title, body } = parseRuleFile(readFileSync(join(root, file), 'utf8'));
    const raw = frontmatter.paths ?? frontmatter.globs ?? [];
    const declared = [...new Set((Array.isArray(raw) ? raw : [raw]).map(triggerGlob).filter(Boolean))];
    if (frontmatter.alwaysApply === true || !declared.length) {
      report.skipped.push({ file, reason: 'no_paths', hint: 'An always-on rule belongs in CLAUDE.md or AGENTS.md; DD delivers knowledge scoped to files.' });
      continue;
    }
    const paths = (listing ? declared.filter(glob => listing.some(path => globToRegExp(glob).test(path))) : declared).slice(0, LIMITS.list);
    if (!paths.length) { report.skipped.push({ file, reason: 'no_live_paths', hint: `No file in the repository matches ${declared.join(', ')}.` }); continue; }
    const dropped = declared.filter(glob => !paths.includes(glob));
    if (dropped.length) report.warnings.push({ file, dropped_globs: dropped, hint: 'No file in the repository matches them; the memory keeps the globs that match.' });
    if (!body) { report.skipped.push({ file, reason: 'empty_body', hint: 'The file states no rule under its frontmatter.' }); continue; }
    const topic = `rules/${area}/${slug(file)}`;
    const previous = live.find(memory => memory.topic === topic);
    if (previous && !previous.evidence.some(entry => entry.type === 'file' && entry.path === file)) {
      report.skipped.push({ file, reason: 'topic_taken', hint: `A live memory already holds ${topic} and was not imported from this file.` });
      continue;
    }
    const fitted = fitBody(body, file);
    const memory = {
      schema_version: SCHEMA_VERSION, id: previous?.id ?? randomUUID(), project_id: previous?.project_id ?? projectId, topic, kind: 'procedure', status: 'active',
      title: (title ?? humanize(file)).slice(0, LIMITS.title), body: fitted.text,
      not_derivable: `Stated in ${file}, a rules file outside the code; DD delivers it at the files it names, on every harness.`.slice(0, LIMITS.not_derivable),
      triggers: [{ on: ['read', 'edit', 'write'], paths }],
      evidence: [{ type: 'file', path: file, sha256: sha256(join(root, file)), summary: 'The rules file this memory was imported from.' }],
      origin: 'user_explicit', replaces: null,
      revisit_when: [{ kind: 'file_changed', path: file, description: 'The rules file changed since the import.' }],
      review: { migrated: false, issues: fitted.truncated ? ['imported_truncated'] : [], accepted: { by: 'person', at } },
      created: previous?.created ?? at, updated: at,
    };
    const problems = validateMemory(memory);
    if (problems.length) { report.skipped.push({ file, reason: `invalid:${problems.join(',')}`, hint: 'The rule cannot be stored as a memory as it is.' }); continue; }
    if (previous && sameRule(previous, memory)) { report.unchanged.push({ file, id: previous.id, topic }); continue; }
    put.push(memory);
    (previous ? report.updated : report.imported).push({ file, id: memory.id, topic, paths, ...(fitted.truncated ? { truncated: true } : {}) });
  }
  if (!dryRun && put.length) {
    await store.commit({ put });
    await compileProject(root);
  }
  return report;
}

