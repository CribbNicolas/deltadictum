'use strict';

// This machine's settings for one project (.dd/local/settings.json, never committed): what one person
// turns on or off for themselves, not for the team, changed from the review UI. An environment variable
// overrides each for one process: CI and DD's own tests set DD_MAINTENANCE=0, and DD_CAPTURE_PAYLOADS
// records to a file of its own.
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const MACHINE_DEFAULTS = { maintenance: true, record_payloads: false };
const MACHINE_FILE = 'settings.json';
const PAYLOADS_FILE = 'payloads.jsonl';

function machineSettings(local) {
  let file = {};
  try { file = JSON.parse(readFileSync(join(local, MACHINE_FILE), 'utf8')) ?? {}; } catch { /* no file: the defaults */ }
  const settings = {};
  for (const [key, fallback] of Object.entries(MACHINE_DEFAULTS)) settings[key] = typeof file[key] === 'boolean' ? file[key] : fallback;
  return settings;
}

const maintenanceOn = local => process.env.DD_MAINTENANCE !== '0' && machineSettings(local).maintenance;

// What the harness sent this hook, one JSON line each: for checking a harness's payload shapes against a
// real session. Into .dd/local/payloads.jsonl when the setting is on; into the variable's file when set.
function recordPayload(local, command, payload) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), command, payload })}\n`;
  const targets = [process.env.DD_CAPTURE_PAYLOADS, machineSettings(local).record_payloads ? join(local, PAYLOADS_FILE) : null];
  for (const target of targets.filter(Boolean)) {
    try { appendFileSync(target, line); } catch { /* a record is best effort */ }
  }
}

module.exports = { MACHINE_DEFAULTS, MACHINE_FILE, PAYLOADS_FILE, machineSettings, maintenanceOn, recordPayload };
