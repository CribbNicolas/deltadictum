import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), '../../src/ui/public/index.html');

describe('audit UI form fields', () => {
  test('title and topic_key inputs bind the atom value attribute', async () => {
    const html = await readFile(htmlPath, 'utf8');
    assert.match(
      html,
      /<input name="\$\{name\}" value="\$\{escapeHtml\(value \?\? ''\)\}"/,
      'input fields must set value= so title and topic_key render',
    );
  });
});
