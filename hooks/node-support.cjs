'use strict';

// DD's store is node:sqlite with its FTS5 extension, which Node ships from
// 22.16.0 (22.13-22.15 have node:sqlite without FTS5; earlier 22.x have neither).
// CommonJS with no imports, so an older Node can still load it and say why DD
// cannot run instead of failing on the first import. Kept equal to package.json engines.
const MINIMUM = [22, 16, 0];
const MINIMUM_NODE = MINIMUM.join('.');

function supportedNode(version = process.versions.node) {
  const parts = String(version).replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < MINIMUM.length; i += 1) if (parts[i] !== MINIMUM[i]) return parts[i] > MINIMUM[i];
  return true;
}

module.exports = { MINIMUM_NODE, supportedNode };
