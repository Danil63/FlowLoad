import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const PROFILE_FILE = __ENV.CUSTOM_LOAD_PROFILE_FILE || __ENV.LOAD_PROFILE_FILE || '';
const RAMP_UP = __ENV.RAMP_UP || '10s';
const HOLD = __ENV.HOLD || '30s';
const RAMP_DOWN = __ENV.RAMP_DOWN || '10s';
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';
const ENABLE_STATE_CHANGING = String(__ENV.ENABLE_STATE_CHANGING || '').toLowerCase() === 'true';
const DEFAULT_PATH_PARAMS = {
  aircraftId: 'test',
  cityId: 'moscow',
  flightId: 'test',
  itemId: 'test',
  period: 'daily',
  questId: 'test',
  raffleId: 'test',
  routeId: 'test',
  streakDay: '1',
};

const customPathParams = __ENV.PATH_PARAMS ? JSON.parse(__ENV.PATH_PARAMS) : {};
const pathParams = { ...DEFAULT_PATH_PARAMS, ...customPathParams };
const loadProfile = PROFILE_FILE ? JSON.parse(open(PROFILE_FILE)) : { name: 'load-profile', targets: [] };
const targets = Array.isArray(loadProfile.targets) ? loadProfile.targets.filter((target) => Number(target.weight || 0) > 0) : [];
const profileNeedsAuth = targets.some((target) => target.authRequired);
const TOKENS = profileNeedsAuth ? readTokens() : [];
const totalProfileVus = targets.reduce((sum, target) => sum + Number(target.weight || 0), 0);
const targetDurations = {};
const scenarios = {};

for (const target of targets) {
  const order = Number(target.order || targets.indexOf(target) + 1);
  targetDurations[order] = new Trend(`endpoint_load_target_${order}_duration`, true);
  scenarios[`load_target_${order}`] = {
    executor: 'ramping-vus',
    exec: 'runLoadTarget',
    stages: [
      { duration: RAMP_UP, target: Number(target.weight || 1) },
      { duration: HOLD, target: Number(target.weight || 1) },
      { duration: RAMP_DOWN, target: 0 },
    ],
    gracefulRampDown: '10s',
    tags: {
      endpoint: `load_target_${order}`,
      method: String(target.method || 'GET').toUpperCase(),
      path: String(target.path || ''),
    },
  };
}

if (!targets.length) {
  scenarios.load_profile_validation = {
    executor: 'shared-iterations',
    exec: 'abortEmptyProfile',
    vus: 1,
    iterations: 1,
    maxDuration: '5s',
  };
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'checks{scope:load_profile}': ['rate>0.99'],
  },
  tags: {
    app: 'flowload',
    environment: 'production',
    test_type: 'load_profile',
  },
};

export function setup() {
  if (!PROFILE_FILE) {
    exec.test.abort('Set CUSTOM_LOAD_PROFILE_FILE before running load profile tests.');
  }

  if (targets.length === 0 || totalProfileVus <= 0) {
    exec.test.abort('Load profile has no weighted targets.');
  }

  if (profileNeedsAuth && TOKENS.length === 0) {
    exec.test.abort('Load profile has auth targets. Set SESSION_TOKEN, SESSION_TOKENS, or TOKENS_FILE.');
  }
}

function parseTokens(raw) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith('#'))
    .filter((value) => !value.startsWith('example-token-'));
}

function readTokens() {
  const envTokens = parseTokens(`${__ENV.SESSION_TOKENS || ''}\n${__ENV.SESSION_TOKEN || ''}`);
  const fileTokens = __ENV.TOKENS_FILE ? parseTokens(open(__ENV.TOKENS_FILE)) : [];
  return [...new Set([...envTokens, ...fileTokens])];
}

function resolvedPath(path) {
  return String(path || '').replace(/\{([^}]+)\}/g, (_match, key) => encodeURIComponent(pathParams[key] || `test-${key}`));
}

function shouldSkipTarget(target) {
  const method = String(target.method || 'GET').toUpperCase();
  return !ENABLE_STATE_CHANGING && !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function paramsForTarget(target) {
  const headers = { Accept: 'application/json' };

  if (target.authRequired) {
    const token = TOKENS[(exec.vu.idInTest - 1) % TOKENS.length];
    headers.Cookie = `${SESSION_COOKIE_NAME}=${token}`;
  }

  if (!['GET', 'HEAD'].includes(target.method)) {
    headers['Content-Type'] = 'application/json';
  }

  return {
    headers,
    tags: {
      endpoint: `load_target_${target.order}`,
      load_profile: loadProfile.name || 'load-profile',
    },
  };
}

function runTarget(target) {
  const method = String(target.method || 'GET').toUpperCase();
  const order = Number(target.order || 0);
  const name = `${order}. ${method} ${target.path}`;

  if (shouldSkipTarget({ ...target, method })) {
    check(
      { skipped: true },
      { [`${name}: skipped because state-changing is disabled`]: (value) => value.skipped === true },
      { scope: 'load_profile', endpoint: `load_target_${order}` },
    );
    return;
  }

  const body = target.body ? JSON.stringify(target.body) : null;
  const response = http.request(method, `${BASE_URL}${resolvedPath(target.path)}`, body, paramsForTarget({ ...target, method, order }));
  const trend = targetDurations[order];

  if (trend) {
    trend.add(response.timings.duration);
  }

  check(
    response,
    {
      [`${name}: expected status`]: (res) => res.status === Number(target.expectStatus || 200),
      [`${name}: has response body`]: (res) => res.status === 204 || Boolean(res.body),
    },
    { scope: 'load_profile', endpoint: `load_target_${order}` },
  );
}

function targetFromScenario() {
  const order = Number(String(exec.scenario.name || '').replace('load_target_', ''));
  return targets.find((target) => Number(target.order || 0) === order);
}

export function abortEmptyProfile() {
  exec.test.abort('Load profile has no weighted targets.');
}

export function runLoadTarget() {
  const target = targetFromScenario();
  if (!target) {
    exec.test.abort(`No load target for scenario ${exec.scenario.name}`);
  }

  group(loadProfile.name || 'load profile', () => {
    runTarget(target);
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

export default function () {
  runLoadTarget();
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: `Профиль нагрузки: ${loadProfile.name || 'load-profile'}`,
  });
}
