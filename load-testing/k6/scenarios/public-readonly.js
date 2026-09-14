import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const VUS = Number(__ENV.VUS || 50);
const RAMP_UP = __ENV.RAMP_UP || '1m';
const HOLD = __ENV.HOLD || '3m';
const RAMP_DOWN = __ENV.RAMP_DOWN || '30s';
const CITY_IDS = (__ENV.CITY_IDS || 'moscow,kazan,saint-petersburg')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const endpointDuration = {
  health: new Trend('endpoint_health_duration', true),
  routes: new Trend('endpoint_routes_duration', true),
  routesMap: new Trend('endpoint_routes_map_duration', true),
  shop: new Trend('endpoint_shop_duration', true),
  raffles: new Trend('endpoint_raffles_duration', true),
  city: new Trend('endpoint_city_duration', true),
};

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    public_readonly: {
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
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    'checks{scope:public}': ['rate>0.99'],
  },
  tags: {
    app: 'entreporgneur-big-journey',
    environment: 'production',
    test_type: 'public_readonly',
  },
};

function expectOk(response, name) {
  const trend = endpointDuration[name];

  if (trend) {
    trend.add(response.timings.duration);
  }

  check(
    response,
    {
      [`${name}: status is 200`]: (res) => res.status === 200,
      [`${name}: has body`]: (res) => Boolean(res.body && res.body.length > 0),
    },
    { scope: 'public', endpoint: name },
  );
}

export default function () {
  group('public catalog and health', () => {
    const cityId = CITY_IDS[(__VU + __ITER) % CITY_IDS.length];

    const responses = http.batch([
      ['GET', `${BASE_URL}/health`, null, { tags: { endpoint: 'health' } }],
      ['GET', `${BASE_URL}/routes`, null, { tags: { endpoint: 'routes' } }],
      ['GET', `${BASE_URL}/routes/map`, null, { tags: { endpoint: 'routes_map' } }],
      ['GET', `${BASE_URL}/shop`, null, { tags: { endpoint: 'shop' } }],
      ['GET', `${BASE_URL}/raffles`, null, { tags: { endpoint: 'raffles' } }],
      ['GET', `${BASE_URL}/cities/${encodeURIComponent(cityId)}`, null, { tags: { endpoint: 'city' } }],
    ]);

    expectOk(responses[0], 'health');
    expectOk(responses[1], 'routes');
    expectOk(responses[2], 'routesMap');
    expectOk(responses[3], 'shop');
    expectOk(responses[4], 'raffles');
    expectOk(responses[5], 'city');
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Публичные endpoint: read-only нагрузка',
  });
}
