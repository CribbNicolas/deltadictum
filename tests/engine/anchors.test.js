import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorTerms, matchAnchors, validateAnchors, anchorCollisions } from '../../src/engine/anchors.js';

const memory = (anchors, extra = {}) => ({
  title: 'Endurance sets travel range', trigger: 'When designing the Endurance attribute or travel range.',
  trigger_variants: ['Diseñar la Resistencia del personaje y el alcance de viaje'],
  behavior_delta: 'Keep Endurance separate from Strength.', applies_to: { files: [], components: ['character'], operations: [] },
  anchors, ...extra,
});

test('a keyword matches whole words, accent and case insensitive, and simple plurals', () => {
  const atom = memory({ keywords: ['resistencia', 'endurance attribute'], not_when: [] });
  assert.deepEqual(matchAnchors(atom, 'Exploremos la RESISTÉNCIA del jugador').hits, ['resistencia']);
  assert.deepEqual(matchAnchors(atom, 'two endurance attributes').hits, ['endurance attribute']);
  // Whole words only: no substring hits.
  assert.deepEqual(matchAnchors(atom, 'resistencias').hits, ['resistencia']);
  assert.deepEqual(matchAnchors(atom, 'irresistencia').hits, []);
  assert.deepEqual(matchAnchors(atom, 'attribute endurance').hits, []);
});

test('a not_when phrase blocks the memory even when a keyword matches', () => {
  const atom = memory({ keywords: ['resistencia'], not_when: ['resistencia electrica'] });
  const result = matchAnchors(atom, 'calcular la resistencia eléctrica del cable');
  assert.deepEqual(result.hits, ['resistencia']);
  assert.deepEqual(result.blocked, ['resistencia electrica']);
});

test('valid anchors pass', () => {
  assert.deepEqual(validateAnchors(memory({ keywords: ['resistencia', 'endurance'], not_when: [] })), []);
});

test('anchors are required to be at least two, grounded and specific', () => {
  assert.ok(validateAnchors(memory({ keywords: ['endurance'], not_when: [] })).includes('too_few_anchor_keywords'));
  // Not in the memory's own text: an anchor nobody wrote down cannot be reviewed against it.
  assert.ok(validateAnchors(memory({ keywords: ['endurance', 'stamina'], not_when: [] })).includes('ungrounded_anchor:stamina'));
  // A lone generic term matches half of all requests.
  const generic = memory({ keywords: ['endurance', 'travel'], not_when: [] }, { behavior_delta: 'Keep Endurance separate; change travel code.' });
  assert.deepEqual(validateAnchors(generic), []);
  const vague = memory({ keywords: ['endurance', 'code'], not_when: [] }, { behavior_delta: 'Keep Endurance separate in code.' });
  assert.ok(validateAnchors(vague).includes('generic_anchor:code'));
  assert.ok(validateAnchors(memory({ keywords: ['endurance', 'de la'], not_when: [] })).includes('stopword_anchor:de la'));
  assert.ok(validateAnchors(memory({ keywords: ['endurance', 'x1'], not_when: [] })).includes('short_anchor:x1'));
  assert.ok(validateAnchors(memory({ keywords: ['endurance', 'the endurance attribute of a character'], not_when: [] }))
    .includes('long_anchor:the endurance attribute of a character'));
});

test('an anchor that fires on content-free or generic requests is refused', () => {
  const atom = memory({ keywords: ['endurance', 'plan'], not_when: [] }, { behavior_delta: 'Keep Endurance separate; follow the plan.' });
  assert.ok(validateAnchors(atom).some(r => r.startsWith('anchor_fires_on_generic_request:plan')));
});

test('anchor terms feed full-text search', () => {
  assert.deepEqual(anchorTerms(memory({ keywords: ['Resistencia', 'endurance'], not_when: [] })), ['resistencia', 'endurance']);
  assert.deepEqual(anchorTerms(memory(undefined)), []);
});

test('a keyword shared by several other memories is reported as a collision', () => {
  const others = [1, 2, 3].map(i => ({ id: `m${i}`, anchors: { keywords: ['inventory', `x${i}thing`] } }));
  assert.deepEqual(anchorCollisions(memory({ keywords: ['inventory', 'endurance'] }), others), [{ keyword: 'inventory', memories: 3 }]);
  assert.deepEqual(anchorCollisions(memory({ keywords: ['endurance'] }), others), []);
});

test('a memory stored before anchors existed is the same knowledge as its unanchored re-proposal', async () => {
  const { sameKnowledge, normalizeProposal } = await import('../../src/engine/contract.js');
  const proposal = normalizeProposal({ trigger: 't', behavior_delta: 'd', why: 'w', evidence_refs: [] }, 'p');
  const { anchors, ...stored } = proposal;
  assert.ok(sameKnowledge(stored, proposal));
  assert.ok(!sameKnowledge(stored, { ...proposal, anchors: { keywords: ['endurance', 'stamina'], not_when: [] } }));
});

// A knowledge file can be edited by hand, past validation. Delivery uses only the
// keywords that would pass it, so a bad one can never push the memory.
test('a keyword that fails validation never matches, even when stored', () => {
  const atom = memory({ keywords: ['endurance', 'plan'], not_when: [] }, { behavior_delta: 'Keep Endurance separate; follow the plan.' });
  assert.deepEqual(matchAnchors(atom, 'seguimos con el plan').hits, []);
  assert.deepEqual(matchAnchors(atom, 'the endurance plan').hits, ['endurance']);
});
