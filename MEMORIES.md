# Onboarding Commands

This file is intentionally command-only. Do not store tokens, domains, credentials, screenshots, reports, or production details here.

## New Mac

```bash
git clone <repo-url>
cd <repo-folder>
make start
```

During `make start`, paste your own session token when the terminal asks for it.

If token setup was skipped:

```bash
make token
```

If you need to add many local tokens:

```bash
open load-testing/k6/tokens.txt
```

## Check Setup

```bash
make check
make help
```

## Before Load Tests

```bash
make ping
make auth-status
```

## Public Tests

```bash
make public USERS=10
make public USERS=50
make public USERS=100
```

## Auth Tests

```bash
make auth-1
make auth USERS=5
make auth USERS=50
make auth USERS=100
```

## Browser Smoke

```bash
make browser
```

## Distributed Run

Machine 1:

```bash
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 make dist-public
```

Machine 2:

```bash
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=2 make dist-public
```

For authenticated distributed tests:

```bash
TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 make dist-auth
```

## Reports

```bash
ls load-testing/k6/results
```
