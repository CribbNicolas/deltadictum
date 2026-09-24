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

  test('an empty review rationale is not blocked, it falls back to a recorded default', async () => {
    const html = await readFile(htmlPath, 'utf8');
    // The server still requires a non-empty rationale (INV-04's audit trail), but
    // the reviewer should never be forced to type one for a plain approve-as-is:
    // a blank field still records an explicit, on-the-record decision.
    assert.match(html, /const DEFAULT_REVIEW_RATIONALE = 'Reviewed as proposed\.'/);
    assert.match(html, /admit[\s\S]{0,400}rationale: detailEl\.querySelector\('\[name="review_rationale"\]'\)\.value\.trim\(\) \|\| DEFAULT_REVIEW_RATIONALE/,
      'admit must fall back to the default rationale when the field is left blank');
    assert.match(html, /resolve[\s\S]{0,400}rationale: detailEl\.querySelector\('\[name="review_rationale"\]'\)\.value\.trim\(\) \|\| DEFAULT_REVIEW_RATIONALE/,
      'resolve must fall back to the default rationale when the field is left blank');
  });

  test('a retired memory can be seen and brought back from the page', async () => {
    const html = await readFile(htmlPath, 'utf8');
    // Archiving is reversible only if the reversal is reachable. Without the
    // filter option the archived set is invisible, and the loss is unnoticed.
    assert.match(html, /<option value="archived">archived<\/option>/, 'the filter must list archived memories');
    assert.match(html, /data-act="restore"/, 'an archived memory must offer a restore action');
    assert.match(html, /encodeURIComponent\(selected\.id\) \+ '\/restore'/, 'restore must call the restore endpoint');
    assert.match(html, /Nothing was deleted/, 'the page must say that archiving is not deletion');
  });
});

// Review finding 4: a merge or split result is admitted as validated, so the
// reviewer must see all of it before applying, escaped, with ambient flagged.
test('the Actions panel shows every field of a merge result, escaped', async () => {
  const { runInNewContext } = await import('node:vm');
  const html = await readFile(htmlPath, 'utf8');
  const pick = name => html.match(new RegExp(String.raw`    function ${name}\([^)]*\) \{[\s\S]*?\r?\n    \}\r?\n`))[0];
  const renderResult = runInNewContext(`${pick('escapeHtml')}${pick('renderResult')}; renderResult`);
  const out = renderResult({ memory_type: 'decision', topic_key: 'demo/a/b', trigger: 'when <x>', behavior_delta: 'Do y.', why: 'Because z.',
    applies_to: { files: ['src/a.js'], components: [], operations: [] }, tags: ['ambient'],
    evidence_refs: [{ source_type: 'file', source_ref: 'src/a.js', summary: 's' }] });
  for (const expected of ['decision', 'demo/a/b', 'When: when &lt;x&gt;', 'Do: Do y.', 'Why: Because z.', 'files: src/a.js',
    'ambient: sent at every session start', 'file src/a.js', 'admitted as validated']) assert.ok(out.includes(expected), expected);
  assert.doesNotMatch(out, /<x>/);
});
