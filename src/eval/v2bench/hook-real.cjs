'use strict';

// The production hot path as a pre-tool hook runs it, timed by the bench:
//   node hook-real.cjs <project root> <session id>  < event.json
// Plan 3 wraps this flow in the harness adapters; nothing here may require ESM.
// Most events fire nothing, so the ledger and delivery modules load only when
// something fires. Staleness is not checked here: every write recompiles the
// index, and session start catches changes made outside DD.
const { readFileSync } = require('node:fs');
const { loadIndex, readBodies } = require('../../engine/index-file.cjs');
const { matchEvent, prepareIndex } = require('../../engine/match.cjs');

try {
  const [root, session] = process.argv.slice(2);
  const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const index = loadIndex(root);
  const fired = index ? matchEvent(prepareIndex(index), event) : [];
  if (fired.length) {
    const { ledgerPath, openLedger } = require('../../engine/ledger.cjs');
    const { localPaths } = require('../../engine/locate.cjs');
    const { renderDelivery, staleEvidence } = require('../../engine/deliver.cjs');
    const path = ledgerPath(localPaths(root).sessions, session);
    const won = path ? new Set(openLedger(path).claim(fired.map(hit => hit.id))) : new Set(fired.map(hit => hit.id));
    const items = fired.filter(hit => won.has(hit.id));
    if (items.length) {
      const bodies = readBodies(root) ?? {};
      const text = renderDelivery({ label: (event.paths ?? []).join(', ') || event.kind, items: items.map(hit => ({ id: hit.id,
        ...index.memories[hit.id], body: bodies[hit.id]?.body ?? '', stale: staleEvidence(root, bodies[hit.id]?.evidence) })) });
      process.stdout.write(JSON.stringify({ additionalContext: text }));
    }
  }
} catch { /* fail open */ }
process.exit(0);
