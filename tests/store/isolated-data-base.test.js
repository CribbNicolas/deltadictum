import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolveDataBase } from '../../src/project.js';

test('tests never write under the developer data base', () => {
  assert.ok(process.env.DD_TEST_DATA_BASE, 'run through npm test, which loads tests/helpers/isolate-data.js');
  assert.ok(!resolveDataBase().startsWith(homedir() + '\.dd-data') && !resolveDataBase().startsWith(homedir() + '/.dd-data'));
});
