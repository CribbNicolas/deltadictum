'use strict';

// The hash of an evidence file: SHA-256 of its text with CRLF line endings read as LF. A checkout with
// core.autocrlf holds CRLF on Windows and LF elsewhere, so hashing the bytes as they are made the same
// file stale on one machine and fresh on another. A file holding a NUL byte is binary: hashed as it is.
const { readFileSync } = require('node:fs');

const CR = 0x0d;

function contentHash(buffer) {
  // Loaded here, not at the top: node:crypto costs a hook 2 ms, and most hooks hash nothing.
  const { createHash } = require('node:crypto');
  const text = buffer.includes(0) || !buffer.includes(CR)
    ? buffer
    : Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha256').update(text).digest('hex');
}

const fileHash = path => contentHash(readFileSync(path));

// Whether a file still has the content a stored hash recorded. A hash written before line endings were
// read as LF is the file's raw hash: it still matches on the machine that wrote it, so no memory turns
// stale through this change alone. Throws when the file cannot be read.
function hashMatches(path, sha256) {
  const buffer = readFileSync(path);
  if (contentHash(buffer) === sha256) return true;
  if (!buffer.includes(CR)) return false;
  return require('node:crypto').createHash('sha256').update(buffer).digest('hex') === sha256;
}

module.exports = { contentHash, fileHash, hashMatches };
