// The regular expressions a memory's check may use (spec section 6): bounded in
// length, no quantified group that is itself quantified (catastrophic
// backtracking), and they must compile. A check never runs anything else.
export const PATTERN_MAX = 500;

export function unsafePattern(source) {
  const text = String(source ?? '');
  return text.length > PATTERN_MAX || /\((?:[^()\\]|\\.)*[*+}]\)\s*[*+{]/.test(text);
}

export function compilePattern(source) {
  if (typeof source !== 'string' || !source || unsafePattern(source)) return null;
  try { return new RegExp(source); } catch { return null; }
}
