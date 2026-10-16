// Child processes for the agent trial, bounded so that no process tree can stall it.
import { spawn, execFileSync } from 'node:child_process';

// Through a shell the child is cmd.exe: killing it alone leaves npm and the test
// runner alive and holding the pipes (a hung suite stalled the first full trial for hours).
export function killTree(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch { /* already gone */ }
}

// A timeout resolves with what the process wrote so far: a stopped run's stream
// still shows what the agent did. A descendant that outlives the child keeps its
// pipes open and 'close' never comes, so the child's exit settles the run after
// a grace period.
// errLimit caps what is kept of stderr; a suite that reports there (unittest, go vet) raises it.
export function run(command, argv, { input, timeout, grace = 10000, errLimit = 4000, ...options } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, { windowsHide: true, ...options, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false, settled = false, pending;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(pending);
      child.stdout.destroy(); child.stderr.destroy();
      fn(value);
    };
    const timer = setTimeout(() => {
      timedOut = true; killTree(child.pid);
      pending = setTimeout(() => settle(resolveRun, { code: null, out, err, timedOut }), Math.min(grace, 5000));
    }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (err.length < errLimit) err += d; });
    child.on('error', e => settle(reject, e));
    child.on('exit', code => { clearTimeout(pending); pending = setTimeout(() => settle(resolveRun, { code, out, err, timedOut }), grace); });
    child.on('close', code => settle(resolveRun, { code, out, err, timedOut }));
    if (input != null) child.stdin.end(input);
  });
}
