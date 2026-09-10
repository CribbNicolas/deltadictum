const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const OPEN_THINK = /<think>[\s\S]*$/gi;
const CLOSE_THINK = /<\/think>/gi;
const FENCE_LINE = /^```(?:[a-zA-Z0-9_-]+)?\s*$/gm;
const INJECTION_LIKE = /ignore\s+(all\s+)?previous\s+instructions|override\s+system\s+prompt|developer\s+message|system\s+message/i;

export function sanitizeText(value) {
  return String(value ?? '')
    .replace(THINK_BLOCK, '')
    .replace(OPEN_THINK, '')
    .replace(CLOSE_THINK, '')
    .replace(FENCE_LINE, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function hasUnsafeMemoryContent(value) {
  const text = String(value ?? '');
  return /<\/?think/i.test(text) || /```/.test(text) || INJECTION_LIKE.test(text);
}
