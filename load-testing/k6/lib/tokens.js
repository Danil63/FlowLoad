import { SharedArray } from 'k6/data';

function parseTokens(raw) {
  const tokens = raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith('#'))
    .filter((value) => !value.startsWith('example-token-'));

  return [...new Set(tokens)];
}

function readTokensFile(path) {
  if (!path) {
    return [];
  }

  try {
    return parseTokens(open(path));
  } catch (error) {
    throw new Error(`Could not read TOKENS_FILE=${path}: ${error}`);
  }
}

export const TOKENS = new SharedArray('session_tokens', () => {
  const envTokens = parseTokens(`${__ENV.SESSION_TOKENS || ''}\n${__ENV.SESSION_TOKEN || ''}`);
  const fileTokens = readTokensFile(__ENV.TOKENS_FILE || '');
  return [...envTokens, ...fileTokens];
});
