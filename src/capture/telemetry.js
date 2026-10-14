import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { localPaths } from '../engine/locate.cjs';

// Telemetry files DD appends off the hot path, one JSON line per event
// (identifiers, outcomes and reasons; never content), rolled up by maintenance
// (src/maintenance/telemetry.js). Best effort: a line that cannot be written is
// lost, never an error.
export const telemetryDir = root => join(localPaths(root).local, 'telemetry');

export function appendTelemetry(root, name, entry) {
  try {
    mkdirSync(telemetryDir(root), { recursive: true });
    appendFileSync(join(telemetryDir(root), name), `${JSON.stringify(entry)}\n`);
  } catch { /* telemetry is best effort */ }
}
