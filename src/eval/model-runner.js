import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CASES } from './cases.js';
import { evaluationStore, staticContext } from './replay.js';
import { retrieveMemories } from '../engine/retrieve.js';

// Explicit adapter invocation is opt-in: no credentials, model SDK or paid calls
// are required by the plugin. The same task contract is supplied to every model.
function argument(name) { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; }
function invoke(adapter, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [adapter], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('adapter_timeout')); }, 120000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 64000) { child.kill(); reject(new Error('adapter_output_too_large')); } });
    child.stderr.on('data', chunk => { if (errors.length < 1000) errors += chunk; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.stdin.on('error', err => { clearTimeout(timer); child.kill(); reject(err); });
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(`adapter_failed:${errors}`));
      else { try { resolveResult(JSON.parse(output)); } catch (err) { reject(err); } } });
    child.stdin.end(JSON.stringify(input));
  });
}

const adapter = argument('--adapter');
const model = argument('--model');
const limit = Number(argument('--limit') ?? CASES.length);
if (!adapter || !model || !Number.isInteger(limit) || limit < 1 || limit > CASES.length) {
  console.error(`Usage: npm run eval:models -- --adapter /absolute/adapter.mjs --model MODEL [--out report.json] [--limit 1..${CASES.length}]`);
  process.exitCode = 2;
} else {
  const store = await evaluationStore();
  const rows = [];
  try {
    for (const scenario of CASES.slice(0, limit)) for (const mode of ['none', 'static', 'dd']) {
      const context = mode === 'none' ? [] : mode === 'static' ? staticContext()
        : (await retrieveMemories({ ...scenario, project_id: 'eval', telemetry: false }, { store })).memories;
      const started = performance.now();
      // Expected answers are never sent to the model adapter.
      const { expected, decision, review, ...task } = scenario;
      const result = await invoke(resolve(adapter), { model, mode, task, context,
        choices: ['reuse_key', 'new_migration', 'inject_clock', 'sqlite', 'request_id', 'delivery_id', 'review_decision', 'inspect_project'],
        instruction: 'Choose the next action supported by current project knowledge. Respect applicability and changed assumptions. If no applicable project guidance is supplied, choose inspect_project. Return JSON with decision and actual provider usage if available.' });
      rows.push({ case: scenario.id, mode, model, decision: result.decision, correct: result.decision === decision,
        elapsed_ms: Math.round(performance.now() - started), usage: result.usage ?? null });
    }
    const summary = Object.fromEntries(['none', 'static', 'dd'].map(mode => {
      const group = rows.filter(r => r.mode === mode);
      return [mode, { correct: group.filter(r => r.correct).length, total: group.length,
        elapsed_ms: group.reduce((sum, r) => sum + r.elapsed_ms, 0),
        input_tokens: group.every(r => Number.isFinite(r.usage?.input_tokens)) ? group.reduce((sum, r) => sum + r.usage.input_tokens, 0) : null }];
    }));
    const out = resolve(argument('--out') ?? 'output/eval/model-results.json');
    await mkdir(resolve(out, '..'), { recursive: true });
    await writeFile(out, JSON.stringify({ kind: 'model_decision_evaluation', model, summary, rows,
      limits: 'Decision benchmark; does not establish code-quality or development-speed improvements on real repositories.' }, null, 2));
    console.log(JSON.stringify({ model, summary, report: out }, null, 2));
  } finally { store.close(); }
}
