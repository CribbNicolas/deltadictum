// The format every bench project and task follows, checked before anything runs:
// a malformed task found mid-trial costs the runs already spent on it.
import { ORIGINS, SITUATIONS } from './situations.js';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isCommand = c => Boolean(c && typeof c.command === 'string' && Array.isArray(c.args) && Number.isFinite(c.timeoutMs));

export function projectProblems(project) {
  const problems = [];
  if (!ID.test(project.id ?? '')) problems.push('id');
  for (const key of ['language', 'repo', 'base', 'probeFile']) if (typeof project[key] !== 'string' || !project[key]) problems.push(key);
  if (typeof project.invented !== 'boolean') problems.push('invented');
  if (!['CLAUDE.md', 'AGENTS.md'].includes(project.guideTarget)) problems.push('guideTarget');
  if (!['bench', 'existing'].includes(project.store)) problems.push('store');
  if (!Array.isArray(project.memories)) problems.push('memories');
  if (!isCommand(project.suite)) problems.push('suite');
  if (project.lint !== null && !isCommand(project.lint)) problems.push('lint');
  for (const key of ['programs', 'strip', 'links', 'tasks']) if (!Array.isArray(project[key])) problems.push(key);
  return problems;
}

export function taskProblems(task, project) {
  const problems = [];
  const topics = new Set((project.memories ?? []).map(m => m.topic));
  if (!ID.test(task.id ?? '') || !task.id.startsWith(`${project.id}-`)) problems.push('id');
  if (task.project !== project.id) problems.push('project');
  if (!(task.situation in SITUATIONS)) problems.push('situation');
  if (!ORIGINS.includes(task.origin) || (task.origin === 'invented') !== project.invented) problems.push('origin');
  if (!['memory', 'control'].includes(task.kind)) problems.push('kind');
  const memories = Array.isArray(task.memories) ? task.memories : null;
  if (!memories || memories.some(topic => !topics.has(topic))) problems.push('memories');
  else if (task.kind === 'memory' && !memories.length) problems.push('memories');
  else if (task.kind === 'control' && memories.length && task.situation !== 'S10') problems.push('memories');
  if ((task.withheld ?? []).some(topic => !topics.has(topic))) problems.push('withheld');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) problems.push('prompt');
  if (typeof task.check !== 'function') problems.push('check');
  if (!Array.isArray(task.requirements)) problems.push('requirements');
  else if (task.kind === 'memory' && !task.requirements.some(r => r.auto)) problems.push('auto_requirement');
  // An existing store is read at the project base; a task elsewhere would run dd2 on another store than the guide's.
  if (project.store === 'existing' && task.base) problems.push('base');
  if (task.origin === 'mined' && !/^[0-9a-f]{7,40}$/.test(task.source ?? '')) problems.push('source');
  return [...new Set(problems)];
}

export function validateProjects(projects) {
  const problems = [];
  const seen = new Set();
  for (const project of projects) {
    const own = projectProblems(project);
    if (own.length) problems.push(`${project.id}: ${own.join(', ')}`);
    for (const task of project.tasks ?? []) {
      const found = taskProblems(task, project);
      if (found.length) problems.push(`${task.id}: ${found.join(', ')}`);
      if (seen.has(task.id)) problems.push(`duplicate ${task.id}`);
      seen.add(task.id);
    }
  }
  if (problems.length) throw new Error(`bench_invalid: ${problems.join('; ')}`);
}
