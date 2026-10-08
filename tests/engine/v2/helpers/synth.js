// Memories built from a fixture's own events so every clause dimension, `not`
// and `not_paths` meets real paths, commands, identifiers and prompts. The
// compiled matcher must answer exactly as the reference on all of them.
const KINDS = ['trap', 'decision', 'fact', 'failed_approach', 'procedure'];

export function synthesizeMemories(fixture, count = 60) {
  const events = fixture.runs.flatMap(run => run.events);
  const byKind = kind => events.filter(e => e.kind === kind);
  const pools = { read: byKind('read'), edit: byKind('edit'), run: byKind('run'), prompt: byKind('prompt') };
  const pick = (kind, i) => pools[kind][(i * 7) % Math.max(1, pools[kind].length)];
  const memories = [];
  for (let i = 0; i < count; i += 1) {
    const read = pick('read', i);
    const edit = pick('edit', i);
    const run = pick('run', i);
    const prompt = pick('prompt', i);
    const path = read?.paths?.[0] ?? 'src/x.js';
    const folder = path.includes('/') ? `${path.split('/')[0]}/**` : '**';
    const symbol = (edit?.text?.match(/[A-Za-z_$][\w$]{4,}/g) ?? ['nothing'])[i % 3] ?? 'nothing';
    const command = (run?.text ?? 'node --test').split(/\s+/).slice(0, 2).join(' ');
    const phrase = (prompt?.text ?? 'test').split(/\s+/).filter(w => w.length > 3).slice(i % 4, i % 4 + 2).join(' ') || 'test';
    const clauses = [
      { on: ['read', 'edit', 'write'], paths: [i % 2 ? folder : path] },
      { on: ['edit', 'write'], paths: [folder], symbols: [symbol] },
      { on: ['run'], commands: [command], ...(i % 5 === 0 ? { not: ['force'] } : {}) },
      { on: ['prompt', 'search'], keywords: [phrase], ...(i % 3 === 0 ? { not_paths: ['tests/**'] } : {}) },
      { on: ['search', 'edit', 'prompt'], symbols: [symbol] },
    ];
    memories.push({ id: `s${String(i).padStart(3, '0')}`, topic: `synth/m${i}`, kind: KINDS[i % KINDS.length], status: i % 11 ? 'active' : 'contested',
      title: `Synthetic ${i}`, body: `Body ${i}`, evidence: [], triggers: clauses.filter((_, j) => (i + j) % 3 !== 0) });
  }
  return memories;
}
