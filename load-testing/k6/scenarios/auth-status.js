import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';
import { TOKENS } from '../lib/tokens.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';
const AUTH_STATUS_TIMEOUT = __ENV.AUTH_STATUS_TIMEOUT || '10s';
const totals = { total: TOKENS.length, completed: 0, accepted: 0, rejected: 0, forbidden: 0, errors: 0 };

const endpoints = [
  ['profile', '/profile'],
  ['aircraft', '/aircraft'],
  ['quests', '/quests'],
  ['collections_me', '/collections/me'],
  ['raffles_me', '/raffles/me'],
  ['wheel_rewards', '/wheel/rewards'],
  ['carousel', '/carousel'],
];

const endpointDuration = Object.fromEntries(
  endpoints.map(([name]) => [name, new Trend(`endpoint_${name}_duration`, true)]),
);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    auth_status: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: Math.max(1, TOKENS.length),
      maxDuration: __ENV.AUTH_STATUS_MAX_DURATION || `${Math.max(80, TOKENS.length * 80)}s`,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'checks{scope:auth_status}': ['rate>0.99'],
  },
};

export function setup() {
  if (TOKENS.length === 0) {
    exec.test.abort('No tokens found. Add one token to Makefile or load-testing/k6/tokens.txt.');
  }
}

export default function () {
  const token = TOKENS[exec.scenario.iterationInTest];
  const statuses = [];
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
      timeout: AUTH_STATUS_TIMEOUT,
      redirects: 0,
      jar: new http.CookieJar(),
    });

    endpointDuration[name].add(response.timings.duration);

    check(
      response,
      {
        [`${name}: status is 200`]: (res) => res.status === 200,
        [`${name}: has body`]: (res) => Boolean(res.body && res.body.length > 0),
      },
      { scope: 'auth_status', endpoint: name },
    );

    statuses.push(response.status);
    console.log(`Token #${exec.scenario.iterationInTest + 1} ${name}: HTTP ${response.status}`);
  }

  totals.completed += 1;
  if (statuses.includes(401)) totals.rejected += 1;
  else if (statuses.includes(403)) totals.forbidden += 1;
  else if (statuses.every(status => status === 200)) totals.accepted += 1;
  else totals.errors += 1;
  const outcome = statuses.includes(401) ? 'rejected' : statuses.includes(403) ? 'forbidden' : statuses.every(status => status === 200) ? 'accepted' : 'errors';
  const masked = token.length > 12 ? `${token.slice(0, 4)}...${token.slice(-4)}` : '********';
  console.log(`TOKEN_CHECK_ITEM ${encodeURIComponent(JSON.stringify({ index: exec.scenario.iterationInTest + 1, masked, outcome }))}`);
  console.log(`TOKEN_CHECK_SUMMARY ${encodeURIComponent(JSON.stringify(totals))}`);
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Проверка авторизации',
  });
}
