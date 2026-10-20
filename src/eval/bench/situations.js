// The vocabulary of the full benchmark (docs/superpowers/specs/2026-10-16-bench-full-design.md):
// each task belongs to one situation, which fixes what it tests about DD beyond
// whether the agent knows the rule, and one origin, so invented results never
// pass for real ones.
export const SITUATIONS = {
  S1: 'Trap that looks right',
  S2: 'Distant consequence',
  S3: 'Platform or environment',
  S4: 'Decision without a trace in the code',
  S5: 'Multi-step procedure',
  S6: 'Memory needed late',
  S7: 'Vague prompt',
  S8: 'Two memories at once',
  S9: 'Superseded memory',
  S10: 'The user asks for the opposite',
  S11: 'Control: nothing applies',
  S12: 'Large realistic store',
  S13: 'Write only',
  S14: 'Long task',
  S15: 'Green tests that lie',
  S16: 'Debugging a known trap',
  S17: 'Recovery from the failure',
  S18: 'Review with a planted violation',
  S19: 'Generated code',
  S20: 'Shell command trap',
};

export const ORIGINS = ['mined', 'authored', 'invented'];

// docdd, added after the full benchmark, carries both channels: the referenced guide and DD.
export const CONDITIONS = ['dd2', 'docref', 'doc', 'none', 'docdd'];
// The conditions that run with DD's store and hook, and the guide each documentation condition writes.
export const WITH_DD = ['dd2', 'docdd'];
export const GUIDE = { doc: 'unreferenced', docref: 'referenced', docdd: 'referenced' };
