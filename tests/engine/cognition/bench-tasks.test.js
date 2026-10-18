import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidanceFor, loadBench } from '../../../src/eval/bench/tasks.js';

const memory = (topic, status = 'active') => ({ topic, kind: 'trap', title: `Rule ${topic}`, body: `Body of ${topic}.`, not_derivable: 'Hidden.', status,
  triggers: [{ on: ['read'], paths: ['a.go'] }], evidence: [] });
const task = over => ({ id: 'tg-a', project: 'tg', situation: 'S8', origin: 'invented', kind: 'memory', memories: ['x/one', 'x/two'], prompt: 'Do.',
  requirements: [{ id: 'r', auto: true, text: 'R.' }], check: async () => ({ passed: false }), ...over });
const project = { id: 'tg', language: 'Go', repo: '/r', base: 'main', invented: true, guideTarget: 'CLAUDE.md', store: 'bench',
  memories: [memory('x/one'), memory('x/two'), memory('x/old', 'superseded')], suite: { command: 'go', args: [], timeoutMs: 1 }, lint: null,
  programs: [], strip: [], links: [], probeFile: 'README.md', tasks: [task()] };

test('the bench loads a registry, validates it and labels tasks with their language', async () => {
  const { projects, tasks } = await loadBench({ PROJECTS: [project] });
  assert.equal(projects.length, 1);
  assert.equal(tasks[0].language, 'Go');
  await assert.rejects(loadBench({ PROJECTS: [{ ...project, tasks: [task({ situation: 'S99' })] }] }), /bench_invalid/);
});

test('the judge\'s guidance holds every live memory the task bears on, and nothing for a control', async () => {
  const { projects, tasks } = await loadBench({ PROJECTS: [project] });
  const text = guidanceFor(tasks[0], projects);
  assert.match(text, /Rule x\/one/);
  assert.match(text, /Rule x\/two/);
  assert.equal(guidanceFor({ ...tasks[0], memories: [] }, projects), null);
  assert.equal(guidanceFor({ ...tasks[0], memories: ['x/old'] }, projects), null);
});

test('the default registry is valid', async () => {
  await assert.doesNotReject(loadBench());
});
