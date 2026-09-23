import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksNonEnglish } from '../../src/engine/language.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';

test('prose in another language is detected; English with code, paths and names is not', () => {
  assert.equal(looksNonEnglish('Separar domain, application, infrastructure y client. La arquitectura documentada y las APIs separan simulación y presentación.'), true);
  assert.equal(looksNonEnglish('Antes de exportar, restaurar el editor con dotnet restore --locked-mode porque project.assets.json cambia.'), true);
  assert.equal(looksNonEnglish('Keep rules in domain; the UI sends commands to GameShell.Presentation.cs and reads GameView.'), false);
  assert.equal(looksNonEnglish('Run npm test before editing src/engine/retrieve.js; see docs/memory/roadmap.md (Gap 6).'), false);
  assert.equal(looksNonEnglish('Use the Patriark refugio scene name as-is when it appears in logs.'), false);
});

test('a memory written in another language is refused with a reason the agent can act on', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-lang-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const result = await proposeMemory({ project_id: 'demo', topic_key: 'architecture/core/layers',
    trigger: 'Al agregar lógica de juego, comandos o presentación.',
    behavior_delta: 'Separar domain, application, infrastructure y client.',
    why: 'La arquitectura documentada separa la simulación de la presentación.',
    evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'Layers' }] }, { store });
  assert.equal(result.decision, 'block');
  assert.ok(result.reasons.includes('memory_must_be_english'));
});

// Memories are English-only, so the English preventive words must all count:
// "Never overwrite..." was refused while the Spanish "nunca" was accepted.
test('an English anti-memory phrased with "never" or "must not" is preventive', async () => {
  const { decideAdmission } = await import('../../src/engine/v2/admission.js');
  for (const delta of ['Never overwrite a save with an unknown version.', 'You must not rewrite git atoms.']) {
    const result = decideAdmission({ project_id: 'demo', memory_type: 'anti_memory', scope: 'project', title: 't', trigger: 'when saving games',
      behavior_delta: delta, what: delta, why: 'Data loss.', topic_key: 'a/b/c', evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 's' }],
      retrieval_forms: { micro: delta, short: delta } });
    assert.ok(!result.reasons.includes('anti_memory_requires_preventive_delta'), delta);
  }
});
