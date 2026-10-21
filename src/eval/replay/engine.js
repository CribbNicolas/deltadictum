import { compileIndex } from '../../engine/compile.js';
import { matchEvent, prepareIndex } from '../../engine/match.cjs';

// The production delivery engine behind the bench's replay interface.
export const productionEngine = {
  prepare: memories => prepareIndex(compileIndex({ memories, manifest: { count: 0, hash: '' } }).index),
  fire: (runtime, event) => matchEvent(runtime, event),
};
