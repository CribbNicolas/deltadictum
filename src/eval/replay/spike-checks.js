// Checks written by hand for the spike from memories the trial exercised. Two
// enforce a requirement the trial verdicts (scored); the others only count how
// often they would speak.
export const SPIKE_CHECKS = [
  {
    memory: 'testing/store-handle-hangs-node-test',
    requirement: 'store_closed_in_after',
    check: {
      on: ['edit', 'write'], paths: ['tests/**/*.test.js'],
      if_content: String.raw`createMemoryStore|scratchStore|openStore|mkdtemp`, unless_content: String.raw`t\.after\(`,
      say: 'This test opens a store without closing it in t.after.',
      examples: {
        violates: 'const store = await createMemoryStore(dir);\nassert.ok(x);\nawait store.close();',
        passes: 'const store = await createMemoryStore(dir);\nt.after(() => store.close());',
      },
    },
  },
  {
    memory: 'testing/quote-test-globs',
    requirement: 'globs_quoted',
    check: {
      on: ['edit', 'write'], paths: ['package.json'],
      if_content: String.raw`--test\b[^"\n]*\s(?!\\")[^\s"\\]*\*`,
      say: 'An npm test script passes an unquoted glob; wrap it in escaped double quotes so node --test expands it.',
      examples: {
        violates: String.raw`"test:x": "node --test tests/**/*.test.js",`,
        passes: String.raw`"test:x": "node --test \"tests/**/*.test.js\"",`,
      },
    },
  },
  {
    memory: 'dd/engine/auto-accept-threshold-reachable-ceilings',
    requirement: null,
    check: {
      on: ['edit', 'write'], paths: ['src/store/paths.js', '.dd/config.json'],
      if_content: String.raw`confidence_threshold"?\s*:\s*0\.8\b`,
      say: '0.8 is not a reachable confidence ceiling: it behaves exactly like 0.85.',
      examples: { violates: 'confidence_threshold: 0.8 }', passes: 'confidence_threshold: 0.85 }' },
    },
  },
];

export const SPIKE_COMMAND_CHECKS = [
  {
    memory: 'testing/store-handle-hangs-node-test',
    check: { on: ['run'], if_command: String.raw`--test-force-exit`, say: '--test-force-exit crashes tests/hooks/resident.test.js on Windows.' },
  },
];
