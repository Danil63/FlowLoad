# FlowLoad

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

The same local UI also has a Swagger/OpenAPI route builder:

1. Upload a `.json`, `.yaml`, or `.yml` Swagger/OpenAPI file, or enter a direct public HTTP(S) specification URL and click "Загрузить по ссылке". For the game, use `https://entreporgneur-big-journey-7b03.twc1.net/docs-json`. HTML Swagger UI pages such as `/docs` are not specification files.
   URL imports run on your computer, support Swagger 2.0/OpenAPI 3.x, and have a 15-second timeout and a 5 MB download limit. Only public IPv4 destinations are supported; use file import for private-network or IPv6-only specifications. Session tokens are not forwarded to the specification server. Failed imports preserve your current workspace.
2. Search the method list at the bottom of the board.
3. Drag methods into the route canvas or select two methods and connect them.
4. Reorder or remove steps if needed.
5. Save the route locally.

Saved routes are written to `load-testing/routes/local/` and are ignored by git.

The UI also includes a load profile builder for method-level pressure:

1. Upload Swagger/OpenAPI once.
2. Search methods in the lower shelf.
3. Drag methods into the load chart or click a method card.
4. Set VUs on each method card.
5. Save the profile locally and run `load profile` from the UI.

Saved load profiles are written to `load-testing/load-profiles/local/` and are ignored by git.

## Workspaces

Use the Workspace selector in the web UI to switch projects. "Новый проект"
creates an empty project with its own name and API base URL; "Настройки" edits
these settings. Different projects can be opened in separate browser tabs.

Tokens, Swagger catalogs, saved scenarios, load profiles, reports, and browser
drafts are isolated by workspace. Existing data stays in "Основной" at its
original paths. New project data is stored under `ui/.local/workspaces/`, which
is ignored by git. Browser drafts remain local to the browser.

UI test runs use the selected project's API URL and token file, overriding
shared Makefile token settings. Only one load test runs at a time across the
local generator. Terminal commands continue using their existing defaults.
Token verification still uses the existing game's protected-endpoint check;
workspace support does not add automatic authentication discovery for other APIs.

## Useful Commands

```bash
make help
make ui
make ping
make public 50
make auth 5
make auth-1
make auth-dashboard
make profile CUSTOM_LOAD_PROFILE_FILE=load-testing/load-profiles/local/name.load.json
```

All load-test commands create a local HTML report in `load-testing/k6/results`
and open it automatically after the run. This also happens when k6 returns a
threshold failure.

See [MEMORIES.md](./MEMORIES.md) for colleague onboarding commands and
[load-testing/k6/README.md](./load-testing/k6/README.md) for detailed notes.
