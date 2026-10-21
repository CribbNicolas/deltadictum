// A stand-in for the pre-tool hook, timed by the bench: start Node, read the
// event and the memories, match, claim in the session ledger, answer.
//   node hook-sim.mjs <memories.json> <ledger.jsonl>  < event.json
import { appendFileSync, readFileSync } from 'node:fs';
import { memoryMatch } from '../../engine/clause.cjs';

const [indexPath, ledgerPath] = process.argv.slice(2);
const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
const memories = JSON.parse(readFileSync(indexPath, 'utf8'));
const claimed = () => {
  try {
    return new Set(readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line).memory; } catch { return null; } }));
  } catch { return new Set(); }
};
const before = claimed();
const fire = memories.filter(m => m.status === 'active' && !before.has(m.id) && memoryMatch(m, event));
for (const m of fire) appendFileSync(ledgerPath, `${JSON.stringify({ epoch: 0, memory: m.id, pid: process.pid })}\n`);
claimed(); // claim-first: the re-read the production ledger makes
process.stdout.write(JSON.stringify({ additionalContext: fire.map(m => m.body).join('\n') }));
