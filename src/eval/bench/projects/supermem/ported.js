// The 2026-10-14 trial's tasks (src/eval/agent/tasks-v2.js) on the bench, at the trial's base, labelled
// with a situation. turn-fixed-test is left out: its only requirement is the judge's, and calibration
// decides on checks alone.
import { TASKS as TRIAL } from '../../../agent/tasks-v2.js';

// 7c9106f's parent: 7c9106f itself added tasks-v2.js and trial-memories.js, the trial's answer key, and its
// src/ outside src/eval is the parent's.
const BASE = 'ce8d33e';
const SITUATIONS = {
  'maintain-fires-test': 'S3', 'cli-archive': 'S4', 'clause-kind': 'S5', 'stop-asks-telemetry': 'S2',
  'test-capture-script': 'S20', 'maintenance-log': 'S13', 'keyword-ies-plural': 'S11', 'recall-json': 'S11', 'ui-kind-filter': 'S11',
};

export const PORTED_TASKS = TRIAL.filter(task => task.id in SITUATIONS).map(task => ({
  ...task, id: `supermem-${task.id}`, project: 'supermem', situation: SITUATIONS[task.id], origin: 'authored',
  memories: task.memory ? [task.memory] : [], requirements: task.requirements ?? [], base: BASE,
}));
