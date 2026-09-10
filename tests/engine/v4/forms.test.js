import { describe, test } from 'node:test';
import assert from 'node:assert';
import { selectForm } from '../../../src/engine/v4/forms.js';

const forms = [
  { form_type: 'micro', content: 'micro form', token_estimate: 5 },
  { form_type: 'short', content: 'short form body', token_estimate: 40 },
  { form_type: 'full', content: 'full form body with rationale', token_estimate: 200 },
];

describe('V4 form selection', () => {
  test('returns preferred form when it fits the remaining budget', () => {
    const form = selectForm(forms, 'short', 100);
    assert.strictEqual(form.form_type, 'short');
  });

  test('downgrades full -> short -> micro as budget shrinks', () => {
    assert.strictEqual(selectForm(forms, 'full', 250).form_type, 'full');
    assert.strictEqual(selectForm(forms, 'full', 100).form_type, 'short');
    assert.strictEqual(selectForm(forms, 'full', 10).form_type, 'micro');
  });

  test('never upgrades above preferred form', () => {
    assert.strictEqual(selectForm(forms, 'micro', 1000).form_type, 'micro');
  });

  test('returns null when nothing fits or no forms exist', () => {
    assert.strictEqual(selectForm(forms, 'short', 3), null);
    assert.strictEqual(selectForm([], 'short', 1000), null);
  });

  test('unknown preferred type behaves as short', () => {
    assert.strictEqual(selectForm(forms, 'mystery', 100).form_type, 'short');
  });
});
