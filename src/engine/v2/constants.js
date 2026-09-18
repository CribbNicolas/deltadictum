export const MEMORY_TYPES = Object.freeze(['claim', 'decision', 'lesson', 'anti_memory', 'procedure']);
export const MEMORY_SCOPES = Object.freeze(['project', 'user', 'agent', 'workflow', 'file', 'service']);
export const LIFECYCLE_STATES = Object.freeze(['candidate', 'active', 'contested', 'superseded', 'archived', 'rejected']);
// `update` is reserved for the collision routing that proposes a revision instead
// of a sibling. `warn` was removed: there is no state between advising and
// blocking while every write already stops at a candidate awaiting review.
export const ADMISSION_DECISIONS = Object.freeze(['write', 'update', 'observe', 'ignore', 'block', 'contest']);
export const EVIDENCE_TYPES = Object.freeze(['test_log', 'tool_output', 'file', 'diff', 'trace', 'decision', 'user_approval', 'artifact']);
export const FORM_TYPES = Object.freeze(['micro', 'short', 'full']);
