import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flags } from '../../src/eval/bench/projects/fixture-checks.js';
import { idleUnder30s } from '../../src/eval/bench/projects/tollgate/checks.js';
import { truncatingOpen } from '../../src/eval/bench/projects/ledgerkit/checks.js';

test('an idle timeout under 30 seconds is found as a field, an assignment or the shared constructor', () => {
  assert.equal(idleUnder30s('return &http.Client{Transport: &http.Transport{IdleConnTimeout: 25 * time.Second}}'), true);
  assert.equal(idleUnder30s('t := http.DefaultTransport.(*http.Transport).Clone()\nt.IdleConnTimeout = 25 * time.Second'), true);
  assert.equal(idleUnder30s('return relay.NewHTTPClient()'), true);
  assert.equal(idleUnder30s('return &http.Client{Timeout: 10 * time.Second}'), false);
  assert.equal(idleUnder30s('t.IdleConnTimeout = 90 * time.Second'), false);
  assert.equal(idleUnder30s('t.IdleConnTimeout = 25 * time.Second\nreturn http.DefaultClient'), false);
});

test('a review flag needs every pattern in one list item, not anywhere in the report', () => {
  const answer = '1. The name round_half_up is fine.\n2. The rate is taken from the first entry.\n3. No tests.';
  assert.equal(flags(answer, /\bround/i, /\bhalf[ -](?:to[ -])?even\b|\bper (?:line|entry)\b/i), false);
  assert.equal(flags('- The VAT is rounded once on the sum; round each line half to even instead.\n- No tests.', /\bround/i, /\bhalf[ -](?:to[ -])?even\b/i), true);
  assert.equal(flags('Notes:\n\n1. signs one form\n2. sends the canonical bytes', /sign/i, /canonical/i), false);
});

test('a truncating open is found with nested parentheses, and atomic_write is not one', () => {
  assert.equal(truncatingOpen('with open(os.path.join(book, "rules.json"), "w", encoding="utf-8") as f:'), true);
  assert.equal(truncatingOpen("f = open(path, 'w')"), true);
  assert.equal(truncatingOpen('storage.atomic_write(path, text)'), false);
  assert.equal(truncatingOpen('with open(path, encoding="utf-8") as f:'), false);
  assert.equal(truncatingOpen('with open(path, "rb") as f:'), false);
});
