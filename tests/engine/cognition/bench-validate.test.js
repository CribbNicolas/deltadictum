import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, ORIGINS, SITUATIONS } from '../../../src/eval/bench/situations.js';
import { projectProblems, taskProblems, validateProjects } from '../../../src/eval/bench/validate.js';

const memory = topic => ({ topic, kind: 'trap', title: `Rule ${topic}`, body: 'Do it.', not_derivable: 'Hidden.', triggers: [{ on: ['read'], paths: ['a.go'] }], evidence: [] });
const task = (over = {}) => ({ id: 'tg-retry', project: 'tg', situation: 'S1', origin: 'invented', kind: 'memory', memories: ['net/retry'],
  prompt: 'Add retries.', requirements: [{ id: 'jitter', auto: true, text: 'Retries use jitter.' }], check: async () => ({ passed: false, detail: '' }), ...over });
const project = (over = {}) => ({ id: 'tg', language: 'Go', repo: '/x/tg', base: 'main', invented: true, guideTarget: 'CLAUDE.md', store: 'bench',
  memories: [memory('net/retry'), memory('net/old')], suite: { command: 'go', args: ['test', './...'], timeoutMs: 1000 }, lint: null,
  programs: ['go'], strip: [], links: [], probeFile: 'README.md', tasks: [task()], ...over });

test('the situations, origins and conditions are the spec\'s', () => {
  assert.deepEqual(Object.keys(SITUATIONS), Array.from({ length: 20 }, (_, i) => `S${i + 1}`));
  assert.deepEqual(ORIGINS, ['mined', 'authored', 'invented']);
  assert.deepEqual(CONDITIONS, ['dd2', 'docref', 'doc', 'none']);
});

test('a well-formed project and task have no problems', () => {
  assert.deepEqual(projectProblems(project()), []);
  assert.deepEqual(taskProblems(task(), project()), []);
});

test('a task is refused for each field that breaks the format', () => {
  const p = project();
  assert.ok(taskProblems(task({ id: 'retry' }), p).includes('id'));
  assert.ok(taskProblems(task({ situation: 'S21' }), p).includes('situation'));
  assert.ok(taskProblems(task({ origin: 'authored' }), p).includes('origin'));
  assert.ok(taskProblems(task({ memories: ['net/none'] }), p).includes('memories'));
  assert.ok(taskProblems(task({ memories: [] }), p).includes('memories'));
  assert.ok(taskProblems(task({ requirements: [{ id: 'x', text: 'judged' }] }), p).includes('auto_requirement'));
  assert.ok(taskProblems(task({ withheld: ['net/none'] }), p).includes('withheld'));
  assert.ok(taskProblems(task({ check: null }), p).includes('check'));
});

test('controls carry no memory except S10, which names the one its prompt contradicts', () => {
  const p = project();
  assert.ok(taskProblems(task({ kind: 'control', situation: 'S11', requirements: [] }), p).includes('memories'));
  assert.deepEqual(taskProblems(task({ kind: 'control', situation: 'S11', memories: [], requirements: [] }), p), []);
  assert.deepEqual(taskProblems(task({ kind: 'control', situation: 'S10', requirements: [] }), p), []);
});

test('a mined task names its source commit and only real projects have mined or authored tasks', () => {
  const real = project({ invented: false, tasks: [] });
  assert.ok(taskProblems(task({ origin: 'mined' }), real).includes('source'));
  assert.deepEqual(taskProblems(task({ origin: 'mined', source: 'abc1234' }), real), []);
  assert.ok(taskProblems(task({ origin: 'invented' }), real).includes('origin'));
});

test('validation lists every problem and duplicate task ids across projects', () => {
  const other = project({ id: 'tg2', tasks: [task({ id: 'tg-retry', project: 'tg2' })] });
  assert.throws(() => validateProjects([project(), other]), err => /bench_invalid/.test(err.message) && /tg-retry: id/.test(err.message) && /duplicate tg-retry/.test(err.message));
  assert.doesNotThrow(() => validateProjects([project()]));
});

test('a project is refused for a missing command, an unknown store or guide target', () => {
  assert.ok(projectProblems(project({ suite: null })).includes('suite'));
  assert.ok(projectProblems(project({ store: 'other' })).includes('store'));
  assert.ok(projectProblems(project({ guideTarget: 'README.md' })).includes('guideTarget'));
  assert.ok(projectProblems(project({ id: 'Bad Id' })).includes('id'));
});

test('a task on a project with an existing store runs at the project base, where the store was read', () => {
  const p = project({ invented: false, store: 'existing' });
  assert.ok(taskProblems(task({ origin: 'authored', base: 'abc1234' }), p).includes('base'));
  assert.deepEqual(taskProblems(task({ origin: 'authored' }), p), []);
});
