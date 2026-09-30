import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { MINIMUM_NODE, supportedNode } = createRequire(import.meta.url)('../../hooks/node-support.cjs');

// node:sqlite arrived unflagged in 22.13 but without FTS5 until 22.16, and the
// store's first statement creates an FTS5 table: 22.13-22.15 failed every open.
test('the supported Node floor is the first 22.x whose node:sqlite has FTS5', () => {
  assert.equal(MINIMUM_NODE, '22.16.0');
  for (const version of ['22.16.0', 'v22.16.1', '22.20.0', '23.0.0', '24.21.0', '26.1.0']) assert.equal(supportedNode(version), true, version);
  for (const version of ['20.19.0', '22.0.0', '22.13.0', 'v22.15.1', '21.99.99']) assert.equal(supportedNode(version), false, version);
  assert.equal(supportedNode(), true, 'the Node running the suite is supported');
});

test('package.json engines states the same floor the hooks enforce', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, `>=${MINIMUM_NODE}`);
});
