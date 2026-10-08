'use strict';

const { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync } = require('node:fs');
const { dirname, join } = require('node:path');

// A session's delivery ledger (spec section 4): which memories were delivered in
// the current epoch, so none is repeated, and a new epoch at each compaction.
// Append-only JSON lines. Claim-first: a hook appends its claims in one write,
// re-reads, and delivers only the memories whose first claim in file order is
// its own, so parallel hooks need no lock. Any failure fails open: deliver,
// never throw, never block the host.
const TAIL_BYTES = 256 * 1024;

const safe = value => String(value).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 150);

function ledgerPath(sessionsDir, sessionId, agentId) {
  if (!sessionId) return null;
  return join(sessionsDir, `${safe(sessionId)}${agentId ? `.${safe(agentId)}` : ''}.jsonl`);
}

function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// One retry after 5 ms (antivirus and sharing violations on Windows), then the error.
function retrying(work) {
  try { return work(); } catch { pause(5); return work(); }
}

// The file's lines, from its last TAIL_BYTES when it is larger.
function readLines(path) {
  let fd;
  try { fd = openSync(path, 'r'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } finally { closeSync(fd); }
}

function stateOf(lines) {
  let epoch = 0;
  for (const line of lines) {
    if ((line.t === 'epoch' || line.t === 'claim') && Number.isInteger(line.n)) epoch = Math.max(epoch, line.n);
  }
  const first = new Map();
  for (const line of lines) if (line.t === 'claim' && line.n === epoch && !first.has(line.m)) first.set(line.m, line.k);
  return { epoch, first };
}

function openLedger(path) {
  const read = () => stateOf(retrying(() => readLines(path)));
  const append = text => retrying(() => { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, text); });
  return {
    epoch: () => { try { return read().epoch; } catch { return 0; } },
    delivered: () => { try { return new Set(read().first.keys()); } catch { return new Set(); } },
    claim(ids) {
      let before;
      try { before = read(); } catch { return [...ids]; }
      const wanted = [...new Set(ids)].filter(id => !before.first.has(id));
      if (!wanted.length) return [];
      // Unique per claim among concurrent hooks; node:crypto would cost a hook 2 ms to load.
      const token = `${process.pid.toString(36)}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
      try {
        append(wanted.map(id => `${JSON.stringify({ t: 'claim', m: id, n: before.epoch, k: token })}\n`).join(''));
        const after = read();
        if (after.epoch !== before.epoch) return wanted;
        return wanted.filter(id => after.first.get(id) === token);
      } catch { return wanted; }
    },
    newEpoch(reason) {
      try { append(`${JSON.stringify({ t: 'epoch', n: read().epoch + 1, why: String(reason ?? '') })}\n`); } catch { /* fail open */ }
    },
  };
}

function pruneSessions(dir, { maxAgeMs = 7 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  let names;
  try { names = readdirSync(dir); } catch { return 0; }
  let pruned = 0;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > maxAgeMs) { rmSync(join(dir, name), { force: true }); pruned += 1; }
    } catch { /* gone or locked: the next session prunes it */ }
  }
  return pruned;
}

module.exports = { TAIL_BYTES, ledgerPath, openLedger, pruneSessions };
