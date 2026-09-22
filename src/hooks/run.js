#!/usr/bin/env node
import { retrieveMemories } from '../engine/retrieve.js';
import { openStore, readJsonStdin, findRepoRoot } from '../project.js';
import { join } from 'node:path';
import { probeUi, readUiUrl, recordedUiUrl, uiPointer } from './banner.js';
import { buildSessionStartContext, contextPayload } from './session-start.js';
import { STOP_CAPTURE_PROMPT } from './capture.js';
import { buildPreToolContext } from './pre-tool.js';
import { observationFromTool, recordPromptObservation } from './observe.js';
import { microPack } from './session-start.js';
import { callRunningStore } from './bridge.js';
import { ensureResident } from '../resident.js';

function ok(payload) {
  if (payload.decision === 'allow') delete payload.decision;
  if (codexHost && command === 'stop' && payload.hookSpecificOutput?.additionalContext) {
    payload = { decision: 'block', reason: payload.hookSpecificOutput.additionalContext };
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function skip() {
  process.exit(0);
}

const command = process.argv[2];
const codexHost = process.argv.includes('--codex');
const dataArg = process.argv.indexOf('--data');
if (dataArg >= 0 && process.argv[dataArg + 1]) process.env.DD_DATA = process.argv[dataArg + 1];

try {
  const payload = await readJsonStdin();
  const observation = command === 'observe' ? observationFromTool(payload) : null;
  if (command === 'observe' && !observation) skip();
  if (command === 'pre-tool' && /(^|__)(dd|deltadictum)(__|_)/i.test(payload.tool_name || payload.toolName || '')) skip();
  const cwd = payload.cwd || process.env.DD_PROJECT_DIR || process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const bridged = await callRunningStore(command, payload, repoRoot);
  if (bridged) {
    // A bridged reply is proof an audit UI answered, so the pointer needs no
    // probe. It is attached here rather than left to the UI: the response comes
    // from whatever version of DD that process was started with, which may
    // predate the pointer entirely.
    if (command === 'session-start' && !bridged.systemMessage) {
      const url = await recordedUiUrl(join(repoRoot, '.dd'));
      if (url) bridged.systemMessage = uiPointer(url);
    }
    ok(bridged);
  }
  const { store, projectId, ddDir } = await openStore({ cwd });

  if (command === 'session-start') {
    // No resident answered this session: start one for the sessions to come.
    const resident = await ensureResident(repoRoot).catch(() => ({ state: 'unavailable' }));
    const recorded = await recordedUiUrl(ddDir);
    const result = await buildSessionStartContext({
      resident,
      store,
      projectId,
      uiUrl: recorded ?? await readUiUrl(ddDir),
      uiLive: recorded ? await probeUi(recorded) : false,
      sessionId: payload.session_id ?? payload.sessionId,
      source: payload.source,
    });
    store.close();
    ok(result);
  }

  if (command === 'pre-tool') {
    const result = await buildPreToolContext(payload, { store, projectId });
    store.close();
    ok(result);
  }

  if (command === 'prompt') {
    await store.beginCaptureTurn(projectId, payload.session_id ?? payload.sessionId);
    await recordPromptObservation(payload, { store, projectId });
    const action = payload.prompt || payload.text || payload.user_prompt || '';
    const result = await retrieveMemories({
      project_id: projectId,
      action,
      budget_tokens: payload.budget_tokens,
      session_id: payload.session_id ?? payload.sessionId,
    }, { store });
    store.close();
    ok(contextPayload('UserPromptSubmit', microPack(result.memories ?? [])));
  }

  if (command === 'observe') {
    await store.putObservation({ ...observation, project_id: projectId });
    store.close();
    skip();
  }

  if (command === 'stop') {
    const observations = await store.recentObservations(projectId, payload.session_id ?? payload.sessionId);
    // Ask only after a turn that recorded something worth proposing from: a host
    // validation or failure, or a user correction. On Codex the prompt costs an
    // extra model turn; on every host an unconditional prompt trains the agent to
    // propose noise and fills the review queue. A correction is the most reliable
    // input DD receives, so a corrected turn is the one least worth staying quiet
    // on. Repeats are bounded by the evidence-set claim below. The agent can still
    // propose unprompted through MCP whenever it learns something.
    if (!observations.length) { store.close(); skip(); }
    if (payload.stop_hook_active || !await store.claimCapturePrompt(projectId, payload.session_id ?? payload.sessionId, observations)) {
      store.close(); skip();
    }
    // Host observations and user corrections are both recorded evidence, and are
    // referenced the same way; the wording no longer calls all of it host.
    const references = observations.length ? `\nAvailable recorded evidence for this session, host observations and user corrections (get by ID; source_type=tool_output, source_ref=ID): ${JSON.stringify(observations)}` : '';
    store.close();
    ok(contextPayload(
      'Stop',
      STOP_CAPTURE_PROMPT + references,
    ));
  }

  store.close();
  skip();
} catch {
  process.exit(0);
}
