# big-journey-k6-load-tests

k6 load-testing project for the Big Journey web game.

## Quick Start

```bash
git clone https://github.com/Danil63/big-journey-k6-load-tests.git
cd big-journey-k6-load-tests
make start
make auth-status
make auth-1
```

During `make start`, paste your own local session token when the terminal asks for it.
Do not commit real tokens, `.env` files, or generated reports.

## Useful Commands

```bash
make help
make ping
make public 50
make auth 5
make auth-1
make auth-dashboard
```

See [MEMORIES.md](./MEMORIES.md) for colleague onboarding commands and
[load-testing/k6/README.md](./load-testing/k6/README.md) for detailed notes.

## Grafana

Render/Grafana observability config is included:

```bash
make grafana-check
make public-grafana 10
make auth-grafana 1
```

See [observability/README.md](./observability/README.md).
