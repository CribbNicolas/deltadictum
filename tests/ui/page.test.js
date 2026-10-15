import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { memory, project } from '../helpers/review.js';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

// The child runs in the project folder: it is stopped inside the test, before the
// project's t.after removes that folder (Windows refuses to remove a process's cwd).
async function firstLine(root, args, check) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const line = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(text); });
      exited.then(code => reject(new Error(`exited ${code}`)));
    });
    check(line);
  } finally {
    child.kill();
    await exited;
  }
}

test('the page calls only routes the server has, and carries the nonce placeholder', async () => {
  const page = await readFile(new URL('../../src/ui/public/review.html', import.meta.url), 'utf8');
  assert.match(page, /<script nonce="__NONCE__">/);
  for (const route of ['/api/overview', '/api/memories', '/api/requests', '/api/merge']) assert.ok(page.includes(route), route);
  for (const action of ['accept', 'reject', 'archive', 'restore', 'retopic', 'dry-run', 'reviewed']) assert.ok(page.includes(`/${action}`), action);
  assert.doesNotMatch(page, /\bon(?:click|submit|change|input)=/);
  assert.doesNotMatch(page, /innerHTML/);
});

test('deltadictum ui prints an address for the project and serves until stopped', async t => {
  const root = await project(t, [memory('m1')]);
  await firstLine(root, ['ui', '--port', '0'], line => assert.match(line, /^DD - review UI: http:\/\/127\.0\.0\.1:\d+\/\?key=[0-9a-f]+/));
});

test('a busy port falls back to a free one', async t => {
  const root = await project(t, [memory('m1')]);
  const busy = createServer();
  await new Promise(resolve => busy.listen(0, '127.0.0.1', resolve));
  t.after(() => busy.close());
  const taken = busy.address().port;
  await firstLine(root, ['ui', '--port', String(taken)], line => {
    const port = Number(line.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
    assert.ok(port > 0 && port !== taken, line);
  });
});
