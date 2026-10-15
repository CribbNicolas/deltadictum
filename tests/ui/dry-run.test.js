import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFootprint, footprintPath } from '../../src/capture/footprint.js';
import { dryRun } from '../../src/ui/dry-run.js';
import { project } from '../helpers/review.js';

test('triggers are tried on every recorded event; prompts cannot be judged and the run says so', async t => {
  const root = await project(t, []);
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', at: '2026-10-12T00:00:01.000Z', kind: 'edit', paths: ['src/a.js'], identifiers: ['aThing'] });
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', at: '2026-10-12T00:00:02.000Z', kind: 'run', paths: [], command: 'npm test' });
  appendFootprint(footprintPath(root, 's2'), { t: 'tool', at: '2026-10-12T00:00:03.000Z', kind: 'read', paths: ['src/b.js'] });
  const result = dryRun(root, [{ on: ['edit'], paths: ['src/*.js'], symbols: ['aThing'] }, { on: ['prompt'], keywords: ['release'] }]);
  assert.equal(result.scanned, 2);
  assert.equal(result.sessions, 1);
  assert.deepEqual(result.events.map(e => [e.session, e.kind, e.via]), [['s1', 'edit', ['paths', 'symbols']]]);
  assert.deepEqual(result.unjudged, ['prompt keywords: footprints keep no prompt text']);
});
