// The bench's tasks across projects, validated, for the runner, the judge and the audit.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guideSection } from '../agent/guide.js';
import { validateProjects } from './validate.js';

const LIVE = ['active', 'contested'];

export async function loadBench(registry = null) {
  const { PROJECTS: projects } = registry ?? await import('./projects/index.js');
  validateProjects(projects);
  const tasks = projects.flatMap(project => project.tasks.map(task => ({ ...task, language: project.language })));
  return { projects, tasks };
}

// A registry module given by path (--registry=...), for the harness's own test.
export const registryAt = async path => (path ? import(pathToFileURL(resolve(path)).href) : null);

export function guidanceFor(task, projects) {
  const project = projects.find(p => p.id === task.project);
  const sections = (task.memories ?? []).map(topic => project?.memories.find(m => m.topic === topic))
    .filter(m => m && LIVE.includes(m.status ?? 'active'))
    .map(m => guideSection({ ...m, status: m.status ?? 'active', evidence: (m.evidence ?? []).map(e => ({ type: 'file', ...e })) }));
  return sections.length ? sections.join('\n') : null;
}

export const { projects: PROJECTS, tasks: TASKS } = await loadBench();
