import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preToolRequest } from '../../src/hooks/pre-tool.js';

// Host tools that load skills, search tools, report on subagents or wait carry
// no project work: retrieving on them only adds noise.
test('host meta tools make no retrieval request', () => {
  for (const tool of ['Skill', 'ToolSearch', 'SubagentHandback', 'Monitor', 'TaskStop', 'AskUserQuestion', 'ScheduleWakeup'])
    assert.equal(preToolRequest({ tool_name: tool, tool_input: { skill: 'superpowers:brainstorming' } }), null, tool);
  assert.ok(preToolRequest({ tool_name: 'Read', tool_input: { file_path: 'src/a.js' } }));
  assert.ok(preToolRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } }));
});
