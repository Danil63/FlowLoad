import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const ROUTE_FILE = __ENV.CUSTOM_ROUTE_FILE || __ENV.ROUTE_FILE || '';
const VUS = Number(__ENV.VUS || 1);
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
const routeConfig = ROUTE_FILE ? JSON.parse(open(ROUTE_FILE)) : { name: 'custom-route', steps: [] };
const routeSteps = Array.isArray(routeConfig.steps) ? routeConfig.steps : [];
const routeNeedsAuth = routeSteps.some((step) => step.authRequired);
const TOKENS = routeNeedsAuth ? readTokens() : [];
const stepDurations = {};

for (const step of routeSteps) {
  const order = Number(step.order || routeSteps.indexOf(step) + 1);
  stepDurations[order] = new Trend(`endpoint_route_step_${order}_duration`, true);
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    custom_route: {
      executor: 'ramping-vus',
      stages: [
        { duration: RAMP_UP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'checks{scope:custom_route}': ['rate>0.99'],
  },
  tags: {
    app: 'entreporgneur-big-journey',
    environment: 'production',
    test_type: 'custom_route',
  },
};

export function setup() {
  if (!ROUTE_FILE) {
    exec.test.abort('Set CUSTOM_ROUTE_FILE before running custom route tests.');
  }

  if (routeSteps.length === 0) {
    exec.test.abort('Custom route has no steps.');
  }

  if (routeSteps.some((step) => step.authRequired) && TOKENS.length === 0) {
    exec.test.abort('Custom route has auth steps. Set SESSION_TOKEN, SESSION_TOKENS, or TOKENS_FILE.');
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

function routeParams(step) {
  const headers = { Accept: 'application/json' };

  if (step.authRequired) {
    const token = TOKENS[(exec.vu.idInTest - 1) % TOKENS.length];
    headers.Cookie = `${SESSION_COOKIE_NAME}=${token}`;
  }

  if (!['GET', 'HEAD'].includes(step.method)) {
    headers['Content-Type'] = 'application/json';
  }

  return {
    headers,
    tags: {
      endpoint: `route_step_${step.order}`,
      route_name: routeConfig.name || 'custom-route',
    },
  };
}

function resolvedPath(path) {
  return String(path || '').replace(/\{([^}]+)\}/g, (_match, key) => encodeURIComponent(pathParams[key] || `test-${key}`));
}

function shouldSkipStep(step) {
  const method = String(step.method || 'GET').toUpperCase();
  return !ENABLE_STATE_CHANGING && !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function runStep(step) {
  const method = String(step.method || 'GET').toUpperCase();
  const order = Number(step.order || 0);
  const name = `${order}. ${method} ${step.path}`;

  if (shouldSkipStep({ ...step, method })) {
    check(
      { skipped: true },
      { [`${name}: skipped because state-changing is disabled`]: (value) => value.skipped === true },
      { scope: 'custom_route', endpoint: `route_step_${order}` },
    );
    return;
  }

  const body = step.body ? JSON.stringify(step.body) : null;
  const response = http.request(method, `${BASE_URL}${resolvedPath(step.path)}`, body, routeParams({ ...step, method, order }));
  const trend = stepDurations[order];

  if (trend) {
    trend.add(response.timings.duration);
  }

  check(
    response,
    {
      [`${name}: expected status`]: (res) => res.status === Number(step.expectStatus || 200),
      [`${name}: has response body`]: (res) => res.status === 204 || Boolean(res.body),
    },
    { scope: 'custom_route', endpoint: `route_step_${order}` },
  );
}

export default function () {
  group(routeConfig.name || 'custom route', () => {
    for (const step of routeSteps) {
      runStep(step);
    }
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: `Пользовательский маршрут: ${routeConfig.name || 'custom-route'}`,
  });
}
