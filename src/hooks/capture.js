export const STOP_CAPTURE_PROMPT = [
  'If this session produced a reusable lesson, anti-memory, or decision, call propose at most one time',
  'with trigger, behavior_delta, evidence_refs, and micro+short forms.',
  'If nothing should change next time, do not propose.',
  'Do not dump the transcript or tool logs.',
].join(' ');
