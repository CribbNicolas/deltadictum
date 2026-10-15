import { localPaths } from '../engine/locate.cjs';
import { captureFunnel } from '../maintenance/health.js';
import { openTelemetry, rollUp } from '../maintenance/telemetry.js';
import { createMemoryFiles } from '../memory/store.js';
import { readSettings } from './config.js';

const TOP = 10;
const round = (value, places = 0) => { const k = 10 ** places; return Math.round(value * k) / k; };

// What DD's telemetry says about use, for the review UI's dashboard: how much a
// delivery carries, how often the cap was hit, which memories fire most, how many
// sessions and tool calls there were, and the capture funnel. Counts only; no content.
export async function dashboard(root) {
  const titles = new Map((await createMemoryFiles(localPaths(root).dd).list()).map(memory => [memory.id, memory.title]));
  const db = openTelemetry(root);
  try {
    rollUp(root, db);
    const one = sql => db.prepare(sql).get();
    const sessions = one('SELECT COUNT(*) AS n FROM sessions').n;
    const withDeliveries = one('SELECT COUNT(DISTINCT session) AS n FROM deliveries').n;
    const toolCalls = one('SELECT COALESCE(SUM(count), 0) AS n FROM events').n;
    const totals = one('SELECT COUNT(*) AS total, COALESCE(AVG(memories), 0) AS memories_avg, COALESCE(AVG(chars), 0) AS chars_avg, COALESCE(MAX(chars), 0) AS chars_max, COALESCE(SUM(named > 0), 0) AS capped FROM deliveries');
    const byKind = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM deliveries GROUP BY kind ORDER BY kind').all().map(row => [row.kind, row.n]));
    const top = db.prepare('SELECT memory, COUNT(*) AS fires, COUNT(DISTINCT session) AS sessions FROM fire_events GROUP BY memory ORDER BY fires DESC, memory ASC LIMIT ?').all(TOP)
      .map(row => ({ memory: row.memory, title: titles.get(row.memory) ?? row.memory, fires: row.fires, sessions: row.sessions }));
    return {
      limit: readSettings(root).delivery_limit,
      sessions: { total: sessions, with_deliveries: withDeliveries, tool_calls: toolCalls },
      deliveries: { total: totals.total, memories_avg: round(totals.memories_avg, 1), chars_avg: round(totals.chars_avg), chars_max: totals.chars_max,
        capped: totals.capped, capped_share: totals.total ? round(totals.capped / totals.total, 2) : 0,
        per_100_tool_calls: toolCalls ? round(totals.total / toolCalls * 100, 1) : 0 },
      by_kind: byKind,
      top,
      capture: captureFunnel(db),
    };
  } finally { db.close(); }
}
