import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationFromPrompt, observationFromTool } from '../../src/hooks/observe.js';

// The pure observation rules of src/hooks/observe.js, kept from the v1 capture and
// corrections tests when the v1 hook path and the MCP server were removed. Plan 4
// builds capture on them.

// Realistic phrasing, not keyword bait: this is how a correction is actually
// typed mid-session, in both languages the codebase already detects.
test('a user correction in English or Spanish is observed', () => {
  for (const prompt of [
    'No, that is wrong - the gate reads reliability before the anti-memory rule.',
    'You broke the eval run. Revert the ranking change.',
    'Use the project-scoped query instead of scanning every atom.',
    'I told you not to touch the schema file.',
    'That is not what I asked for; the hook must stay advisory.',
    'Stop editing the plan and read src/ first.',
    'Wrong file - the surfacing lives in run.js.',
    'No, eso esta mal. Revierte el commit anterior.',
    'Te dije que no modifiques el esquema, solo el indice.',
    'No uses una expresion regular aqui, usa el parser existente.',
    'Eso no es lo que pedi: la promocion sigue siendo humana.',
    'Te equivocaste de rama, deshaz ese merge.',
  ]) assert.ok(observationFromPrompt({ prompt }), `missed correction: ${prompt}`);
});

// The test that keeps the review queue usable. A flooded queue makes the top
// reliability rung meaningless, so this list is longer than the positive one and
// deliberately includes ordinary prompts carrying correction-adjacent words.
test('ordinary work is not mistaken for a correction', () => {
  for (const prompt of [
    'Add a test for the prompt observation path.',
    'Do not forget to update the roadmap when this closes.',
    'Run the suite and stop the UI server when it finishes.',
    'Use zod for the tool schema.',
    'No tests exist for this branch yet; please add some.',
    'Implement stage 5 exactly as the plan describes.',
    'It is not clear why verifyReferences returns unreviewed support.',
    'Explain how the retrieval budget is applied.',
    'Continue with the next part of the task.',
    'Commit the change with a message explaining the tradeoff.',
    'Check whether the observation is pruned by retention.',
    'Undoing is not in scope here, just describe the ladder.',
    'Puedes agregar una prueba para el detector?',
    'Necesito que no se rompa el build en Windows.',
    'Haz un resumen de los cambios de esta etapa.',
    'Revisa el archivo de configuracion y dime que falta.',
  ]) assert.equal(observationFromPrompt({ prompt }), null, `false correction: ${prompt}`);
});

// Claude Code hands its own notifications to UserPromptSubmit as prompts: a finished background task, a
// subagent's report, a reminder. Their text is no user's (seen 2026-10-17: an auditor's report saying it
// "overrode" verdicts "instead of" the judge's was recorded as a correction three times).
test('a notification from the harness is not a user correction, and a correction after one still is', () => {
  for (const prompt of [
    '<task-notification>\n<task-id>a1</task-id>\n<status>failed</status>\n<summary>Agent "audit" failed: use the limit instead of retrying</summary>\n</task-notification>',
    '<agent-message from="a751ceb1966939208">\n[Subagent hand-back] I overrode 2 verdicts instead of the judge\'s; you should not have trusted it.\n</agent-message>',
    '<system-reminder>\nDo not use the old API.\n</system-reminder>',
    '<cross-session-message from="worker">That is wrong, revert it.</cross-session-message>',
    '<local-command-caveat>Caveat.</local-command-caveat>\n<command-name>/rate-limit-options</command-name>\n<local-command-stdout>Do not change this.</local-command-stdout>',
    '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event, NOT a message from the user.\nDo NOT interpret this as user acknowledgement.',
  ]) assert.equal(observationFromPrompt({ prompt }), null, `harness text taken as a correction: ${prompt.slice(0, 60)}`);
  const after = observationFromPrompt({ prompt: '<system-reminder>\nContext.\n</system-reminder>\nNo, that is wrong: revert the last edit.' });
  assert.ok(after);
  assert.doesNotMatch(after.raw_preview, /system-reminder/);
});

test('a correction is redacted and bounded like a tool observation', () => {
  const observation = observationFromPrompt({ prompt: 'No, that is wrong. The failing call used token=hunter2-live and sk-abcdefghijklmnop.' });
  assert.doesNotMatch(observation.raw_preview, /hunter2-live/);
  assert.doesNotMatch(observation.raw_preview, /abcdefghijklmnop/);
  const long = observationFromPrompt({ prompt: `No, that is wrong. ${'detail '.repeat(2000)}` });
  assert.ok(long.raw_preview.length <= 800);
});

test('a correction carries the ladder provenance and assigns no confidence itself', () => {
  const observation = observationFromPrompt({ prompt: 'No, that is wrong. Revert it.', session_id: 's' });
  assert.equal(observation.metadata.provenance, 'user_correction');
  assert.equal(observation.source_type, 'user_correction');
  assert.equal(observation.metadata.session_id, 's');
  assert.equal(observation.confidence, undefined);
  assert.equal(observation.metadata.confidence, undefined);
  assert.equal(observation.metadata.cap, undefined);
});


test('ordinary tool output is not captured; failures and explicit validation are bounded', () => {
  assert.equal(observationFromTool({ tool_name: 'Read', tool_response: { output: 'entire file contents' } }), null);
  const failed = observationFromTool({ tool_name: 'Bash', tool_response: { exit_code: 1, stderr: 'token=private-value failure' } });
  assert.equal(failed.metadata.provenance, 'host');
  assert.doesNotMatch(failed.raw_preview, /private-value/);
  assert.ok(observationFromTool({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exit_code: 0 } }));
  assert.equal(observationFromTool({ tool_name: 'Bash', tool_input: { command: 'cat file' }, tool_response: { exit_code: 0 } }), null);
});

// Shapes recorded from a real Claude Code session (2026-09-24): a successful
// Bash call carries no exit code, and a failing one fires PostToolUseFailure
// with an error string instead of PostToolUse.
test('Claude Code outcomes are read from the event, not from an exit code', () => {
  const claudeCode = { claudeCode: true };
  const passed = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { stdout: 'pass 42', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } };
  const validation = observationFromTool(passed, claudeCode);
  assert.equal(validation.source_type, 'validation');
  assert.equal(validation.metadata.exit_code, null);
  assert.match(validation.raw_preview, /^Validation passed \(PostToolUse\)/);
  assert.equal(observationFromTool({ ...passed, tool_input: { command: 'cat file' } }, claudeCode), null);
  assert.equal(observationFromTool({ ...passed, tool_response: { ...passed.tool_response, interrupted: true } }, claudeCode), null);
  // Another host sending the same event is not assumed to share its meaning.
  assert.equal(observationFromTool(passed), null);

  const failed = observationFromTool({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' },
    error: 'Exit code 3\nnot ok 1 token=private-value', is_timeout: false }, claudeCode);
  assert.equal(failed.source_type, 'tool_failure');
  assert.match(failed.raw_preview, /^Failed \(PostToolUseFailure\)\. Exit code 3/);
  assert.doesNotMatch(failed.raw_preview, /private-value/);
  assert.equal(observationFromTool({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', error: 'File does not exist.' }, claudeCode).source_type, 'tool_failure');
});

// Seen 2026-09-24: a piped test run exits with the pipe's last status, and a
// command that only reads a test file named "test"; both were recorded as passes.
test('a validation is a test run whose own exit status the host reported', () => {
  const claudeCode = { claudeCode: true };
  const run = (command, stdout = 'pass 42') => observationFromTool({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command }, tool_response: { stdout, stderr: '', interrupted: false } }, claudeCode);
  for (const command of ['npm test', 'cd /c/dev/supermem && npm test', 'npm run test:stress', 'node --test tests/a.test.js',
    'DD_RETRIEVAL=lexical npx vitest run', 'pytest -q', 'npx tsc --noEmit && npm run lint', 'dotnet test', 'go test ./...']) {
    assert.equal(run(command)?.source_type, 'validation', command);
  }
  for (const command of ['npm test 2>&1 | tail -15', 'npm test; echo done', 'npm test || true',
    'grep -n "test" tests/ui/server.test.js', 'sed -n 1,40p tests/helpers/resident.js', 'cat src/check.js',
    'git commit -m "fix: npm test | grep"', 'echo npm test']) {
    assert.equal(run(command), null, command);
  }
  // An exit status of 0 with failures in the output is not a pass.
  for (const stdout of ['ℹ tests 397\nℹ pass 396\nℹ fail 1', 'not ok 3 - an action', '✖ compact propose', 'AssertionError [ERR_ASSERTION]']) {
    assert.equal(run('npm test', stdout), null, stdout);
  }
  assert.equal(run('npm test', 'ℹ tests 397\nℹ pass 397\nℹ fail 0')?.source_type, 'validation');
  // Other hosts report an exit code; the same command rules apply.
  assert.equal(observationFromTool({ tool_name: 'Bash', tool_input: { command: 'npm test | tail' }, tool_response: { exit_code: 0 } }), null);
});

