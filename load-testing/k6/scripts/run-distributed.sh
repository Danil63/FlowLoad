#!/usr/bin/env bash
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
K6_DIR="$ROOT_DIR/load-testing/k6"
SCENARIOS_DIR="$K6_DIR/scenarios"
RESULTS_DIR="$K6_DIR/results"
ENV_FILE="${ENV_FILE:-$K6_DIR/.env}"

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac

    KEY="${line%%=*}"
    VALUE="${line#*=}"

    case "$KEY" in
      *[!A-Za-z0-9_]*|"") continue ;;
    esac

    if [ -z "$(printenv "$KEY" 2>/dev/null || true)" ]; then
      export "$KEY=$VALUE"
    fi
  done < "$ENV_FILE"
fi

MODE="${MODE:-auth}"
BASE_URL="${BASE_URL:-https://entreporgneur-big-journey-7b03.twc1.net}"
TOTAL_VUS="${TOTAL_VUS:-50}"
MACHINE_TOTAL="${MACHINE_TOTAL:-1}"
MACHINE_INDEX="${MACHINE_INDEX:-1}"
RAMP_UP="${RAMP_UP:-30s}"
HOLD="${HOLD:-2m}"
RAMP_DOWN="${RAMP_DOWN:-30s}"
THINK_TIME_SECONDS="${THINK_TIME_SECONDS:-1}"
TOKENS_FILE="${TOKENS_FILE:-}"

case "$TOKENS_FILE" in
  ""|/*) ;;
  *) TOKENS_FILE="$ROOT_DIR/$TOKENS_FILE" ;;
esac

mkdir -p "$RESULTS_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is not installed. On macOS: brew install k6" >&2
  exit 1
fi

if [ "$MACHINE_TOTAL" -lt 1 ]; then
  echo "MACHINE_TOTAL must be at least 1" >&2
  exit 1
fi

if [ "$MACHINE_INDEX" -lt 1 ] || [ "$MACHINE_INDEX" -gt "$MACHINE_TOTAL" ]; then
  echo "MACHINE_INDEX must be between 1 and MACHINE_TOTAL" >&2
  exit 1
fi

BASE_VUS=$((TOTAL_VUS / MACHINE_TOTAL))
REMAINDER=$((TOTAL_VUS % MACHINE_TOTAL))
LOCAL_VUS="$BASE_VUS"

if [ "$MACHINE_INDEX" -le "$REMAINDER" ]; then
  LOCAL_VUS=$((LOCAL_VUS + 1))
fi

if [ "$LOCAL_VUS" -lt 1 ]; then
  echo "This machine received 0 VUs. Increase TOTAL_VUS or reduce MACHINE_TOTAL." >&2
  exit 1
fi

if [ -n "${START_DELAY_SECONDS:-}" ]; then
  echo "Waiting ${START_DELAY_SECONDS}s before starting..."
  sleep "$START_DELAY_SECONDS"
fi

if [ -n "${START_AT_EPOCH:-}" ]; then
  NOW="$(date +%s)"
  if [ "$START_AT_EPOCH" -gt "$NOW" ]; then
    WAIT_SECONDS=$((START_AT_EPOCH - NOW))
    echo "Waiting ${WAIT_SECONDS}s until coordinated start..."
    sleep "$WAIT_SECONDS"
  fi
fi

TS="$(date +%Y%m%d-%H%M%S)"
REPORT_PATH="$RESULTS_DIR/${MODE}-machine-${MACHINE_INDEX}-of-${MACHINE_TOTAL}-${LOCAL_VUS}vus-$TS.html"

echo "Mode: $MODE"
echo "Machine: $MACHINE_INDEX/$MACHINE_TOTAL"
echo "Total VUs: $TOTAL_VUS"
echo "Local VUs: $LOCAL_VUS"
echo "Report: $REPORT_PATH"

set +e

case "$MODE" in
  public)
    RU_REPORT="$REPORT_PATH" k6 run \
      -e BASE_URL="$BASE_URL" \
      -e VUS="$LOCAL_VUS" \
      -e RAMP_UP="$RAMP_UP" \
      -e HOLD="$HOLD" \
      -e RAMP_DOWN="$RAMP_DOWN" \
      -e THINK_TIME_SECONDS="$THINK_TIME_SECONDS" \
      "$SCENARIOS_DIR/public-readonly.js"
    status=$?
    ;;
  auth)
    if [ -z "${SESSION_TOKEN:-}${SESSION_TOKENS:-}${TOKENS_FILE:-}" ]; then
      echo "Set SESSION_TOKEN, SESSION_TOKENS, or TOKENS_FILE for auth mode." >&2
      exit 1
    fi

    RU_REPORT="$REPORT_PATH" k6 run \
      -e BASE_URL="$BASE_URL" \
      -e SESSION_TOKEN="${SESSION_TOKEN:-}" \
      -e SESSION_TOKENS="${SESSION_TOKENS:-}" \
      -e TOKENS_FILE="$TOKENS_FILE" \
      -e AUTH_VUS="$LOCAL_VUS" \
      -e RAMP_UP="$RAMP_UP" \
      -e HOLD="$HOLD" \
      -e RAMP_DOWN="$RAMP_DOWN" \
      -e THINK_TIME_SECONDS="$THINK_TIME_SECONDS" \
      "$SCENARIOS_DIR/auth-game-open.js"
    status=$?
    ;;
  flight)
    if [ -z "${SESSION_TOKEN:-}${SESSION_TOKENS:-}${TOKENS_FILE:-}" ]; then
      echo "Set SESSION_TOKEN, SESSION_TOKENS, or TOKENS_FILE for flight mode." >&2
      exit 1
    fi

    ENABLE_STATE_CHANGING=true RU_REPORT="$REPORT_PATH" k6 run \
      -e BASE_URL="$BASE_URL" \
      -e SESSION_TOKEN="${SESSION_TOKEN:-}" \
      -e SESSION_TOKENS="${SESSION_TOKENS:-}" \
      -e TOKENS_FILE="$TOKENS_FILE" \
      -e FLIGHT_VUS="$LOCAL_VUS" \
      -e FLIGHT_ITERATIONS="${FLIGHT_ITERATIONS:-$LOCAL_VUS}" \
      -e ROUTE_ID="${ROUTE_ID:-kazan-moscow}" \
      -e FLIGHT_THINK_TIME_SECONDS="${FLIGHT_THINK_TIME_SECONDS:-3}" \
      -e FLIGHT_HAPPINESS="${FLIGHT_HAPPINESS:-90}" \
      -e FLIGHT_COLLECTED_COINS="${FLIGHT_COLLECTED_COINS:-0}" \
      "$SCENARIOS_DIR/flight-critical.js"
    status=$?
    ;;
  *)
    echo "Unknown MODE=$MODE. Use public, auth, or flight." >&2
    status=1
    ;;
esac

set -e

if [ "${OPEN_REPORT:-true}" = "true" ] && [ -f "$REPORT_PATH" ]; then
  echo "Opening report: $REPORT_PATH"
  open "$REPORT_PATH" >/dev/null 2>&1 || true
fi

exit "$status"
