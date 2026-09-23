import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionBanner, uiPointer } from '../../src/hooks/banner.js';

describe('session banner', () => {
  test('always includes load line and audit URL', () => {
    const text = sessionBanner({
      projectId: 'demo',
      url: 'http://127.0.0.1:7733',
      activeCount: 0,
    });
    assert.match(text, /DD - loaded for `demo` \(0 active\)/);
    assert.match(text, /DD - Audit UI: http:\/\/127\.0\.0\.1:7733/);
    assert.doesNotMatch(text, /DeltaDictum/);
  });

  test('names no URL while no resident is known to serve one', () => {
    // A resident that was just started has not recorded its address yet; the
    // registry still names the one it replaced.
    const text = sessionBanner({ projectId: 'demo', url: null, activeCount: 0 });
    assert.match(text, /DD - loaded for `demo`/);
    assert.doesNotMatch(text, /http:\/\//);
    assert.doesNotMatch(text, /tell the user this URL/);
    assert.match(text, /`ui` tool/);
  });

  test('the pointer shown to the person is a bare clickable URL', () => {
    // It lands in the terminal, where a URL alone is what gets linkified.
    assert.equal(uiPointer('http://127.0.0.1:7734'), 'DD audit UI: http://127.0.0.1:7734');
  });
});
