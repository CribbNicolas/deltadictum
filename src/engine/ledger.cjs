'use strict';

const { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync } = require('node:fs');
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

// A hook that died mid-write leaves a last line without its newline: the next
// line must start on its own, or both are torn and neither counts.
function endsWithNewline(path) {
  let fd;
  try { fd = openSync(path, 'r'); } catch { return true; }
  try {
    const size = fstatSync(fd).size;
    if (!size) return true;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally { closeSync(fd); }
}

function stateOf(lines) {
  let epoch = 0;
  for (const line of lines) {
    if ((line.t === 'epoch' || line.t === 'claim') && Number.isInteger(line.n)) epoch = Math.max(epoch, line.n);
  }
  const first = new Map();
  const checks = new Map();
  for (const line of lines) {
    if (line.n !== epoch) continue;
    if (line.t === 'claim' && !first.has(line.m)) first.set(line.m, line.k);
    if (line.t === 'check') { const key = `${line.m}\0${line.f}`; checks.set(key, (checks.get(key) ?? 0) + 1); }
  }
  return { epoch, first, checks };
}

// A violation is reported at most twice per file per epoch (spec section 6).
const REPORT_LIMIT = 2;

function openLedger(path) {
  const read = () => stateOf(retrying(() => readLines(path)));
  const append = text => retrying(() => { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${endsWithNewline(path) ? '' : '\n'}${text}`); });
  return {
    epoch: () => { try { return read().epoch; } catch { return 0; } },
    delivered: () => { try { return new Set(read().first.keys()); } catch { return new Set(); } },
    // A claim also says what fired the memory (`v`, the dimensions, or `check`),
    // at which event kind (`e`) and when (`at`): health reads them from the roll-up.
    claim(ids, { kind = null, viaOf = null, at = new Date().toISOString() } = {}) {
      let before;
      try { before = read(); } catch { return [...ids]; }
      const wanted = [...new Set(ids)].filter(id => !before.first.has(id));
      if (!wanted.length) return [];
      // Unique per claim among concurrent hooks; node:crypto would cost a hook 2 ms to load.
      const token = `${process.pid.toString(36)}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
      const line = id => JSON.stringify({ t: 'claim', m: id, n: before.epoch, k: token, ...(kind ? { e: kind } : {}), ...(viaOf ? { v: viaOf(id) ?? [] } : {}), at });
      try {
        append(wanted.map(id => `${line(id)}\n`).join(''));
        const after = read();
        if (after.epoch !== before.epoch) return wanted;
        return wanted.filter(id => after.first.get(id) === token);
      } catch { return wanted; }
    },
    reported: (memoryId, target) => { try { return read().checks.get(`${memoryId}\0${target}`) ?? 0; } catch { return 0; } },
    report(memoryId, target) {
      try { append(`${JSON.stringify({ t: 'check', m: memoryId, f: String(target), n: read().epoch })}\n`); } catch { /* fail open */ }
    },
    newEpoch(reason) {
      try { append(`${JSON.stringify({ t: 'epoch', n: read().epoch + 1, why: String(reason ?? '') })}\n`); } catch { /* fail open */ }
    },
  };
}

module.exports = { TAIL_BYTES, REPORT_LIMIT, ledgerPath, openLedger };
