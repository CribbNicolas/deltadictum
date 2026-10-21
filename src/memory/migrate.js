import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createWriteLock, recoverTransaction } from '../store/transactions.js';
import { convertV1 } from './convert-v1.js';
import { ensureIgnored } from './ignore.js';
import { LIVE_STATUSES, validateMemory } from './schema.js';
import { createMemoryFiles } from './store.js';

// A v1 store (schema 7 files under .dd/) converted to v2 memories. Everything is
// converted and validated before anything is written: one problem leaves the
// store as it was, and the report names it. The real run holds the store's
// write lock and applies any pending v1 write first, so nothing a v1 process
// committed is deleted unconverted.
const KNOWLEDGE_DIRS = ['atoms', 'candidates', 'archive', 'legacy'];
// Everything only v1 read: its knowledge, registry and actions, its relations
// (v2 records a supersession on the memory), and the local files its resident
// kept (an index, observations, the UI's address).
const V1_DIRS = [...KNOWLEDGE_DIRS, 'registry', 'actions', 'relations.json', 'data', 'observations', 'ui.json'];
const KEPT_FILES = ['config.json'];
const JOURNAL = '.pending-write.json';

// v1's settings as v2 reads them: the project id, auto-accept (off stays off;
// on is the default) and retirement. Every other key is v1's and is dropped.
function v2Config(config) {
  const next = {};
  const dropped = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (key === 'project_id' || key === 'retire') next[key] = value;
    else if (key === 'auto_accept' && value && typeof value === 'object') {
      if (value.enabled === false) next.auto_accept = false;
      dropped.push(...Object.keys(value).filter(inner => inner !== 'enabled').map(inner => `auto_accept.${inner}`));
    } else if (key === 'auto_accept') next.auto_accept = value;
    else dropped.push(key);
  }
  return { config: next, dropped };
}

// Every file under dir, sorted, so a report names the same files on every platform.
async function filesUnder(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const nested = await Promise.all(entries.map(entry => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)])));
  return nested.flat();
}
const exists = path => access(path).then(() => true, () => false);
const tally = (list, key) => list.reduce((counts, item) => ({ ...counts, [item[key]]: (counts[item[key]] ?? 0) + 1 }), {});

async function planMigration(ddDir, { dryRun }) {
  const name = file => relative(ddDir, file).replaceAll('\\', '/');
  const files = (await Promise.all(KNOWLEDGE_DIRS.map(dir => filesUnder(join(ddDir, dir))))).flat();
  // A file the migration would not convert is never deleted along with its folder.
  const unexpected = files.filter(file => !file.endsWith('.json')).map(name);
  const atoms = [];
  const unreadable = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const atom = JSON.parse(await readFile(file, 'utf8'));
      if (atom && typeof atom === 'object') atoms.push(atom); else unreadable.push(name(file));
    } catch { unreadable.push(name(file)); }
  }
  const titles = new Map(atoms.map(atom => [atom.id, atom.title]));
  const liveByTopic = new Map(atoms.filter(atom => ['active', 'contested'].includes(atom.lifecycle_state)).map(atom => [atom.topic_key, atom.title]));
  const memories = atoms.map(atom => {
    const memory = convertV1(atom, { titles, liveByTopic });
    // A live memory needs a trigger: one that converts without any waits as a candidate.
    return LIVE_STATUSES.includes(memory.status) && !memory.triggers.length ? { ...memory, status: 'candidate' } : memory;
  });
  const failures = memories.map(memory => ({ id: memory.id, topic: memory.topic, reasons: validateMemory(memory) }))
    .filter(failure => failure.reasons.length);
  const ids = new Set();
  for (const memory of memories) {
    if (ids.has(memory.id)) failures.push({ id: memory.id, topic: memory.topic, reasons: ['duplicate_id'] });
    ids.add(memory.id);
  }
  const liveTopics = new Set();
  for (const memory of memories.filter(m => LIVE_STATUSES.includes(m.status))) {
    if (liveTopics.has(memory.topic)) failures.push({ id: memory.id, topic: memory.topic, reasons: ['live_topic_conflict'] });
    liveTopics.add(memory.topic);
  }
  const present = [];
  for (const dir of V1_DIRS) if (await exists(join(ddDir, dir))) present.push(dir);
  const kept = [];
  for (const file of KEPT_FILES) if (await exists(join(ddDir, file))) kept.push(file);
  let settings = null;
  try { settings = v2Config(JSON.parse(await readFile(join(ddDir, 'config.json'), 'utf8'))); } catch { /* none, or not JSON: left as it is */ }
  return {
    memories,
    settings,
    report: {
      config_dropped: settings?.dropped ?? [],
      dry_run: dryRun, converted: memories.length, by_status: tally(memories, 'status'), by_kind: tally(memories, 'kind'),
      review_issues: memories.flatMap(m => m.review.issues).reduce((counts, issue) => ({ ...counts, [issue]: (counts[issue] ?? 0) + 1 }), {}),
      failures, unreadable, unexpected, pending_journal: await exists(join(ddDir, JOURNAL)),
      dropped_actions: (await filesUnder(join(ddDir, 'actions'))).length, removed: [], would_remove: present, kept,
    },
  };
}

export async function migrateProject({ ddDir, dryRun = false } = {}) {
  if (dryRun || !await exists(ddDir)) return (await planMigration(ddDir, { dryRun })).report;
  return createWriteLock(ddDir)(async () => {
    await recoverTransaction(ddDir);
    const { memories, settings, report } = await planMigration(ddDir, { dryRun });
    if (report.failures.length || report.unreadable.length || report.unexpected.length) return report;
    if (memories.length) await createMemoryFiles(ddDir).commit({ put: memories, preserveDates: true });
    if (settings) await writeFile(join(ddDir, 'config.json'), `${JSON.stringify(settings.config, null, 2)}\n`);
    await ensureIgnored(ddDir);
    for (const dir of report.would_remove) await rm(join(ddDir, dir), { recursive: true, force: true });
    return { ...report, removed: report.would_remove, would_remove: [] };
  });
}
