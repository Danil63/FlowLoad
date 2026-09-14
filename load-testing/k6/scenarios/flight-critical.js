import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createRussianSummary } from '../lib/russian-report.js';
import { TOKENS } from '../lib/tokens.js';

const BASE_URL = (__ENV.BASE_URL || 'https://entreporgneur-big-journey-7b03.twc1.net').replace(/\/+$/, '');
const FLIGHT_VUS = Number(__ENV.FLIGHT_VUS || 1);
const FLIGHT_ITERATIONS = Number(__ENV.FLIGHT_ITERATIONS || 1);
const ROUTE_ID = __ENV.ROUTE_ID || 'kazan-moscow';
const AIRCRAFT_ID = __ENV.AIRCRAFT_ID || '';
const FLIGHT_THINK_TIME_SECONDS = Number(__ENV.FLIGHT_THINK_TIME_SECONDS || 3);
const FLIGHT_HAPPINESS = Number(__ENV.FLIGHT_HAPPINESS || 90);
const FLIGHT_COLLECTED_COINS = Number(__ENV.FLIGHT_COLLECTED_COINS || 0);
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';

const endpointDuration = {
  profileBeforeFlight: new Trend('endpoint_profile_before_flight_duration', true),
  flightsStart: new Trend('endpoint_flights_start_duration', true),
  flightsComplete: new Trend('endpoint_flights_complete_duration', true),
  profileAfterFlight: new Trend('endpoint_profile_after_flight_duration', true),
};

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    flight_critical: {
      executor: 'shared-iterations',
      vus: FLIGHT_VUS,
      iterations: FLIGHT_ITERATIONS,
      maxDuration: __ENV.MAX_DURATION || '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    'checks{scope:flight}': ['rate>0.98'],
  },
  tags: {
    app: 'entreporgneur-big-journey',
    environment: 'production',
    test_type: 'flight_critical',
    state_changing: 'true',
  },
};

export function setup() {
  if (__ENV.ENABLE_STATE_CHANGING !== 'true') {
    exec.test.abort('This scenario changes production player state. Set ENABLE_STATE_CHANGING=true to run it.');
  }

  if (TOKENS.length === 0) {
    exec.test.abort('Set SESSION_TOKEN or SESSION_TOKENS before running flight tests.');
  }
}

function paramsForVu(extra = {}) {
  const token = TOKENS[(exec.vu.idInTest - 1) % TOKENS.length];

  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...extra.headers,
    },
    ...extra,
  };
}

function expectStatus(response, name, status) {
  const trend = endpointDuration[name];

  if (trend) {
    trend.add(response.timings.duration);
  }

  check(
    response,
    {
      [`${name}: status is ${status}`]: (res) => res.status === status,
      [`${name}: has json body`]: (res) => {
        try {
          return typeof res.json() === 'object';
        } catch (_error) {
          return false;
        }
      },
    },
    { scope: 'flight', endpoint: name },
  );
}

function startFlight() {
  const payload = { routeId: ROUTE_ID };

  if (AIRCRAFT_ID) {
    payload.aircraftId = AIRCRAFT_ID;
  }

  const response = http.post(`${BASE_URL}/flights/start`, JSON.stringify(payload), {
    ...paramsForVu(),
    tags: { endpoint: 'flights_start' },
  });

  expectStatus(response, 'flightsStart', 201);

  if (response.status !== 201) {
    return null;
  }

  const flightId = response.json('flightId');

  check(
    flightId,
    {
      'flights_start: returns flightId': (value) => typeof value === 'string' && value.length > 0,
    },
    { scope: 'flight', endpoint: 'flights_start' },
  );

  return flightId;
}

function completeFlight(flightId) {
  const payload = {
    happiness: FLIGHT_HAPPINESS,
    collectedCoins: FLIGHT_COLLECTED_COINS,
  };

  const response = http.post(`${BASE_URL}/flights/${encodeURIComponent(flightId)}/complete`, JSON.stringify(payload), {
    ...paramsForVu(),
    tags: { endpoint: 'flights_complete' },
  });

  expectStatus(response, 'flightsComplete', 201);
}

export default function () {
  group('critical flight flow', () => {
    const profile = http.get(`${BASE_URL}/profile`, {
      ...paramsForVu(),
      tags: { endpoint: 'profile_before_flight' },
    });
    expectStatus(profile, 'profileBeforeFlight', 200);

    const flightId = startFlight();

    if (!flightId) {
      return;
    }

    sleep(FLIGHT_THINK_TIME_SECONDS);
    completeFlight(flightId);

    const profileAfter = http.get(`${BASE_URL}/profile`, {
      ...paramsForVu(),
      tags: { endpoint: 'profile_after_flight' },
    });
    expectStatus(profileAfter, 'profileAfterFlight', 200);
  });

  sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Критичный сценарий полета',
  });
}
