# Big Journey Load Testing Memory

This file is the repo-level onboarding and route memory for load testing.
Do not store real tokens, credentials, screenshots, production reports, or private notes here.

## First Start

Use this path on a clean Mac:

```bash
git clone https://github.com/Danil63/big-journey-k6-load-tests.git
cd big-journey-k6-load-tests
make start
make auth-status
make auth-1
```

During `make start`, paste your own session token when the terminal asks for it.
The token is saved locally to `load-testing/k6/tokens.txt`, which is ignored by git.
Do not store the token in repository files.

If token setup was skipped:

```bash
make token
```

If you need many local tokens:

```bash
open load-testing/k6/tokens.txt
```

## Setup Checks

| Command | Purpose | Positive result |
| --- | --- | --- |
| `make check` | Checks that k6 is installed | k6 version is printed |
| `make help` | Shows available commands | Command list is printed |
| `make ping` | Checks API availability through `/health` | HTTP 200 |
| `make auth-status` | Checks auth token against protected read endpoints | Every endpoint returns HTTP 200 |

## Covered Routes By Command

| Command | Scenario | Covered API routes | State change | Positive result |
| --- | --- | --- | --- | --- |
| `make ping` | API health smoke | `GET /health` | No | HTTP 200 |
| `make public 10` | Public read-only smoke | `GET /health`, `GET /routes`, `GET /routes/map`, `GET /shop`, `GET /raffles`, `GET /cities/{cityId}` | No | HTTP errors below 1%, checks above 99%, p95 below 800 ms |
| `make public 50` | Public read-only base load | `GET /health`, `GET /routes`, `GET /routes/map`, `GET /shop`, `GET /raffles`, `GET /cities/{cityId}` | No | Stable response times, no 429 or 5xx |
| `make public 100` | Public read-only growth step | `GET /health`, `GET /routes`, `GET /routes/map`, `GET /shop`, `GET /raffles`, `GET /cities/{cityId}` | No | Same criteria as public base load |
| `make public 200` | Public read-only high local step | `GET /health`, `GET /routes`, `GET /routes/map`, `GET /shop`, `GET /raffles`, `GET /cities/{cityId}` | No | Same criteria as public base load, watch local CPU/RAM |
| `make auth-status` | One-pass auth diagnostics | `GET /profile`, `GET /aircraft`, `GET /quests`, `GET /collections/me`, `GET /raffles/me`, `GET /wheel/rewards`, `GET /carousel` | No | Every endpoint returns HTTP 200 |
| `make auth-1` | Authenticated game open smoke | `GET /profile`, `GET /aircraft`, `GET /quests`, `GET /collections/me`, `GET /raffles/me`, `GET /wheel/rewards`, `GET /carousel` | No | HTTP errors 0%, checks 100%, p95 below 1000 ms |
| `make auth 5` | Authenticated game open small load | `GET /profile`, `GET /aircraft`, `GET /quests`, `GET /collections/me`, `GET /raffles/me`, `GET /wheel/rewards`, `GET /carousel` | No | HTTP errors below 1%, checks above 99%, no 401/403 |
| `make auth 50` | Authenticated game open base load | `GET /profile`, `GET /aircraft`, `GET /quests`, `GET /collections/me`, `GET /raffles/me`, `GET /wheel/rewards`, `GET /carousel` | No | HTTP errors below 1%, p95 below 1000 ms, p99 below 2000 ms |
| `make flight-once` | Critical flight flow | `POST /flights/start`, `POST /flights/{flightId}/complete`, `GET /profile` before and after | Yes | Flight starts, completes, returns reward, profile stays consistent |
| `make browser` | Mobile browser smoke | Frontend page, session cookie injection, mobile viewport, simple takeoff tap | Can change state if flight starts | Game opens, canvas appears, screenshots are saved |
| `make public-grafana 10` | Public load with Grafana metrics | Same as `make public` | No | Metrics appear in Grafana under the printed `TEST_ID` |
| `make auth-grafana 1` | Auth load with Grafana metrics | Same as `make auth` | No | Metrics and run logs appear in Grafana under the printed `TEST_ID` |

## Business Flows

| Business flow | Current coverage | Commands | What is validated |
| --- | --- | --- | --- |
| Player opens the game | Covered through authenticated read API | `make auth-status`, `make auth-1`, `make auth 5` | Profile, aircraft, quests, collections, raffles, wheel rewards, carousel are readable |
| Public game catalog | Covered through public API | `make public 10`, `make public 50` | Routes, map, shop, raffles, city data are available without auth |
| Flight start and finish | Covered as guarded state-changing flow | `make flight-once` | Flight ID is created, completion works, reward/profile stay consistent |
| Carousel screen | Covered as read-only state | `make auth-*`, `make auth 5` | Carousel state opens for authenticated user |
| Shop screen | Covered as public catalog | `make public 50` | Shop catalog is available and stable |
| Raffles screen | Covered as public and authenticated read | `make public 50`, `make auth 5` | Public raffles and player raffle state are readable |
| Quests and collections | Covered as authenticated read | `make auth 5` | Quest state and collection progress are readable |

## Not Covered Yet

These routes are intentionally not scaled yet because they mutate player data:

| Area | Routes | Why careful |
| --- | --- | --- |
| Carousel run | `POST /carousel/run` | Can spend free or paid runs and grant rewards |
| Shop purchase | `POST /shop/{itemId}/purchase`, `POST /shop/repeat-flight/redeem` | Changes balances and inventory |
| Raffle entry | `POST /raffles/{raffleId}/enter` | Consumes tickets and creates entries |
| Wheel spin | `POST /wheel/spin` | Consumes spins and grants rewards |
| Quest claims | `POST /quests/{questId}/claim`, `POST /quests/bundles/{period}/claim`, `POST /quests/streak/{streakDay}/claim` | Claims are one-time operations |
| Aircraft changes | `POST /aircraft/{aircraftId}/purchase`, `POST /aircraft/{aircraftId}/select`, `POST /aircraft/ferry` | Changes hangar and selected aircraft |

## Load Ladder

Recommended order:

```bash
make ping
make auth-status
make public 10
make public 50
make public 100
make public 200
make auth-1
make auth 5
make auth 50
```

The old explicit style still works:

```bash
make public USERS=200
make auth USERS=5
```

For larger distributed runs:

```bash
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 make dist-public
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=2 make dist-public
```

Authenticated distributed runs require a real token pool:

```bash
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 make dist-auth
```

## Stop Conditions

Stop or do not scale the test if any of these happen:

| Signal | Meaning |
| --- | --- |
| HTTP errors above 1-2% | The system is no longer stable under current load |
| 401/403 on valid tokens | Auth/session behavior is broken or tokens are invalid |
| 429 responses | Rate limits or anti-abuse protection are active |
| Any 5xx growth | Backend is failing |
| Sharp p95/p99 growth | Users may feel the game is slow even if requests still succeed |
| Inconsistent profile/game state | State-changing scenarios may be unsafe to continue |

## Reports

HTML reports are generated locally and ignored by git:

```bash
ls load-testing/k6/results
```

Report commands open the HTML report automatically. To keep the browser closed:

```bash
OPEN_REPORT=false make auth-1
```

The short load-test commands also create and open reports by default:

```bash
make public 200
make auth 200
make auth-status
make flight-once
make browser
```

## Grafana

Use Grafana only after observability is deployed and local `.env` has gateway settings:

```bash
make grafana-check
make public-grafana 10
make auth-grafana 1
```

The printed `TEST_ID` is used to filter the run in Grafana.
