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

// Credentials in the shapes their issuers give them. Knowledge is committed to
// git and shared, and observations are kept locally: neither may carry one.
const SECRET_PATTERNS = [
  /\bsk-[\w-]{12,}/g,                                     // OpenAI, Anthropic
  /\b[sr]k_(?:live|test)_\w{16,}/g,                       // Stripe
  /\b(?:gh[pousr]_\w{20,}|github_pat_\w{20,})/g,          // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g,                                // AWS access key id
  /\bAIza[\w-]{35}\b/g,                                   // Google API key
  /\bxox[abprs]-[\w-]{10,}/g,                             // Slack
  /\bnpm_[A-Za-z0-9]{36}\b/g,                             // npm
  /\bglpat-[\w-]{20,}/g,                                  // GitLab
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g,          // JSON Web Token
  /\bBearer\s+[\w.~+/-]{20,}=*/gi,                        // Authorization header
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const ASSIGNED_SECRET = /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)(\s*[=:]\s*)["']?[^\s"']+["']?/gi;

export function redactSecrets(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
  return text.replace(ASSIGNED_SECRET, '$1$2[redacted]');
}

export function containsSecret(value) {
  const text = String(value ?? '');
  return SECRET_PATTERNS.some(pattern => { pattern.lastIndex = 0; return pattern.test(text); });
}
