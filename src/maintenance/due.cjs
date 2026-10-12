'use strict';

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { localPaths } = require('../engine/locate.cjs');

// When maintenance last started (spec section 8: at most once a day). A run that
// failed still counts, so a broken one is not retried at every session start.
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const markerPath = root => join(localPaths(root).local, 'maintenance.json');

function maintenanceDue(root, { now = Date.now(), intervalMs = INTERVAL_MS } = {}) {
  try {
    const started = Date.parse(JSON.parse(readFileSync(markerPath(root), 'utf8')).started);
    return !(now - started <= intervalMs);
  } catch { return true; }
}

function markMaintenance(root, state, { now = Date.now(), ...extra } = {}) {
  let previous = {};
  try { previous = JSON.parse(readFileSync(markerPath(root), 'utf8')); } catch { /* first run */ }
  const at = new Date(now).toISOString();
  const next = { ...previous, state, ...(state === 'started' ? { started: at } : { finished: at }), ...extra };
  mkdirSync(localPaths(root).local, { recursive: true });
  writeFileSync(markerPath(root), `${JSON.stringify(next, null, 2)}\n`);
}

module.exports = { INTERVAL_MS, maintenanceDue, markMaintenance };
