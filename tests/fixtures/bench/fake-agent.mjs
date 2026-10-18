// Stands in for `claude -p` in the bench harness's own test: writes the answer
// file the fixture task checks and prints the stream-json lines the runner reads.
// FAKE_AGENT_COMMIT=1 also commits the change, as an agent may; FAKE_AGENT_NOOP=1
// changes nothing, as a review task's agent does.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
if (!process.env.FAKE_AGENT_NOOP) writeFileSync(join(cwd, 'answer.txt'), 'done\n');
if (process.env.FAKE_AGENT_COMMIT) {
  execFileSync('git', ['-C', cwd, 'add', '-A']);
  execFileSync('git', ['-C', cwd, '-c', 'user.name=agent', '-c', 'user.email=agent@localhost', 'commit', '-q', '-m', 'answer']);
}
const lines = [
  { type: 'system', subtype: 'init', cwd },
  { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: join(cwd, 'answer.txt') } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] } },
  { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 120, output_tokens: 5 }, content: [{ type: 'text', text: 'Wrote answer.txt.' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Wrote answer.txt.', total_cost_usd: 0.01, num_turns: 2, duration_ms: 50,
    usage: { input_tokens: 220, output_tokens: 15 } },
];
for (const line of lines) console.log(JSON.stringify(line));
