import { contentTokens } from './trigger-match.js';

const RETRIEVE_COLUMNS = 'trigger title topic_key micro short';

export function ftsQuery(text, columns = RETRIEVE_COLUMNS) {
  const tokens = contentTokens(text);
  if (!tokens.length) return '';
  return tokens
    .map(token => {
      const safe = token.replaceAll('"', '');
      if (safe.length < 2) return '';
      return columns ? `{${columns}}: "${safe}"` : `"${safe}"`;
    })
    .filter(Boolean)
    .join(' OR ');
}
