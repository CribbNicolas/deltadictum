import { createRequire } from 'node:module';
import { presentFilesOf } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { captureFunnel, healthReport } from '../maintenance/health.js';
import { openTelemetry } from '../maintenance/telemetry.js';
import { LIVE_STATUSES } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';
import { readSettings } from './config.js';

const { globToRegExp } = createRequire(import.meta.url)('../engine/clause.cjs');

const TOP = 10;
const DAYS = 7;
const SPOTS = 8;
const round = (value, places = 0) => { const k = 10 ** places; return Math.round(value * k) / k; };

// What DD's telemetry says about use, for the review UI's dashboard: how much a
// delivery carries, how often the cap was hit, which memories fire most, how many
// sessions and tool calls there were, and the capture funnel. Counts only; no content.
export async function dashboard(root) {
  const memories = await createMemoryFiles(localPaths(root).dd).list();
  const titles = new Map(memories.map(memory => [memory.id, memory.title]));
  const liveMemories = memories.filter(memory => LIVE_STATUSES.includes(memory.status));
  const live = liveMemories.map(memory => memory.id);
  const tally = key => Object.fromEntries([...liveMemories.reduce((counts, memory) => counts.set(key(memory), (counts.get(key(memory)) ?? 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  // The health report rolls the telemetry up and judges each memory (never fired with opportunity, no opportunity).
  const health = await healthReport(root);
  const withSignal = signal => health.memories.filter(memory => live.includes(memory.id) && memory.signals.some(s => s.signal === signal)).length;
  const db = openTelemetry(root);
  try {
    const one = sql => db.prepare(sql).get();
    const sessions = one('SELECT COUNT(*) AS n FROM sessions').n;
    const withDeliveries = one('SELECT COUNT(DISTINCT session) AS n FROM deliveries').n;
    const toolCalls = one('SELECT COALESCE(SUM(count), 0) AS n FROM events').n;
    const totals = one('SELECT COUNT(*) AS total, COALESCE(AVG(memories), 0) AS memories_avg, COALESCE(AVG(chars), 0) AS chars_avg, COALESCE(MAX(chars), 0) AS chars_max, COALESCE(SUM(named > 0), 0) AS capped FROM deliveries');
    const byKind = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM deliveries GROUP BY kind ORDER BY kind').all().map(row => [row.kind, row.n]));
    const top = db.prepare('SELECT memory, COUNT(*) AS fires, COUNT(DISTINCT session) AS sessions FROM fire_events GROUP BY memory ORDER BY fires DESC, memory ASC').all()
      // A memory deleted since it fired is history, not something a person can open.
      .filter(row => titles.has(row.memory)).slice(0, TOP)
      .map(row => ({ memory: row.memory, title: titles.get(row.memory), fires: row.fires, sessions: row.sessions }));
    const byVia = Object.fromEntries(db.prepare("SELECT COALESCE(NULLIF(via, ''), 'unknown') AS via, COUNT(*) AS n FROM fire_events GROUP BY 1 ORDER BY 1").all().map(row => [row.via, row.n]));
    const checks = { fixed: 0, ignored: 0, repeated: 0 };
    for (const row of db.prepare('SELECT outcome, COUNT(*) AS n FROM checks GROUP BY outcome').all()) if (row.outcome in checks) checks[row.outcome] = row.n;
    const deliveredEver = db.prepare('SELECT COUNT(DISTINCT memory) AS n FROM fires WHERE memory IN (SELECT value FROM json_each(?))').get(JSON.stringify(live)).n;
    const days = new Map();
    const dayOf = at => String(at ?? '').slice(0, 10);
    for (const row of db.prepare('SELECT first_at FROM sessions WHERE first_at IS NOT NULL').all()) {
      const day = dayOf(row.first_at); days.set(day, { day, sessions: (days.get(day)?.sessions ?? 0) + 1, deliveries: days.get(day)?.deliveries ?? 0 });
    }
    for (const row of db.prepare('SELECT at FROM deliveries WHERE at IS NOT NULL').all()) {
      const day = dayOf(row.at); days.set(day, { day, sessions: days.get(day)?.sessions ?? 0, deliveries: (days.get(day)?.deliveries ?? 0) + 1 });
    }
    const byDay = [...days.values()].filter(row => row.day).sort((a, b) => a.day.localeCompare(b.day)).slice(-DAYS);
    return {
      limit: readSettings(root).delivery_limit,
      sessions: { total: sessions, with_deliveries: withDeliveries, tool_calls: toolCalls },
      deliveries: { total: totals.total, memories_avg: round(totals.memories_avg, 1), chars_avg: round(totals.chars_avg), chars_max: totals.chars_max,
        capped: totals.capped, capped_share: totals.total ? round(totals.capped / totals.total, 2) : 0,
        per_100_tool_calls: toolCalls ? round(totals.total / toolCalls * 100, 1) : 0 },
      by_kind: byKind,
      top,
      by_via: byVia,
      checks,
      coverage: { live: live.length, delivered_ever: deliveredEver, never_fired_with_opportunity: withSignal('never_fired_with_opportunity'), no_opportunity: withSignal('no_opportunity') },
      by_day: byDay,
      capture: captureFunnel(db),
      kinds: tally(memory => memory.kind),
      areas: tally(memory => memory.topic.split('/')[0]),
      blind_spots: blindSpots(root, db, liveMemories),
    };
  } finally { db.close(); }
}

// Files the agent keeps reading or changing that no live memory's paths cover: where knowledge the code
// does not show may be missing. A hint for a person, never a memory: most such files need none. Only
// repository files count (a run's tokens are not paths), and DD's own folder never does.
function blindSpots(root, db, liveMemories) {
  const files = presentFilesOf(root);
  if (!files) return [];
  const present = new Set(files);
  const covered = liveMemories.flatMap(memory => memory.triggers.flatMap(clause => clause.paths ?? [])).map(glob => globToRegExp(glob));
  return db.prepare(`SELECT path, COUNT(DISTINCT session) AS sessions, COUNT(DISTINCT CASE WHEN kind IN ('edit', 'write') THEN session END) AS changed
    FROM touches WHERE kind IN ('read', 'edit', 'write') GROUP BY path ORDER BY sessions DESC, changed DESC, path ASC`).all()
    .filter(row => row.sessions > 1 && present.has(row.path) && !row.path.startsWith('.dd/') && !covered.some(regex => regex.test(row.path)))
    .slice(0, SPOTS).map(row => ({ path: row.path, sessions: row.sessions, changed: row.changed }));
}
