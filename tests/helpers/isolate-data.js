// Loaded with --import by every test script: DD's data base (resolveDataBase in
// src/project.js) points at a temporary directory, so no test or hook process it
// spawns writes a project's index, telemetry or seen state under the developer's
// real ~/.dd-data (runs before this left hundreds of alpha-*, beta-*, prompt-*
// directories there). Child processes inherit the variables.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.DD_TEST_DATA_BASE) {
  process.env.DD_TEST_DATA_BASE = mkdtempSync(join(tmpdir(), 'dd-test-data-'));
  process.env.CLAUDE_PLUGIN_DATA = process.env.DD_TEST_DATA_BASE;
  delete process.env.GROK_PLUGIN_DATA;
}

// Session start spawns detached maintenance once a day; in a test it would hold
// files in a temporary project the test is about to delete. Tests of maintenance
// turn it back on for the processes they spawn.
process.env.DD_MAINTENANCE = '0';
