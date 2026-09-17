import { sanitizeText } from '../engine/v2/sanitizer.js';

export function observationFromTool(payload) {
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
  if (/(^|__)(dd|deltadictum)(__|_)/i.test(tool)) return null;
  const response = payload.tool_response ?? payload.toolResponse ?? payload.result ?? {};
  const exit = response.exit_code ?? response.exitCode ?? payload.exit_code;
  const failed = payload.is_error === true || response.is_error === true || response.isError === true || (typeof exit === 'number' && exit !== 0);
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = typeof input === 'string' ? input : input.command ?? input.cmd ?? '';
  const validation = typeof exit === 'number' && exit === 0 && /\b(test|pytest|jest|vitest|lint|typecheck|tsc|check)\b/i.test(command);
  if (!failed && !validation) return null;
  const raw = typeof response === 'string' ? response : response.stderr || response.output || response.stdout || response.error || '';
  // Keep a small diagnostic and a verified host exit signal, not the tool input
  // or full logs. Secret-like assignments and common tokens are redacted.
  const preview = sanitizeText(String(raw)).replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,})\b/g, '[redacted]')
    .replace(/\b(password|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]').slice(0, 600);
  return { source_type: failed ? 'tool_failure' : 'validation', source_ref: tool,
    raw_preview: `${failed ? 'Failed' : 'Validation passed'} (exit ${exit ?? 'unknown'}). ${preview}`,
    metadata: { provenance: 'host', tool, exit_code: exit ?? null, signal: failed ? 'failure' : 'validation',
      session_id: String(payload.session_id ?? payload.sessionId ?? '').slice(0, 150) } };
}
