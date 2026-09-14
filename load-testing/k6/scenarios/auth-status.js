import http from 'k6/http';
import exec from 'k6/execution';
import { TOKENS } from '../lib/tokens.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';

const endpoints = [
  ['profile', '/profile'],
  ['aircraft', '/aircraft'],
  ['quests', '/quests'],
  ['collections_me', '/collections/me'],
  ['raffles_me', '/raffles/me'],
  ['wheel_rewards', '/wheel/rewards'],
  ['carousel', '/carousel'],
];

export const options = {
  scenarios: {
    auth_status: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {},
};

export function setup() {
  if (TOKENS.length === 0) {
    exec.test.abort('No tokens found. Add one token to Makefile or load-testing/k6/tokens.txt.');
  }
}

function summarizeBody(response) {
  if (!response.body) {
    return '';
  }

  return String(response.body).slice(0, 180).replace(/\s+/g, ' ');
}

export default function () {
  const token = TOKENS[0];
  const params = {
    headers: {
      Accept: 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  };

  console.log('');
  console.log(`Auth status check: ${BASE_URL}`);
  console.log(`Cookie name: ${SESSION_COOKIE_NAME}`);
  console.log('');

  for (const [name, path] of endpoints) {
    const response = http.get(`${BASE_URL}${path}`, {
      ...params,
      tags: { endpoint: name },
    });

    const body = summarizeBody(response);
    const suffix = body ? ` | ${body}` : '';
    console.log(`${name}: HTTP ${response.status} | ${Math.round(response.timings.duration)} ms${suffix}`);
  }

  console.log('');
}
