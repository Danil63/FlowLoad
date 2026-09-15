# k6 load testing for Entreporgneur Big Journey

Base URL:

```bash
https://entreporgneur-big-journey-7b03.twc1.net
```

The current environment is production. Start with read-only tests, then move to authenticated read scenarios, and only then enable state-changing game flows.

## What we learned from Swagger

- Auth uses cookie `__Secure-better-auth.session_token` in the real browser session. Swagger lists `better-auth.session_token`, so the scripts keep the cookie name configurable.
- Public endpoints exist for health, routes, map, shop, raffles, and city details.
- The critical player flow is profile load plus flight start/complete.
- Carousel, shop purchases, raffle entries, wheel spin, quest claims, aircraft purchases, and profile grant/reset all change player state.
- Admin endpoints are intentionally out of the user load-test scope.

See [api-study.md](./api-study.md) for the endpoint map and risk notes.

For running one test across several laptops, see [distributed.md](./distributed.md).

## First command on a new Mac

After cloning the repository, run this once from the repository root:

```bash
make start
```

This installs Homebrew if needed, installs k6, creates local `.env` and `tokens.txt` files, and can securely ask for a session token without printing it in the terminal.

If you also want browser tests on a clean Mac, install Google Chrome during bootstrap:

```bash
INSTALL_BROWSER=true make start
```

Then the second command can already be a test:

```bash
make auth-1
```

If you consciously accept storing tokens in Makefile, paste them near the top of `Makefile`:

```make
MAKEFILE_SESSION_TOKEN := paste_one_token_here
MAKEFILE_SESSION_TOKENS := token1,token2,token3
```

Use `MAKEFILE_SESSION_TOKEN` for one account or `MAKEFILE_SESSION_TOKENS` for many accounts separated by commas.

Check installation:

```bash
make check
```

## Short commands with Makefile

Run commands from the project root:

```bash
cd /Users/mbookpro403gmail.com/.codex/.chatgpt-projects/g-p-6a68d442595c819183ab6682803258a8
```

Show available commands:

```bash
make help
```

First-time local setup:

```bash
make start
```

Distributed run across several laptops:

```bash
make dist
```

Public read-only:

```bash
make public 50
make public-10
make public-50
make public-100
make public-300
```

Public read-only with Russian HTML report:

```bash
make public-report
```

Authenticated game-open:

```bash
make auth-1
make auth-5
make auth-50
make auth-100
```

Authenticated game-open with live web dashboard:

```bash
make auth-dashboard
```

Authenticated game-open with Russian HTML report:

```bash
make auth-report
```

Russian HTML reports open automatically after the test finishes. To keep the browser closed:

```bash
OPEN_REPORT=false make auth-1
```

Mobile browser simple flight:

```bash
make browser
```

Mobile browser simple flight with live web dashboard:

```bash
make browser-dashboard
```

Useful overrides:

```bash
make public 10
make public 50 HOLD=1m
make auth 5
AUTH_VUS=5 make auth-dashboard
FRONTEND_URL='https://frontend-url-here' make browser
```

Grafana observability:

```bash
make grafana-check
make public-grafana 10
make auth-grafana 1
```

These commands send k6 metrics to Prometheus remote write and run logs to Loki
through the protected Grafana gateway. Configure `GRAFANA_GATEWAY_URL` and
`GRAFANA_PUSH_TOKEN` in `load-testing/k6/.env` after deploying `render.yaml`.

For short commands, put secrets in `load-testing/k6/tokens.txt` or local settings in `load-testing/k6/.env`. Both are ignored by git. Do not commit real session tokens, even to a private repository.

The first browser flight scenario is intentionally simple. It does not try to avoid obstacles. It opens the mobile game, injects the session cookie, waits for a canvas, optionally clicks configured route/start selectors, taps the screen for takeoff, waits during the flight, and saves screenshots.

If the default tap does not start the route, inspect the mobile page and pass selectors:

```bash
SESSION_TOKEN='paste_cookie_value_here' \
ROUTE_SELECTOR='button[data-testid="route-kazan-moscow"]' \
START_SELECTOR='button[data-testid="start-flight"]' \
make k6-browser-flight-smoke
```

## 1. Public read-only test

This is the safest first production run.

```bash
k6 run scenarios/public-readonly.js
```

Default load is 50 virtual users with a short ramp. You can lower it:

```bash
VUS=10 k6 run scenarios/public-readonly.js
```

Or run the intended first 50-user test:

```bash
VUS=50 k6 run scenarios/public-readonly.js
```

## 2. Authenticated game-open test

This test loads the authenticated game screens but does not intentionally mutate player state.

Do not put your session token into source files. Pass it as an environment variable:

```bash
SESSION_TOKEN='paste_cookie_value_here' AUTH_VUS=5 k6 run scenarios/auth-game-open.js
```

With a live web dashboard:

```bash
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_OPEN=true \
SESSION_TOKEN='paste_cookie_value_here' \
AUTH_VUS=1 \
k6 run scenarios/auth-game-open.js
```

With an English k6 dashboard HTML exported after the run:

```bash
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_EXPORT=auth-game-open-report.html \
SESSION_TOKEN='paste_cookie_value_here' \
AUTH_VUS=1 \
k6 run scenarios/auth-game-open.js
```

With the custom Russian HTML report:

```bash
SESSION_TOKEN='paste_cookie_value_here' make k6-auth-report
```

The live dashboard opens at:

```text
http://127.0.0.1:5665
```

For multiple test users, pass a comma-separated token pool:

```bash
SESSION_TOKENS='token1,token2,token3' AUTH_VUS=10 k6 run scenarios/auth-game-open.js
```

If a different cookie name is needed, override it:

```bash
SESSION_COOKIE_NAME='better-auth.session_token' SESSION_TOKEN='paste_cookie_value_here' AUTH_VUS=1 k6 run scenarios/auth-game-open.js
```

With only one real account, keep this low. A single account at high concurrency can produce misleading failures because every virtual user is fighting over the same player state.

## 3. Critical flight flow

This starts and completes flights. It changes production player progress, rewards, daily limits, quests, collections, and economy balances.

Run only after you have test accounts or you explicitly accept mutations on the chosen account.

```bash
ENABLE_STATE_CHANGING=true \
SESSION_TOKEN='paste_cookie_value_here' \
FLIGHT_VUS=1 \
FLIGHT_ITERATIONS=1 \
k6 run scenarios/flight-critical.js
```

Useful knobs:

```bash
ROUTE_ID=kazan-moscow
AIRCRAFT_ID=meridian
FLIGHT_THINK_TIME_SECONDS=3
FLIGHT_HAPPINESS=90
FLIGHT_COLLECTED_COINS=0
```

For production, grow this slowly:

1. `FLIGHT_VUS=1 FLIGHT_ITERATIONS=1`
2. `FLIGHT_VUS=2 FLIGHT_ITERATIONS=4`
3. test account pool, then `FLIGHT_VUS=5-10`
4. only after metrics/log access, consider higher concurrency

## Recommended first session

1. Run `public-readonly.js` with `VUS=10`.
2. If stable, run `public-readonly.js` with `VUS=50`.
3. Capture a session cookie and run `auth-game-open.js` with `AUTH_VUS=1`.
4. If stable, run `auth-game-open.js` with `AUTH_VUS=5`.
5. Do one guarded flight with `flight-critical.js`.

Without server metrics, we should treat the first results as client-side symptoms only: latency, error rate, and visible failures. They will not tell us whether the bottleneck is app CPU, database, cache, network, or an external service.
