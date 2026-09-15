# big-journey-k6-load-tests

k6 load-testing project for the Big Journey web game.

## Quick Start

```bash
git clone https://github.com/Danil63/big-journey-k6-load-tests.git
cd big-journey-k6-load-tests
make start
```

`make start` installs the local dependencies and opens the web UI:

```text
http://127.0.0.1:8787
```

Paste your own local session token in the UI before auth tests.
It is saved only on your Mac in `load-testing/k6/tokens.txt`.
Do not commit real tokens, `.env` files, browser session dumps, or generated reports.

## Useful Commands

```bash
make help
make ui
make ping
make public 50
make auth 5
make auth-1
make auth-dashboard
```

All load-test commands create a local HTML report in `load-testing/k6/results`
and open it automatically after the run. This also happens when k6 returns a
threshold failure.

See [MEMORIES.md](./MEMORIES.md) for colleague onboarding commands and
[load-testing/k6/README.md](./load-testing/k6/README.md) for detailed notes.
