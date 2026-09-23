import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecret, redactSecrets } from '../../src/engine/v2/sanitizer.js';
import { normalizeProposal, validateContract } from '../../src/engine/contract.js';
import { observationFromTool } from '../../src/hooks/observe.js';

const CREDENTIALS = ['AKIAABCDEFGHIJKLMNOP', 'sk-ant-api03-abcdefghijklmnop', 'ghp_abcdefghijklmnopqrstuvwxyz0123',
  'github_pat_abcdefghijklmnopqrstuvwx', 'AIzaSyA1234567890abcdefghijklmnopqrstuv', 'xoxb-1234567890-abcdef',
  'npm_abcdefghijklmnopqrstuvwxyz0123456789', 'glpat-abcdefghijklmnopqrst', 'sk_live_abcdefghijklmnop1234',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', 'Bearer abcdefghijklmnopqrstuvwxyz012345',
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----'];

test('credentials in their issued shapes are detected and redacted; ordinary text is not', () => {
  for (const secret of CREDENTIALS) {
    assert.equal(containsSecret(`use ${secret} here`), true, secret);
    assert.equal(redactSecrets(`use ${secret} here`).includes(secret.slice(4, 16)), false, secret);
  }
  assert.equal(redactSecrets('export PASSWORD="hunter22"'), 'export PASSWORD=[redacted]');
  for (const text of ['use scikit-learn', 'the token budget', 'Bearer tokens expire', 'task-management-service', 'eyJ is base64 for {"'])
    assert.equal(containsSecret(text), false, text);
});

// Knowledge is committed to git and shared with everyone who clones the repo.
test('a proposal carrying a credential is refused', () => {
  const atom = normalizeProposal({ memory_type: 'lesson', title: 'Deploy', topic_key: 'ops/deploy/token', trigger: 'before deploying',
    behavior_delta: 'Export NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789 first.', why: 'The publish step needs it.',
    evidence_refs: [{ source_type: 'file', source_ref: 'package.json', summary: 'publish' }] }, 'demo');
  assert.ok(validateContract(atom).includes('contains_secret'));
});

test('observations keep no credential a command or its output carried', () => {
  const observation = observationFromTool({ tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" https://x' },
    tool_response: { exit_code: 1, stderr: 'AWS AKIAABCDEFGHIJKLMNOP denied' } });
  assert.ok(observation);
  assert.doesNotMatch(JSON.stringify(observation), /abcdefghijklmnopqrstuvwxyz012345|AKIAABCDEFGHIJKLMNOP/);
});
