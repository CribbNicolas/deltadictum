// Helpers for the checks of invented projects: a hidden test copied into the clone for the run of the
// check only, and the lines the change added. The hidden file is removed in finally: the project's suite
// and lint run after the check on the same tree.
import { execFile } from 'node:child_process';
import { copyFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const exec = (command, args, options = {}) => new Promise(resolve => execFile(command, args, { windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024, ...options },
  (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}` })));
const git = (dir, ...args) => exec('git', ['-C', dir, ...args]).then(r => r.out);

export async function withHidden(from, to, fn) {
  await copyFile(from, to);
  try { return await fn(); } finally { await rm(to, { force: true }); }
}

export async function changedFiles(dir, prefix) {
  const lists = await Promise.all([git(dir, 'diff', '--cached', '--name-only', 'HEAD'), git(dir, 'diff', '--name-only', 'HEAD'), git(dir, 'ls-files', '--others', '--exclude-standard')]);
  return [...new Set(lists.join('\n').split('\n').map(l => l.trim().replaceAll('\\', '/')).filter(l => l && l.startsWith(prefix)))];
}

export async function changed(dir, path) { return (await changedFiles(dir, path)).includes(path); }

export async function addedLines(dir, prefix, extensions) {
  const out = [];
  for (const file of (await changedFiles(dir, prefix)).filter(f => extensions.some(ext => f.endsWith(ext)))) {
    const tracked = (await git(dir, 'ls-files', '--', file)).trim();
    if (!tracked) { out.push(await readFile(join(dir, file), 'utf8').catch(() => '')); continue; }
    const diff = await git(dir, 'diff', 'HEAD', '--', file);
    out.push(diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n'));
  }
  return out.join('\n');
}

export const detail = parts => Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', ');

// A review report flags a problem when one of its items (a numbered or bulleted line with what
// follows it, or a paragraph) matches every pattern: words scattered over the report do not count.
export function flags(answer, ...patterns) {
  const items = String(answer ?? '').split(/\n\s*\n|\n(?=\s*(?:\d+[.)]|[-*•])\s)/);
  return items.some(item => patterns.every(pattern => pattern.test(item)));
}

// The lines a change added under prefix, leaving out files that are themselves the sanctioned helper.
export async function addedLinesExcept(dir, prefix, extensions, excluded) {
  const out = [];
  for (const file of (await changedFiles(dir, prefix)).filter(f => extensions.some(ext => f.endsWith(ext)) && !excluded.includes(f))) {
    out.push(await addedLines(dir, file, extensions));
  }
  return out.join('\n');
}
