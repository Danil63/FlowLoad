import { browser } from 'k6/browser';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import { createRussianSummary } from '../lib/russian-report.js';
import { TOKENS } from '../lib/tokens.js';

const FRONTEND_URL = __ENV.FRONTEND_URL || 'https://entreprorgneur-big-journey-2ebf.twc1.net';
const API_COOKIE_DOMAIN = __ENV.API_COOKIE_DOMAIN || 'entreporgneur-big-journey-7b03.twc1.net';
const SESSION_COOKIE_NAME = __ENV.SESSION_COOKIE_NAME || '__Secure-better-auth.session_token';

const BROWSER_VUS = Number(__ENV.BROWSER_VUS || 1);
const BROWSER_ITERATIONS = Number(__ENV.BROWSER_ITERATIONS || 1);
const VIEWPORT_WIDTH = Number(__ENV.VIEWPORT_WIDTH || 390);
const VIEWPORT_HEIGHT = Number(__ENV.VIEWPORT_HEIGHT || 844);
const DEVICE_SCALE_FACTOR = Number(__ENV.DEVICE_SCALE_FACTOR || 3);

const CANVAS_SELECTOR = __ENV.CANVAS_SELECTOR || 'canvas';
const START_SELECTOR = __ENV.START_SELECTOR || '';
const ROUTE_SELECTOR = __ENV.ROUTE_SELECTOR || '';
const TAKEOFF_TAPS = Number(__ENV.TAKEOFF_TAPS || 12);
const TAP_INTERVAL_MS = Number(__ENV.TAP_INTERVAL_MS || 250);
const FLIGHT_OBSERVE_SECONDS = Number(__ENV.FLIGHT_OBSERVE_SECONDS || 20);
const SCREENSHOT_DIR = __ENV.SCREENSHOT_DIR || 'load-testing/k6/results/screenshots';

const flightSmokeSuccess = new Rate('browser_simple_flight_success');
const gameOpenDuration = new Trend('browser_game_open_duration', true);
const flightObserveDuration = new Trend('browser_flight_observe_duration', true);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    browser_simple_flight: {
      executor: 'shared-iterations',
      vus: BROWSER_VUS,
      iterations: BROWSER_ITERATIONS,
      maxDuration: __ENV.BROWSER_MAX_DURATION || '3m',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    browser_simple_flight_success: ['rate>0.99'],
    browser_game_open_duration: ['p(95)<30000'],
    browser_flight_observe_duration: ['p(95)<30000'],
  },
  tags: {
    app: 'entreporgneur-big-journey',
    environment: 'production',
    test_type: 'browser_simple_flight',
  },
};

export function setup() {
  if (TOKENS.length === 0) {
    exec.test.abort('Run make start or make token before running browser tests.');
  }
}

function frontendCookieDomain() {
  try {
    return new URL(FRONTEND_URL).hostname;
  } catch (_error) {
    return '';
  }
}

function sessionCookies() {
  const sessionToken = TOKENS[0];
  const domains = [API_COOKIE_DOMAIN, frontendCookieDomain()]
    .map((domain) => domain.trim())
    .filter(Boolean)
    .filter((domain, index, values) => values.indexOf(domain) === index);

  return domains.map((domain) => ({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    domain,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  }));
}

async function optionalClick(page, selector, label) {
  if (!selector) {
    return false;
  }

  try {
    await page.locator(selector).click({ timeout: 10000 });
    console.log(`${label}: clicked ${selector}`);
    return true;
  } catch (error) {
    console.warn(`${label}: selector was not clicked: ${error}`);
    return false;
  }
}

async function tapCenter(page, yRatio = 0.72) {
  await page.mouse.click(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT * yRatio);
}

async function takeOff(page) {
  await tapCenter(page, 0.72);

  for (let index = 0; index < TAKEOFF_TAPS; index += 1) {
    await page.mouse.click(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT * 0.72);
    await page.waitForTimeout(TAP_INTERVAL_MS);
  }
}

export default async function () {
  const context = await browser.newContext({
    viewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    },
    screen: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    userAgent:
      __ENV.USER_AGENT ||
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  await context.addCookies(sessionCookies());

  const page = await context.newPage();
  let jsErrors = 0;

  page.on('pageerror', (error) => {
    jsErrors += 1;
    console.error(`browser page error: ${error}`);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      jsErrors += 1;
      console.error(`browser console error: ${message.text()}`);
    }
  });

  let passed = false;

  try {
    const openStartedAt = Date.now();
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 60000 });
    gameOpenDuration.add(Date.now() - openStartedAt);

    const canvas = await page.waitForSelector(CANVAS_SELECTOR, { timeout: 30000 });
    const canvasBox = await canvas.boundingBox();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/browser-simple-flight-loaded-vu${exec.vu.idInTest}-iter${exec.scenario.iterationInTest}.png`,
    });

    await optionalClick(page, ROUTE_SELECTOR, 'route');
    const clickedStart = await optionalClick(page, START_SELECTOR, 'start');

    if (!clickedStart) {
      await tapCenter(page, 0.78);
    }

    await takeOff(page);

    const observeStartedAt = Date.now();
    await page.waitForTimeout(FLIGHT_OBSERVE_SECONDS * 1000);
    flightObserveDuration.add(Date.now() - observeStartedAt);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/browser-simple-flight-after-flight-vu${exec.vu.idInTest}-iter${exec.scenario.iterationInTest}.png`,
    });

    passed = check(
      {
        canvasBox,
        jsErrors,
      },
      {
        'browser: canvas is visible': (state) => Boolean(state.canvasBox && state.canvasBox.width > 0 && state.canvasBox.height > 0),
        'browser: no JS errors': (state) => state.jsErrors === 0,
      },
    );
  } finally {
    flightSmokeSuccess.add(passed);
    await page.close();
    await context.close();
  }
}

export function handleSummary(data) {
  return createRussianSummary(data, {
    title: 'Браузерный smoke-тест мобильной игры',
  });
}
