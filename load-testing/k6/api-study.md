# API study from Swagger

Swagger source: `https://entreporgneur-big-journey-7b03.twc1.net/docs`

The Swagger document exposes 71 paths and 95 operations. The backend appears to be a game API with player profile, aircraft hangar, routes, flights, quests, collections, wheel/carousel rewards, shop, raffles, and admin content management.

## Authentication

Protected endpoints use an API-key style cookie. Swagger lists:

```text
better-auth.session_token
```

The observed production browser cookie name is:

```text
__Secure-better-auth.session_token
```

For k6, pass it as:

```http
Cookie: __Secure-better-auth.session_token=<token>
```

## Safe public endpoints

These do not require a session and are the best first production load target.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | root app response |
| GET | `/health` | health check |
| GET | `/routes` | public route catalog |
| GET | `/routes/map` | public destination map |
| GET | `/cities/{cityId}` | public city details |
| GET | `/raffles` | public raffle catalog |
| GET | `/shop` | public shop catalog |

Known route IDs from the public catalog include `kazan-moscow` and `kazan-saint-petersburg`.

## Authenticated read endpoints

These require a player session. They read current player/game state and should be the second test layer.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/profile` | player profile, current city, wallet, daily flight limits, wheel/fuel status |
| GET | `/aircraft` | hangar, selected aircraft, available aircraft, stranded state |
| GET | `/quests` | player quest state |
| GET | `/collections/me` | player collection progress |
| GET | `/raffles/me` | player raffle tickets and entries |
| GET | `/wheel/rewards` | wheel rewards |
| GET | `/carousel` | carousel state, odds, balances, guarantee state |

These are good for simulating "player opens the game".

## Critical state-changing flow

This is the most important gameplay flow, but it changes production data.

| Method | Path | Body |
| --- | --- | --- |
| POST | `/flights/start` | `{ "routeId": "kazan-moscow", "aircraftId": "meridian" }` where `aircraftId` is optional |
| POST | `/flights/{flightId}/complete` | `{ "happiness": 90, "collectedCoins": 0 }` |

`/flights/start` returns `flightId`, `routeId`, `aircraftId`, `aircraftSpeedPercent`, `startedAt`, and `flightsRemaining`.

`/flights/{flightId}/complete` returns `flightId` and reward details.

Risk notes:

- consumes daily flight attempts or extra attempts;
- changes wallet, experience, level, quests, stamps/collections;
- may be limited by current city, aircraft, daily caps, route availability, and anti-abuse logic;
- one account under high concurrency is not a realistic 50-player test.

## Secondary state-changing flows

Add later, once test accounts and guardrails are clear.

| Area | Endpoint examples | Risk |
| --- | --- | --- |
| Carousel | `POST /carousel/run` | spends free/paid runs or miles, grants rewards |
| Shop | `POST /shop/{itemId}/purchase`, `POST /shop/repeat-flight/redeem` | changes soft currency and inventory |
| Raffles | `POST /raffles/{raffleId}/enter` | consumes tickets and creates entries |
| Wheel | `POST /wheel/spin` | consumes spins and grants rewards |
| Quests | `POST /quests/{questId}/claim`, `POST /quests/bundles/{period}/claim`, `POST /quests/streak/{streakDay}/claim` | claims rewards once; not reusable under load |
| Aircraft | `POST /aircraft/{aircraftId}/purchase`, `POST /aircraft/{aircraftId}/select`, `POST /aircraft/ferry` | changes hangar/current state |
| Profile | `POST /profile/onboarding/complete`, `POST /profile/reset-progress`, `POST /profile/grant` | mutates onboarding/progress/economy; not a normal player load path |

## Admin endpoints

The API exposes many `/admin/...` operations for cities, routes, aircraft, raffles, quests, shop items, partners, collections, carousel config, sectors, and audit logs.

For player load testing, exclude all admin endpoints. They test a different workload and many of them mutate production configuration.

## Production test policy

Use these phases:

1. Public read-only smoke.
2. Public read-only load at 50 VUs.
3. Authenticated read with 1 account and low VUs.
4. Critical flight with one account and one iteration.
5. Request a pool of test accounts before scaling state-changing scenarios.

Stop a run if:

- `http_req_failed` rises above 1%;
- p95 latency grows sharply for several minutes;
- login/profile endpoints start returning 401/403/429/5xx;
- game state becomes inconsistent for the test user;
- any business owner asks to stop production traffic.
