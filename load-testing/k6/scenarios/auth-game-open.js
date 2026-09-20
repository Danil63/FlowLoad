import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';
import { TOKENS } from '../lib/tokens.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const AUTH_VUS = Number(__ENV.AUTH_VUS || 5);
const RAMP_UP = __ENV.RAMP_UP || '30s';
const HOLD = __ENV.HOLD || '2m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '20s';
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';
const DEBUG_AUTH = String(__ENV.DEBUG_AUTH || '').toLowerCase() === 'true';

const endpointDuration = {
  profile: new Trend('endpoint_profile_duration', true),
  aircraft: new Trend('endpoint_aircraft_duration', true),
  quests: new Trend('endpoint_quests_duration', true),
  collectionsMe: new Trend('endpoint_collections_me_duration', true),
  rafflesMe: new Trend('endpoint_raffles_me_duration', true),
  wheelRewards: new Trend('endpoint_wheel_rewards_duration', true),
  carousel: new Trend('endpoint_carousel_duration', true),
};

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    auth_game_open: {
      executor: 'ramping-vus',
      stages: [
        { duration: RAMP_UP, target: AUTH_VUS },
        { duration: HOLD, target: AUTH_VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    'checks{scope:auth_read}': ['rate>0.99'],
  },
  tags: {
    app: 'flowload',
    environment: 'production',
    test_type: 'auth_game_open',
  },
};

export function setup() {
  if (TOKENS.length === 0) {
    exec.test.abort('Set SESSION_TOKEN or SESSION_TOKENS before running authenticated tests.');
  }
}

function paramsForVu() {
  const token = TOKENS[(exec.vu.idInTest - 1) % TOKENS.length];

  return {
    headers: {
      Accept: 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  };
}

function expectOk(response, name) {
  const trend = endpointDuration[name];

  if (trend) {
    trend.add(response.timings.duration);
  }

  if (DEBUG_AUTH && response.status !== 200 && exec.scenario.iterationInTest < 10) {
    const body = String(response.body || '').slice(0, 180).replace(/\s+/g, ' ');
    console.error(`[auth debug] ${name}: status=${response.status}, body=${body}`);
  }

  check(
    response,
    {
      [`${name}: status is 200`]: (res) => res.status === 200,
      [`${name}: has json body`]: (res) => {
        try {
          return typeof res.json() === 'object';
        } catch (_error) {
          return false;
        }
      },
    },
    { scope: 'auth_read', endpoint: name },
  );
}

export default function () {
  group('authenticated game open', () => {
    const params = paramsForVu();

    const responses = http.batch([
      ['GET', `${BASE_URL}/profile`, null, { ...params, tags: { endpoint: 'profile' } }],
      ['GET', `${BASE_URL}/aircraft`, null, { ...params, tags: { endpoint: 'aircraft' } }],
      ['GET', `${BASE_URL}/quests`, null, { ...params, tags: { endpoint: 'quests' } }],
      ['GET', `${BASE_URL}/collections/me`, null, { ...params, tags: { endpoint: 'collections_me' } }],
      ['GET', `${BASE_URL}/raffles/me`, null, { ...params, tags: { endpoint: 'raffles_me' } }],
      ['GET', `${BASE_URL}/wheel/rewards`, null, { ...params, tags: { endpoint: 'wheel_rewards' } }],
      ['GET', `${BASE_URL}/carousel`, null, { ...params, tags: { endpoint: 'carousel' } }],
    ]);

    expectOk(responses[0], 'profile');
    expectOk(responses[1], 'aircraft');
    expectOk(responses[2], 'quests');
    expectOk(responses[3], 'collectionsMe');
    expectOk(responses[4], 'rafflesMe');
    expectOk(responses[5], 'wheelRewards');
    expectOk(responses[6], 'carousel');
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 2));
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Авторизованное открытие игры',
  });
}
