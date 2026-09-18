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

  test('the reviewer can grant canonical from the page, not only from the API', async () => {
    const html = await readFile(htmlPath, 'utf8');
    // Confidence is capped by the source ladder unless review grants canonical,
    // so the one control that lifts the cap has to be reachable from the page.
    assert.match(html, /name="review_authority"/, 'the admit form must offer an authority to grant');
    assert.match(html, /<option value="canonical"/, 'canonical must be one of the options');
    assert.match(html, /<option value="validated"[^>]*selected/, 'validated stays the default');
    assert.match(html, /admit[\s\S]{0,400}authority: detailEl\.querySelector\('\[name="review_authority"\]'\)/,
      'the admit request must send the authority the reviewer chose');
  });

  test('the chosen authority is not resubmitted as authored content', async () => {
    const html = await readFile(htmlPath, 'utf8');
    // formValues() sweeps inputs and textareas into a PATCH proposal. A granted
    // authority is a review decision, never part of what the model authored.
    assert.match(html, /detailEl\.querySelectorAll\('input, textarea'\)/);
    assert.doesNotMatch(html, /<(input|textarea)[^>]*name="review_authority"/,
      'review_authority must not be an input or textarea, or formValues would resubmit it');
  });
});
