// Every task of a project, proven three ways on a fresh clone: the check fails untouched, passes the
// correct solution with every requirement met, and (memory tasks) passes the naive solution as asked while
// some requirement catches it breaking the memory. A task with no correct overlay is proven untouched only
// (tasks ported from an earlier trial, proven there); one with no naive overlay skips that run (mined
// tasks, whose deciding test is both the task and the memory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareClone, removeClone } from '../../src/eval/bench/clone.js';

export function proveTasks(project, solutions, { only = null } = {}) {
  for (const task of project.tasks.filter(t => !only || only.includes(t.id))) {
    const has = variant => existsSync(fileURLToPath(new URL(`${task.id}/${variant}/`, solutions)));
    test(`${task.id}: the check fails untouched${has('correct') ? ', passes the correct solution' : ''}${task.kind === 'memory' && has('naive') ? ' and catches the naive one' : ''}`, async () => {
      const run = async overlay => {
        const { dir } = await prepareClone(project, task, 'none');
        try {
          const folder = overlay ? fileURLToPath(new URL(`${task.id}/${overlay}/`, solutions)) : null;
          if (folder) cpSync(folder, dir, { recursive: true, filter: source => !source.endsWith('ANSWER.md') });
          // A review task's answer is the agent's report: its solution folder carries it as ANSWER.md.
          const answer = folder && existsSync(`${folder}ANSWER.md`) ? readFileSync(`${folder}ANSWER.md`, 'utf8') : '';
          return await task.check(dir, answer);
        } finally { await removeClone(dir, project); }
      };
      const untouched = await run(null);
      assert.equal(untouched.passed, false, `untouched: ${untouched.detail}`);
      if (!has('correct')) return;
      const correct = await run('correct');
      assert.equal(correct.passed, true, `correct: ${correct.detail}`);
      assert.ok(Object.values(correct.requirements ?? {}).every(v => v === true), `correct requirements: ${correct.detail}`);
      if (task.kind === 'memory' && has('naive')) {
        const naive = await run('naive');
        assert.equal(naive.passed, true, `naive passes the task as asked: ${naive.detail}`);
        assert.ok(Object.values(naive.requirements ?? {}).some(v => v === false), `naive breaks the memory: ${naive.detail}`);
      }
    });
  }
}
