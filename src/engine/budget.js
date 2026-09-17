// Provider-independent estimate, not a claim of exact tokenizer accounting.
// Non-ASCII text receives a higher byte weight; callers can supply lower budgets.
export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 3));
}

export function boundedBudget(value, fallback = 600) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 8000) throw new Error('budget_tokens must be between 1 and 8000');
  return Math.floor(n);
}

export function fitLines(lines, budget) {
  const selected = [];
  for (const line of lines) if (estimateTokens([...selected, line].join('\n')) <= budget) selected.push(line);
  return selected.join('\n');
}
