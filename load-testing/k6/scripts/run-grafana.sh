#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SCENARIOS_DIR="$ROOT_DIR/load-testing/k6/scenarios"
RESULTS_DIR="$ROOT_DIR/load-testing/k6/results"

MODE="${MODE:-auth}"
GRAFANA_GATEWAY_URL="${GRAFANA_GATEWAY_URL:-}"
GRAFANA_PUSH_TOKEN="${GRAFANA_PUSH_TOKEN:-}"
TEST_ID="${TEST_ID:-$(date +%Y%m%d-%H%M%S)-${MODE}}"
BASE_URL="${BASE_URL:-https://entreporgneur-big-journey-7b03.twc1.net}"
TOKENS_FILE="${TOKENS_FILE:-$ROOT_DIR/load-testing/k6/tokens.txt}"
REPORT_PATH="${REPORT_PATH:-$RESULTS_DIR/${MODE}-grafana-$TEST_ID.html}"
VUS="${VUS:-50}"
AUTH_VUS="${AUTH_VUS:-1}"
USERS="${USERS:-}"
RAMP_UP="${RAMP_UP:-1m}"
HOLD="${HOLD:-3m}"
RAMP_DOWN="${RAMP_DOWN:-30s}"
THINK_TIME_SECONDS="${THINK_TIME_SECONDS:-1}"

if [ -z "$GRAFANA_GATEWAY_URL" ] || [ -z "$GRAFANA_PUSH_TOKEN" ]; then
  echo "Set GRAFANA_GATEWAY_URL and GRAFANA_PUSH_TOKEN before Grafana runs." >&2
  exit 1
fi

GRAFANA_GATEWAY_URL="${GRAFANA_GATEWAY_URL%/}"
mkdir -p "$RESULTS_DIR"

safe_label() {
  printf '%s' "$1" | tr -cd '[:alnum:]_.-'
}

push_loki_log() {
  local level="$1"
  local message="$2"
  local timestamp_ns
  local safe_test_id
  local safe_mode
  local payload

  timestamp_ns="$(date +%s)000000000"
  safe_test_id="$(safe_label "$TEST_ID")"
  safe_mode="$(safe_label "$MODE")"
  payload='{"streams":[{"stream":{"job":"k6","project":"big-journey","mode":"'"$safe_mode"'","testid":"'"$safe_test_id"'","level":"'"$level"'"},"values":[["'"$timestamp_ns"'","'"$message"'"]]}]}'

  curl -sS -o /dev/null \
    -X POST "$GRAFANA_GATEWAY_URL/loki/api/v1/push" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GRAFANA_PUSH_TOKEN" \
    --data "$payload" || true
}

run_k6() {
  local scenario="$1"
  shift

  K6_PROMETHEUS_RW_SERVER_URL="$GRAFANA_GATEWAY_URL/api/v1/write" \
  K6_PROMETHEUS_RW_BEARER_TOKEN="$GRAFANA_PUSH_TOKEN" \
  K6_PROMETHEUS_RW_TREND_STATS="avg,p(90),p(95),p(99),min,max" \
  K6_PROMETHEUS_RW_STALE_MARKERS=true \
  k6 run -o experimental-prometheus-rw \
    --tag "testid=$TEST_ID" \
    --tag "project=big-journey" \
    --tag "mode=$MODE" \
    "$@" \
    "$scenario"
}

push_loki_log "info" "k6 run started"

case "$MODE" in
  public)
    PUBLIC_VUS="${USERS:-$VUS}"
    RU_REPORT="$REPORT_PATH" run_k6 "$SCENARIOS_DIR/public-readonly.js" \
      -e BASE_URL="$BASE_URL" \
      -e VUS="$PUBLIC_VUS" \
      -e RAMP_UP="$RAMP_UP" \
      -e HOLD="$HOLD" \
      -e RAMP_DOWN="$RAMP_DOWN" \
      -e THINK_TIME_SECONDS="$THINK_TIME_SECONDS"
    status=$?
    ;;
  auth)
    AUTH_USERS="${USERS:-$AUTH_VUS}"
    RU_REPORT="$REPORT_PATH" run_k6 "$SCENARIOS_DIR/auth-game-open.js" \
      -e BASE_URL="$BASE_URL" \
      -e SESSION_TOKEN="${SESSION_TOKEN:-}" \
      -e SESSION_TOKENS="${SESSION_TOKENS:-}" \
      -e TOKENS_FILE="$TOKENS_FILE" \
      -e AUTH_VUS="$AUTH_USERS" \
      -e RAMP_UP="$RAMP_UP" \
      -e HOLD="$HOLD" \
      -e RAMP_DOWN="$RAMP_DOWN" \
      -e THINK_TIME_SECONDS="$THINK_TIME_SECONDS" \
      -e DEBUG_AUTH="${DEBUG_AUTH:-}"
    status=$?
    ;;
  *)
    echo "Unknown MODE=$MODE. Use public or auth." >&2
    status=1
    ;;
esac

if [ "$status" -eq 0 ]; then
  push_loki_log "info" "k6 run finished successfully"
else
  push_loki_log "error" "k6 run finished with exit code $status"
fi

echo "Grafana testid: $TEST_ID"
if [ "${OPEN_REPORT:-true}" = "true" ] && [ -f "$REPORT_PATH" ]; then
  echo "Opening report: $REPORT_PATH"
  open "$REPORT_PATH" >/dev/null 2>&1 || true
fi
exit "$status"
