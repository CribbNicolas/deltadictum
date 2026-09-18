#!/usr/bin/env node
// Re-derives `evidence_state` and `confidence` for stored knowledge from what
// its references resolve to now.
//
// Knowledge written before the reliability ladder carries a flat confidence the
// ladder can never produce, and usually no evidence_state at all, because
// verification did not exist when it was stored. Its references are still there
// and still resolvable, so the honest value is the one the evidence earns.
//
// This is not a review and does not behave like one: authority, lifecycle state
// and the review stamp never move, so nothing is promoted and a `canonical`
// grant stays where the reviewer put it.
//
// Read-only by default. Pass --apply to write, which rewrites git-tracked
// knowledge files — inspect the dry run and commit before applying.

import { openStore } from '../src/project.js';
import { reverifyStoredEvidence } from '../src/engine/reverify.js';

const apply = process.argv.includes('--apply');
const { store, projectId, ddDir } = await openStore();
try {
  const report = await reverifyStoredEvidence({ store, projectId, apply });
  console.log(`${ddDir} · project ${projectId} · ${report.scanned} memories scanned`);
  if (!report.changed.length && !report.skipped.length) {
    console.log('Every stored confidence already matches the evidence it carries.');
  }
  for (const row of report.changed) {
    const move = row.from === row.to ? `${row.to} (evidence recorded)` : `${row.from} -> ${row.to}`;
    console.log(`  ${row.topic_key} · ${row.authority} · ${row.provenance} · ${move}`);
  }
  for (const row of report.skipped) {
    console.log(`  SKIPPED ${row.topic_key} · ${row.reason}`);
  }
  if (report.changed.length) {
    console.log(apply
      ? `\nApplied to ${report.changed.length} memories. Review the diff with git before committing.`
      : `\n${report.changed.length} memories would change. Re-run with --apply to write them.`);
  }
} finally { store.close(); }
