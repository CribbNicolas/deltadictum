// Stands in for `claude -p` in the bench harness's own test: writes the answer
// file the fixture task checks and prints the stream-json lines the runner reads.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
writeFileSync(join(cwd, 'answer.txt'), 'done\n');
const lines = [
  { type: 'system', subtype: 'init', cwd },
  { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: join(cwd, 'answer.txt') } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] } },
  { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 120, output_tokens: 5 }, content: [{ type: 'text', text: 'Wrote answer.txt.' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Wrote answer.txt.', total_cost_usd: 0.01, num_turns: 2, duration_ms: 50,
    usage: { input_tokens: 220, output_tokens: 15 } },
];
for (const line of lines) console.log(JSON.stringify(line));
