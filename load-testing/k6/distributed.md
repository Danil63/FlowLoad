# Distributed local load testing

This setup lets several laptops run the same k6 scenario at the same time. It is a cheap way to generate more traffic than one MacBook can comfortably produce.

Each laptop:

1. clones the repository;
2. runs `make start`;
3. sets `MACHINE_TOTAL` and its own `MACHINE_INDEX`;
4. starts the runner.

## Install

```bash
make start
```

## Configure

From the repository root:

```bash
cp load-testing/k6/.env.example load-testing/k6/.env
cp load-testing/k6/tokens.example.txt load-testing/k6/tokens.txt
```

Edit `load-testing/k6/.env`.

For two laptops and 100 total VUs:

Laptop 1:

```text
TOTAL_VUS=100
MACHINE_TOTAL=2
MACHINE_INDEX=1
MODE=auth
```

Laptop 2:

```text
TOTAL_VUS=100
MACHINE_TOTAL=2
MACHINE_INDEX=2
MODE=auth
```

The runner splits VUs automatically. If `TOTAL_VUS=100` and `MACHINE_TOTAL=2`, each laptop runs 50 VUs.

## Tokens

For authenticated tests, put one session token per line in:

```text
load-testing/k6/tokens.txt
```

Do not commit this file.

For read-only authenticated tests, a small token pool can work. For state-changing flight tests, use many test accounts because each flight changes player state.

## Coordinated start

Simple version: agree in chat and press Enter at the same time.

Better version: use a delay:

```bash
START_DELAY_SECONDS=60 load-testing/k6/scripts/run-distributed.sh
```

Or use a shared Unix timestamp:

```bash
START_AT_EPOCH=1799820000 load-testing/k6/scripts/run-distributed.sh
```

## Run

Public read-only:

```bash
MODE=public TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 load-testing/k6/scripts/run-distributed.sh
```

Authenticated read-only:

```bash
MODE=auth TOTAL_VUS=100 MACHINE_TOTAL=2 MACHINE_INDEX=1 load-testing/k6/scripts/run-distributed.sh
```

One local config file:

```bash
make dist
```

Short mode-specific commands:

```bash
make dist-public
make dist-auth
make dist-flight
```

## Reports

Each laptop saves its own Russian HTML report in:

```text
load-testing/k6/results/
```

Collect all reports after the run. For a distributed test, compare:

- total requests across all machines;
- p95 and p99 per machine;
- failed request rate per machine;
- slow endpoint table per machine.

If one laptop is much slower than others, it may be limited by CPU, RAM, Wi-Fi, or local network.

## Suggested ladder

For M1 8 GB plus friends on M4 16 GB:

```text
100 VUs total
300 VUs total
500 VUs total
1000 VUs total
```

Keep production state-changing flows much lower unless you have a pool of test accounts:

```text
flight: 1-5 VUs first
flight: 10-50 VUs only with many test accounts
```
