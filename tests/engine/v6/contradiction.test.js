import { describe, test } from 'node:test';
import assert from 'node:assert';
import { validateExplicitContradiction } from '../../../src/engine/v6/contradiction.js';

const atomA = { id: 'a', project_id: 'p1', scope: 'project', lifecycle_state: 'active' };
const atomB = { id: 'b', project_id: 'p1', scope: 'project', lifecycle_state: 'active' };

describe('V6 explicit contradiction validation', () => {
  test('valid same-project compatible-scope pair passes', () => {
    assert.deepStrictEqual(validateExplicitContradiction(atomA, atomB), { valid: true });
  });

  test('missing atom fails', () => {
    assert.deepStrictEqual(validateExplicitContradiction(atomA, null), { valid: false, reason: 'atom_not_found' });
  });

  test('cross-project fails', () => {
    const other = { ...atomB, project_id: 'p2' };
    assert.deepStrictEqual(validateExplicitContradiction(atomA, other), { valid: false, reason: 'cross_project' });
  });

  test('incompatible scope fails', () => {
    const other = { ...atomB, scope: 'file' };
    assert.deepStrictEqual(validateExplicitContradiction(atomA, other), { valid: false, reason: 'scope_mismatch' });
  });

  test('same atom id fails', () => {
    assert.deepStrictEqual(validateExplicitContradiction(atomA, { ...atomA }), { valid: false, reason: 'self_contradiction' });
  });
});
