import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_UI_URL, probeUi, readUiUrl, recordedUiUrl, sessionBanner, uiPointer, writeUiUrl } from '../../src/hooks/banner.js';

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

  test('persists and reads the live audit URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-url-'));
    const ddDir = join(root, '.dd');
    await writeUiUrl(ddDir, { url: 'http://127.0.0.1:7734', port: 7734 });
    assert.equal(await readUiUrl(ddDir), 'http://127.0.0.1:7734');
  });

  test('the pointer shown to the person is a bare clickable URL', () => {
    // It lands in the terminal, where a URL alone is what gets linkified.
    assert.equal(uiPointer('http://127.0.0.1:7734'), 'DD audit UI: http://127.0.0.1:7734');
  });

  test('a recorded URL is distinguished from the default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-url-'));
    const ddDir = join(root, '.dd');
    // Nothing has been recorded: the model-facing banner still names a place to
    // look, but there is no URL to put in front of the person.
    assert.equal(await recordedUiUrl(ddDir), null);
    assert.equal(await readUiUrl(ddDir), DEFAULT_UI_URL);

    await writeUiUrl(ddDir, { url: 'http://127.0.0.1:7734', port: 7734 });
    assert.equal(await recordedUiUrl(ddDir), 'http://127.0.0.1:7734');
  });

  test('probing a port nothing listens on reports not live, and does not throw', async () => {
    assert.equal(await probeUi('http://127.0.0.1:7999', 200), false);
  });
});
