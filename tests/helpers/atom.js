import { SCHEMA_VERSION } from '../../src/engine/contract.js';

// Every stored atom carries these; the store refuses one without them
// (unsupportedReason in src/engine/contract.js). Fixtures spread it in.
export const PROVENANCE = Object.freeze({ schema_version: SCHEMA_VERSION, capture_origin: 'user_explicit', capture_source: 'agent' });
