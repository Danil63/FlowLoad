import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';
import { TOKENS } from '../lib/tokens.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';
const AUTH_STATUS_TIMEOUT = __ENV.AUTH_STATUS_TIMEOUT || '10s';

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
      iterations: 1,
      maxDuration: __ENV.AUTH_STATUS_MAX_DURATION || '45s',
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
      timeout: AUTH_STATUS_TIMEOUT,
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

    const body = summarizeBody(response);
    const suffix = body ? ` | ${body}` : '';
    console.log(`${name}: HTTP ${response.status} | ${Math.round(response.timings.duration)} ms${suffix}`);
  }

  console.log('');
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Проверка авторизации',
  });
}
